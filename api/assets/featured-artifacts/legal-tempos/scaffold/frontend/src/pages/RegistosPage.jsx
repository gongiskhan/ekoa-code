import { useEffect, useMemo, useState } from 'react';
import {
  useSharedCollection,
  createShared,
  updateShared,
  getShared,
  listShared,
  notify,
  appHref,
  formatEur,
} from '../shared.js';
import {
  Button,
  Field,
  Input,
  Select,
  Badge,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import { IconTimer, IconClock, IconCoins } from '../components/Icons.jsx';
import { useDemoResult } from '../demo.js';
import {
  round2,
  hojeISO,
  minutosEntre,
  segundosDecorridos,
  formatCronometro,
  formatDuracao,
  valorEstimado,
  podeTransferir,
  buildLancamentoPayload,
  ESTADO_LABEL,
  ESTADO_TONE,
} from './tempos-logic.js';

const START_FORM = { processoId: '', pessoaId: '', descricao: '', faturavel: true, tarifa: '' };
const MANUAL_FORM = {
  processoId: '',
  pessoaId: '',
  descricao: '',
  data: '',
  minutos: '',
  inicioHora: '',
  fimHora: '',
  faturavel: true,
  tarifa: '',
};

/* Ordena registos do mais recente para o mais antigo (por inicio, depois
 * createdAt). */
function recentesPrimeiro(a, b) {
  const key = (r) => String(r.inicio || '') + String(r.createdAt || '');
  return key(b).localeCompare(key(a));
}

export default function RegistosPage() {
  const { items: registos, loading, refresh } = useSharedCollection('registos_tempo');
  const { items: processos } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: pessoas } = useSharedCollection('pessoas');

  const [startForm, setStartForm] = useState({ ...START_FORM });
  const [manual, setManual] = useState({ ...MANUAL_FORM, data: hojeISO() });
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [transferindoId, setTransferindoId] = useState(null);
  const [agoraMs, setAgoraMs] = useState(Date.now());

  const processoById = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p));
    return map;
  }, [processos]);

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '';
  }, [clientes]);

  const pessoaNome = useMemo(() => {
    const map = new Map();
    pessoas.forEach((p) => map.set(p.id, p.nome));
    return (id) => map.get(id) || '';
  }, [pessoas]);

  const processoLabel = (id) => {
    const p = processoById.get(id);
    if (!p) return '—';
    const nome = clienteNome(p.clienteId);
    return `${p.numeroProcesso || '(sem número)'}${nome ? ` · ${nome}` : ''}`;
  };

  // Temporizador em curso (no máximo um a contar em cada momento).
  const emCurso = useMemo(
    () => registos.find((r) => r.estado === 'em_curso') || null,
    [registos],
  );

  // O mostrador só bate quando há um registo a contar - sem intervalos ociosos.
  useEffect(() => {
    if (!emCurso) return undefined;
    setAgoraMs(Date.now());
    const handle = setInterval(() => setAgoraMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [emCurso]);

  const recentes = useMemo(
    () => registos.slice().sort(recentesPrimeiro).slice(0, 12),
    [registos],
  );

  // Sinaliza à demo que a lista de registos tem conteúdo visível.
  useDemoResult('tempos-lista', recentes.length > 0);

  const semProcessos = processos.length === 0;

  async function onIniciar() {
    if (!startForm.descricao.trim() || starting) return;
    setStarting(true);
    try {
      const proc = processoById.get(startForm.processoId);
      await createShared('registos_tempo', {
        processoId: startForm.processoId || null,
        clienteId: proc ? proc.clienteId || null : null,
        pessoaId: startForm.pessoaId || null,
        descricao: startForm.descricao.trim(),
        inicio: new Date().toISOString(),
        faturavel: startForm.faturavel,
        tarifaHora: startForm.tarifa === '' ? null : round2(startForm.tarifa),
        estado: 'em_curso',
      });
      setStartForm({ ...START_FORM });
      await refresh();
      toast('Temporizador iniciado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível iniciar o temporizador.', { tone: 'error' });
    } finally {
      setStarting(false);
    }
  }

  async function onParar() {
    if (!emCurso || stopping) return;
    setStopping(true);
    try {
      const fim = new Date().toISOString();
      const minutos = minutosEntre(emCurso.inicio, fim);
      await updateShared('registos_tempo', emCurso.id, { fim, minutos, estado: 'parado' });
      await refresh();
      toast('Temporizador parado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível parar o temporizador.', { tone: 'error' });
    } finally {
      setStopping(false);
    }
  }

  // Minutos efectivos da entrada manual: valor directo ou início→fim.
  const manualMinutos = useMemo(() => {
    if (String(manual.minutos).trim() !== '') {
      const n = Number(manual.minutos);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    }
    if (manual.inicioHora && manual.fimHora) {
      const dia = manual.data || hojeISO();
      return minutosEntre(`${dia}T${manual.inicioHora}:00`, `${dia}T${manual.fimHora}:00`);
    }
    return 0;
  }, [manual.minutos, manual.inicioHora, manual.fimHora, manual.data]);

  const manualDisabled = savingManual || !manual.descricao.trim() || manualMinutos <= 0;

  async function onGuardarManual() {
    if (manualDisabled) return;
    setSavingManual(true);
    try {
      const dia = manual.data || hojeISO();
      const proc = processoById.get(manual.processoId);
      const inicio = manual.inicioHora ? `${dia}T${manual.inicioHora}:00` : `${dia}T09:00:00`;
      const fim = manual.fimHora ? `${dia}T${manual.fimHora}:00` : null;
      await createShared('registos_tempo', {
        processoId: manual.processoId || null,
        clienteId: proc ? proc.clienteId || null : null,
        pessoaId: manual.pessoaId || null,
        descricao: manual.descricao.trim(),
        inicio,
        fim,
        minutos: manualMinutos,
        faturavel: manual.faturavel,
        tarifaHora: manual.tarifa === '' ? null : round2(manual.tarifa),
        estado: 'parado',
      });
      setManual({ ...MANUAL_FORM, data: hojeISO() });
      await refresh();
      toast('Registo guardado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível guardar o registo.', { tone: 'error' });
    } finally {
      setSavingManual(false);
    }
  }

  async function onTransferir(registo) {
    // Idempotente SOB FALHA PARCIAL e entre sessões: o lançamento carrega
    // `registoTempoId` (chave de idempotência). Antes de criar, relê o registo
    // E procura um lançamento órfão da mesma origem - se existir, apenas
    // repara o registo em vez de duplicar a faturação.
    if (!podeTransferir(registo) || transferindoId) return;
    setTransferindoId(registo.id);
    try {
      const fresco = await getShared('registos_tempo', registo.id);
      if (!fresco || fresco.estado === 'transferido' || fresco.lancamentoId) {
        await refresh();
        toast('Este tempo já tinha sido transferido.', { tone: 'ok' });
        return;
      }

      const lancamentos = await listShared('lancamentos');
      const existente = (Array.isArray(lancamentos) ? lancamentos : [])
        .find((l) => l && l.registoTempoId === registo.id);

      let lancId = existente ? existente.id : null;
      if (!lancId) {
        const lanc = await createShared('lancamentos', {
          ...buildLancamentoPayload(fresco, hojeISO()),
          registoTempoId: registo.id,
        });
        lancId = lanc && lanc.id;
      }
      if (lancId) {
        await updateShared('registos_tempo', registo.id, {
          estado: 'transferido',
          lancamentoId: lancId,
        });
        if (!existente) {
          await notify({
            tipo: 'tempos',
            titulo: 'Tempo transferido para honorários',
            corpo: registo.descricao || 'Registo de tempo',
            href: appHref('legal-honorarios'),
          });
        }
      }
      await refresh();
      toast(existente
        ? 'Transferência recuperada - o lançamento já existia e o registo foi reparado.'
        : 'Tempo transferido para honorários.', { tone: 'ok' });
    } catch {
      toast('Não foi possível transferir o tempo.', { tone: 'error' });
    } finally {
      setTransferindoId(null);
    }
  }

  return (
    <div data-testid="registos-page" data-demo-page="tempos/registos">
      <div className="page-header">
        <div>
          <h1 className="page-title">Registo de tempos</h1>
          <p className="page-subtitle">
            Conte o tempo ao vivo ou lance-o à mão, por processo e por pessoa. Os tempos faturáveis
            passam para os honorários num clique.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--sp-6, 1.5rem)',
          marginBottom: 'var(--sp-6, 1.5rem)',
        }}
      >
        {/* ---- Temporizador (em curso OU formulário de arranque) ---- */}
        <section className="card" aria-label="Temporizador">
          <h2 className="card-title">Temporizador</h2>
          {emCurso ? (
            <div className="stack stack-4" data-testid="tempos-emcurso" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
              <div
                className="numeric"
                data-testid="tempos-cronometro"
                style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--accent)' }}
              >
                {formatCronometro(segundosDecorridos(emCurso.inicio, agoraMs))}
              </div>
              <div className="stack stack-1">
                <span className="text-strong">{emCurso.descricao || '(sem descrição)'}</span>
                <span className="text-subtle text-small">
                  {emCurso.processoId ? processoLabel(emCurso.processoId) : 'Sem processo associado'}
                  {emCurso.faturavel ? ' · Faturável' : ' · Não faturável'}
                </span>
              </div>
              <div className="row row-2">
                <Button variant="danger" data-testid="tempos-parar" onClick={onParar} disabled={stopping}>
                  {stopping ? 'A parar…' : 'Parar'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="form" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
              <Field label="Descrição" required>
                <Input
                  type="text"
                  data-testid="tempos-start-descricao"
                  placeholder="Ex.: Estudo do processo"
                  value={startForm.descricao}
                  onChange={(e) => setStartForm((p) => ({ ...p, descricao: e.target.value }))}
                />
              </Field>
              <div className="form-grid">
                <Field label="Processo">
                  <Select
                    data-testid="tempos-start-processo"
                    value={startForm.processoId}
                    onChange={(e) => setStartForm((p) => ({ ...p, processoId: e.target.value }))}
                  >
                    <option value="">{semProcessos ? 'Sem processos' : 'Sem processo'}</option>
                    {processos.map((p) => (
                      <option key={p.id} value={p.id}>{processoLabel(p.id)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Pessoa">
                  <Select
                    data-testid="tempos-start-pessoa"
                    value={startForm.pessoaId}
                    onChange={(e) => setStartForm((p) => ({ ...p, pessoaId: e.target.value }))}
                  >
                    <option value="">Sem pessoa</option>
                    {pessoas.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Tarifa/hora (€)" hint="Opcional - usada na estimativa e na transferência.">
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    data-testid="tempos-start-tarifa"
                    placeholder="120.00"
                    value={startForm.tarifa}
                    onChange={(e) => setStartForm((p) => ({ ...p, tarifa: e.target.value }))}
                  />
                </Field>
                <Field label="Faturação">
                  <label className="checkbox-field" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
                    <input
                      type="checkbox"
                      data-testid="tempos-start-faturavel"
                      checked={startForm.faturavel}
                      onChange={(e) => setStartForm((p) => ({ ...p, faturavel: e.target.checked }))}
                    />
                    <span>Tempo faturável</span>
                  </label>
                </Field>
              </div>
              <div className="row">
                <Button
                  data-testid="tempos-iniciar"
                  data-demo-target="tempos-iniciar"
                  onClick={onIniciar}
                  disabled={starting || !startForm.descricao.trim()}
                >
                  <IconTimer /> Iniciar temporizador
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ---- Registo manual ---- */}
        <section className="card" aria-label="Registo manual">
          <h2 className="card-title">Registo manual</h2>
          <p className="card-subtitle">Lance um tempo já decorrido, por minutos ou por horas de início e fim.</p>
          <div className="form" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
            <Field label="Descrição" required>
              <Input
                type="text"
                data-testid="tempos-desc"
                data-demo-target="tempos-desc"
                placeholder="Ex.: Reunião de preparação"
                value={manual.descricao}
                onChange={(e) => setManual((p) => ({ ...p, descricao: e.target.value }))}
              />
            </Field>
            <div className="form-grid">
              <Field label="Processo">
                <Select
                  data-testid="tempos-processo"
                  value={manual.processoId}
                  onChange={(e) => setManual((p) => ({ ...p, processoId: e.target.value }))}
                >
                  <option value="">{semProcessos ? 'Sem processos' : 'Sem processo'}</option>
                  {processos.map((p) => (
                    <option key={p.id} value={p.id}>{processoLabel(p.id)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Pessoa">
                <Select
                  data-testid="tempos-pessoa"
                  value={manual.pessoaId}
                  onChange={(e) => setManual((p) => ({ ...p, pessoaId: e.target.value }))}
                >
                  <option value="">Sem pessoa</option>
                  {pessoas.map((p) => (
                    <option key={p.id} value={p.id}>{p.nome}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Data">
                <Input
                  type="date"
                  data-testid="tempos-data"
                  value={manual.data}
                  onChange={(e) => setManual((p) => ({ ...p, data: e.target.value }))}
                />
              </Field>
              <Field label="Minutos" hint="Ou preencha início e fim abaixo.">
                <Input
                  type="number" min="0" step="1" inputMode="numeric"
                  data-testid="tempos-minutos"
                  data-demo-target="tempos-minutos"
                  placeholder="90"
                  value={manual.minutos}
                  onChange={(e) => setManual((p) => ({ ...p, minutos: e.target.value }))}
                />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Início">
                <Input
                  type="time"
                  data-testid="tempos-inicio-hora"
                  value={manual.inicioHora}
                  onChange={(e) => setManual((p) => ({ ...p, inicioHora: e.target.value }))}
                />
              </Field>
              <Field label="Fim">
                <Input
                  type="time"
                  data-testid="tempos-fim-hora"
                  value={manual.fimHora}
                  onChange={(e) => setManual((p) => ({ ...p, fimHora: e.target.value }))}
                />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Tarifa/hora (€)" hint="Opcional.">
                <Input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  data-testid="tempos-tarifa"
                  placeholder="120.00"
                  value={manual.tarifa}
                  onChange={(e) => setManual((p) => ({ ...p, tarifa: e.target.value }))}
                />
              </Field>
              <Field label="Faturação">
                <label className="checkbox-field" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
                  <input
                    type="checkbox"
                    data-testid="tempos-faturavel"
                    checked={manual.faturavel}
                    onChange={(e) => setManual((p) => ({ ...p, faturavel: e.target.checked }))}
                  />
                  <span>Tempo faturável</span>
                </label>
              </Field>
            </div>
            <div className="row row-space-between">
              <span className="text-subtle text-small">
                {manualMinutos > 0 ? `Duração: ${formatDuracao(manualMinutos)}` : 'Indique os minutos ou o intervalo.'}
              </span>
              <Button
                data-testid="tempos-guardar"
                data-demo-target="tempos-guardar"
                onClick={onGuardarManual}
                disabled={manualDisabled}
              >
                {savingManual ? 'A guardar…' : 'Guardar registo'}
              </Button>
            </div>
          </div>
        </section>
      </div>

      {/* ---- Registos recentes ---- */}
      <section aria-label="Registos recentes">
        <div className="row row-space-between" style={{ marginBottom: 'var(--sp-3, 0.75rem)' }}>
          <h2 className="card-title" style={{ margin: 0 }}>Registos recentes</h2>
          <span className="text-subtle text-small">{registos.length} registo(s)</span>
        </div>

        <div data-testid="tempos-lista" data-demo-target="tempos-lista">
          {loading ? (
            <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar registos.</span></div>
          ) : recentes.length === 0 ? (
            <EmptyState
              icon={<IconClock />}
              title="Sem registos de tempo"
              hint="Inicie o temporizador ou lance um registo manual para começar."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Processo</th>
                    <th>Pessoa</th>
                    <th className="numeric">Duração</th>
                    <th className="numeric">Valor estimado</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recentes.map((r) => {
                    const est = valorEstimado(r);
                    return (
                      <tr key={r.id} data-testid="tempos-registo">
                        <td>{r.descricao || '(sem descrição)'}</td>
                        <td>
                          <span className="text-subtle text-small">
                            {r.processoId ? (processoById.get(r.processoId)?.numeroProcesso || '—') : '—'}
                          </span>
                        </td>
                        <td>
                          <span className="text-subtle text-small">{pessoaNome(r.pessoaId) || '—'}</span>
                        </td>
                        <td className="numeric">{formatDuracao(r.minutos)}</td>
                        <td className="numeric">
                          {est != null ? <span className="text-strong">{formatEur(est)}</span> : <span className="text-subtle">—</span>}
                        </td>
                        <td>
                          <Badge tone={ESTADO_TONE[r.estado] || 'neutral'}>{ESTADO_LABEL[r.estado] || r.estado}</Badge>
                        </td>
                        <td className="numeric">
                          {podeTransferir(r) ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              data-testid="tempos-transferir"
                              data-demo-target="tempos-transferir"
                              onClick={() => onTransferir(r)}
                              disabled={transferindoId === r.id}
                            >
                              <IconCoins /> {transferindoId === r.id ? 'A transferir…' : 'Transferir para honorários'}
                            </Button>
                          ) : r.estado === 'transferido' ? (
                            <span className="text-subtle text-small">Transferido</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
