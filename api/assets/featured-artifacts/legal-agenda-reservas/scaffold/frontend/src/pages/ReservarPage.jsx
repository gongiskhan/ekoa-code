import { useEffect, useMemo, useState } from 'react';
import { construirEventoDeReserva } from '../engine/agenda.mjs';
import {
  listShared, createShared, updateShared, deleteShared,
  agoraLocal, daquiA, proximosDias, horaDe, rotuloDataCurto, rotuloDataLongo, formatEur,
} from '../reservas-data.js';

const DIAS_JANELA = 14;
// Referência Multibanco de DEMONSTRAÇÃO (fixa). A confirmação real chega pelo
// callback do fornecedor (Ifthenpay), activado no checkpoint de pagamento.
const MB_ENTIDADE = '11249';
const MB_REFERENCIA = '123 456 789';

function queryTipo() {
  try { return new URLSearchParams(window.location.search).get('tipo') || null; }
  catch { return null; }
}

function setQueryTipo(id) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('tipo', id); else url.searchParams.delete('tipo');
    window.history.replaceState({}, '', url);
  } catch { /* não fatal */ }
}

/*
 * Página pública de marcação. Fluxo: escolher tipo -> escolher dia -> escolher
 * horário -> dados -> reservar. Se o tipo exigir pagamento, mostra o painel de
 * pagamento (mock); senão confirma de imediato.
 *
 * PRIVACIDADE (garantida por construção + testada): a página LÊ as colecções
 * partilhadas para calcular os horários (o motor precisa das disponibilidades,
 * eventos, ausências e reservas), mas RENDERIZA apenas os horários e a
 * informação pública do tipo. Nunca mostra nomes da equipa, detalhes de eventos,
 * nem dados pessoais de outras reservas.
 */
export default function ReservarPage() {
  const [carregando, setCarregando] = useState(true);
  const [tipos, setTipos] = useState([]);
  // PRIVACIDADE: esta página é pública/anónima e lê APENAS a colecção saneada
  // `agenda_publica` ({sessaoTipoId, inicio, fim} dos horários livres) mantida
  // pela app de equipa e pelo backend - nunca reservas de terceiros, eventos,
  // disponibilidades ou ausências (esses dados não podem chegar a este browser).
  const [agendaPublica, setAgendaPublica] = useState([]);

  const [tipoId, setTipoId] = useState(() => queryTipo());
  const [dia, setDia] = useState(null);
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ nome: '', email: '', telefone: '' });
  const [fase, setFase] = useState('escolher'); // escolher | submeter | pagamento | confirmada
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');

  // `agora` capturado uma vez — o fluxo é curto; evita o cálculo de slots
  // "andar" a cada render. Recalcula-se ao recarregar dados.
  const [agora, setAgora] = useState(() => agoraLocal());

  const dias = useMemo(() => proximosDias(DIAS_JANELA), []);

  async function carregar() {
    setCarregando(true);
    try {
      const [ts, publica] = await Promise.all([
        listShared('sessao_tipos'), listShared('agenda_publica'),
      ]);
      setTipos((ts || []).filter((t) => t && t.publico));
      setAgendaPublica(publica || []);
      setAgora(agoraLocal());
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); /* uma vez */ }, []);

  const tipo = useMemo(() => tipos.find((t) => t.id === tipoId) || null, [tipos, tipoId]);

  // Slots publicados (agenda_publica) do tipo escolhido, futuros, por dia.
  const slotsPorDia = useMemo(() => {
    if (!tipo) return {};
    const map = {};
    for (const s of agendaPublica) {
      if (!s || s.sessaoTipoId !== tipo.id || !s.inicio) continue;
      if (String(s.inicio) <= String(agora)) continue;
      const d = String(s.inicio).slice(0, 10);
      (map[d] = map[d] || []).push({ inicio: s.inicio, fim: s.fim, publicaId: s.id });
    }
    for (const d of Object.keys(map)) map[d].sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
    return map;
  }, [tipo, agendaPublica, agora]);

  const diasComSlots = useMemo(() => Object.keys(slotsPorDia).sort(), [slotsPorDia]);

  // Ao (re)selecionar tipo/slots, garante um dia válido escolhido.
  useEffect(() => {
    if (diasComSlots.length === 0) { setDia(null); return; }
    if (!dia || !diasComSlots.includes(dia)) setDia(diasComSlots[0]);
  }, [diasComSlots]); // eslint-disable-line react-hooks/exhaustive-deps

  function escolherTipo(id) {
    setTipoId(id);
    setQueryTipo(id);
    setSlot(null);
    setErro('');
    setFase('escolher');
    setResultado(null);
  }

  function voltar() {
    setTipoId(null);
    setQueryTipo(null);
    setSlot(null);
    setErro('');
    setFase('escolher');
    setResultado(null);
  }

  function validar() {
    if (!slot) { setErro('Escolha um horário.'); return false; }
    if (!form.nome.trim()) { setErro('Indique o seu nome.'); return false; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) { setErro('Indique um email válido.'); return false; }
    return true;
  }

  async function confirmar() {
    setErro('');
    if (!validar()) return;
    setFase('submeter');
    try {
      // Guarda anti-duplicação: relê a agenda pública - se o horário escolhido
      // já não estiver publicado, foi entretanto ocupado. (A guarda definitiva
      // é do backend, na confirmação do pagamento.)
      const publicaFresca = await listShared('agenda_publica');
      const aindaLivre = (publicaFresca || []).find(
        (l) => l && l.sessaoTipoId === tipo.id && l.inicio === slot.inicio && l.fim === slot.fim,
      );
      if (!aindaLivre) {
        setAgendaPublica(publicaFresca || []);
        setSlot(null);
        setErro('Esse horário foi entretanto ocupado. Escolha outro.');
        setFase('escolher');
        return;
      }

      const exigePagamento = tipo.preco != null && tipo.pagamentoObrigatorio;
      const base = {
        sessaoTipoId: tipo.id,
        inicio: slot.inicio,
        fim: slot.fim,
        nome: form.nome.trim(),
        email: form.email.trim(),
        estado: 'hold',
        expiraEm: daquiA(15),
      };
      const tel = form.telefone.trim();
      if (tel) base.telefone = tel;
      if (tipo.preco != null) base.pagamento = { metodo: 'mbway', valor: tipo.preco };

      const criada = await createShared('reservas', base);
      if (!criada) throw new Error('sem espinha');
      // Consome o horário publicado: o próximo visitante deixa de o ver.
      try { await deleteShared('agenda_publica', aindaLivre.id); } catch { /* não fatal */ }

      if (exigePagamento) {
        await updateShared('reservas', criada.id, { estado: 'pendente_pagamento' });
        setResultado({ ...criada, estado: 'pendente_pagamento' });
        setFase('pagamento');
      } else {
        // Sessão gratuita -> confirma já e escreve o evento na agenda (mesma
        // linha determinística que o backend/simulação escrevem).
        await updateShared('reservas', criada.id, { estado: 'confirmada', confirmadaEm: agoraLocal() });
        const confirmada = { ...criada, estado: 'confirmada' };
        try { await createShared('eventos', construirEventoDeReserva(confirmada, tipo)); } catch { /* não fatal para o cliente */ }
        setResultado(confirmada);
        setFase('confirmada');
      }
    } catch {
      setErro('Não foi possível concluir a reserva. Tente novamente.');
      setFase('escolher');
    }
  }

  if (carregando) {
    return <div className="rz-card"><p className="rz-empty">A carregar horários…</p></div>;
  }

  // Painel de resultado (pagamento ou confirmada).
  if ((fase === 'pagamento' || fase === 'confirmada') && resultado && tipo) {
    return (
      <ResultadoPanel
        fase={fase}
        tipo={tipo}
        dia={resultado.inicio.slice(0, 10)}
        slot={resultado}
        email={resultado.email}
        telefone={resultado.telefone}
        onVoltar={() => { voltar(); carregar(); }}
      />
    );
  }

  // Sem tipo escolhido -> lista de tipos públicos.
  if (!tipo) {
    return (
      <div className="rz-stack" data-testid="reservas-page">
        <div>
          <h1 className="rz-title">Marcar uma sessão</h1>
          <p className="rz-subtitle">Escolha o tipo de sessão. Mostramos-lhe os horários livres.</p>
        </div>
        {tipos.length === 0 ? (
          <div className="rz-card"><p className="rz-empty" data-testid="reservas-sem-tipos">De momento não há sessões disponíveis para marcação.</p></div>
        ) : (
          <div className="rz-stack" data-demo-target="reservas-tipos" data-testid="reservas-tipos">
            {tipos.map((t) => (
              <button key={t.id} type="button" className="rz-tipo-card" data-testid="rz-tipo-card" data-tipo-id={t.id} onClick={() => escolherTipo(t.id)}>
                <div className="rz-between">
                  <span className="rz-tipo-name">{t.nome}</span>
                  <span className={`rz-badge${t.preco == null ? ' rz-badge-ok' : ''}`}>{t.preco == null ? 'Grátis' : formatEur(t.preco)}</span>
                </div>
                {t.descricao && <p className="rz-small rz-muted" style={{ margin: '0.35rem 0 0' }}>{t.descricao}</p>}
                <p className="rz-xs rz-subtle" style={{ margin: '0.35rem 0 0' }}>{t.duracaoMin} min</p>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Tipo escolhido -> dia + horário + dados.
  const slotsDoDia = (dia && slotsPorDia[dia]) || [];
  return (
    <div className="rz-stack" data-testid="reservas-page">
      {tipos.length > 1 && (
        <button type="button" className="rz-back" data-testid="rz-voltar" onClick={voltar}>← Outros tipos de sessão</button>
      )}

      <div className="rz-card">
        <div className="rz-between">
          <div>
            <h1 className="rz-title" style={{ marginTop: 0 }} data-testid="rz-tipo-nome">{tipo.nome}</h1>
            <p className="rz-subtitle rz-small">{tipo.duracaoMin} min{tipo.descricao ? ` · ${tipo.descricao}` : ''}</p>
          </div>
          <span className={`rz-badge${tipo.preco == null ? ' rz-badge-ok' : ''}`}>{tipo.preco == null ? 'Grátis' : formatEur(tipo.preco)}</span>
        </div>
      </div>

      {diasComSlots.length === 0 ? (
        <div className="rz-card"><p className="rz-empty" data-testid="reservas-sem-slots">Sem horários livres nos próximos {DIAS_JANELA} dias.</p></div>
      ) : (
        <>
          <div className="rz-card">
            <p className="rz-eyebrow" style={{ marginBottom: '0.6rem' }}>Escolha o dia</p>
            <div className="rz-dates" data-testid="reservas-dias">
              {diasComSlots.map((d) => {
                const r = rotuloDataCurto(d);
                return (
                  <button key={d} type="button" className={`rz-date${d === dia ? ' is-active' : ''}`} data-testid="rz-date" data-dia={d} onClick={() => { setDia(d); setSlot(null); }}>
                    <span className="rz-date-dow">{r.dow}</span>
                    <span className="rz-date-num">{r.num}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rz-card">
            <p className="rz-eyebrow" style={{ marginBottom: '0.6rem' }}>Horários de {rotuloDataLongo(dia)}</p>
            <div className="rz-slots" data-demo-target="reservas-slots" data-testid="reservas-slots">
              {slotsDoDia.map((s) => (
                <button
                  key={s.inicio}
                  type="button"
                  className={`rz-slot${slot && slot.inicio === s.inicio ? ' is-active' : ''}`}
                  data-testid="rz-slot"
                  data-inicio={s.inicio}
                  onClick={() => { setSlot(s); setErro(''); }}
                >
                  {horaDe(s.inicio)}
                </button>
              ))}
            </div>
          </div>

          {slot && (
            <div className="rz-card" data-demo-target="reservas-form" data-testid="reservas-form">
              <p className="rz-eyebrow" style={{ marginBottom: '0.6rem' }}>Os seus dados · {rotuloDataLongo(dia)} às {horaDe(slot.inicio)}</p>
              <div className="rz-stack">
                <label className="rz-field">
                  <span className="rz-label">Nome</span>
                  <input className="rz-input" data-testid="rz-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="O seu nome" />
                </label>
                <label className="rz-field">
                  <span className="rz-label">Email</span>
                  <input className="rz-input" data-testid="rz-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.pt" />
                </label>
                <label className="rz-field">
                  <span className="rz-label">Telemóvel <span className="rz-subtle">(opcional)</span></span>
                  <input className="rz-input" data-testid="rz-telefone" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="+351 …" />
                </label>
                {erro && <p className="rz-small" data-testid="reservas-erro" style={{ color: '#b91c1c', margin: 0 }}>{erro}</p>}
                <button
                  type="button"
                  className="rz-btn rz-btn-primary"
                  data-testid="reservas-confirmar"
                  data-demo-target="reservas-confirmar"
                  disabled={fase === 'submeter'}
                  onClick={confirmar}
                >
                  {fase === 'submeter' ? 'A reservar…' : (tipo.preco != null && tipo.pagamentoObrigatorio ? `Reservar e pagar ${formatEur(tipo.preco)}` : 'Reservar')}
                </button>
              </div>
            </div>
          )}
          {erro && !slot && <p className="rz-small" data-testid="reservas-erro" style={{ color: '#b91c1c' }}>{erro}</p>}
        </>
      )}
    </div>
  );
}

function ResultadoPanel({ fase, tipo, dia, slot, email, telefone, onVoltar }) {
  const confirmada = fase === 'confirmada';
  return (
    <div className="rz-stack" data-testid="reservas-page">
      <div className="rz-card" data-demo-target="reservas-resultado" data-testid="reservas-resultado">
        <span className={`rz-badge${confirmada ? ' rz-badge-ok' : ' rz-badge-warn'}`} data-testid="reservas-estado">
          {confirmada ? 'Reserva confirmada' : 'A aguardar pagamento'}
        </span>

        <div className="rz-result" style={{ marginTop: '0.85rem' }}>
          <p className="rz-strong" style={{ margin: 0 }}>{tipo.nome}</p>
          <p className="rz-small rz-muted" style={{ margin: '0.2rem 0 0' }}>{rotuloDataLongo(dia)} às {horaDe(slot.inicio)}</p>
        </div>

        {confirmada ? (
          <p className="rz-small rz-muted" data-testid="reservas-confirmada-nota" style={{ marginTop: '0.85rem' }}>
            Marcação confirmada. Enviámos os detalhes para {email}.
          </p>
        ) : (
          <div className="rz-pay" data-testid="reservas-pagamento" style={{ marginTop: '0.85rem' }}>
            <p className="rz-small rz-strong" style={{ marginTop: 0 }}>Conclua o pagamento de {formatEur(tipo.preco)}</p>

            <div className="rz-pay-method" data-testid="pay-mbway">
              <p className="rz-strong rz-small" style={{ margin: 0 }}>MB WAY</p>
              <p className="rz-small rz-muted" style={{ margin: '0.2rem 0 0' }}>
                Referência enviada para o seu telemóvel{telefone ? ` (${telefone})` : ''}.
              </p>
            </div>

            <div className="rz-pay-method" data-testid="pay-multibanco">
              <p className="rz-strong rz-small" style={{ margin: 0 }}>Referência Multibanco</p>
              <p className="rz-small" style={{ margin: '0.3rem 0 0' }}>
                Entidade <span className="rz-ref" data-testid="mb-entidade">{MB_ENTIDADE}</span> ·
                Referência <span className="rz-ref" data-testid="mb-referencia">{MB_REFERENCIA}</span>
              </p>
            </div>

            <p className="rz-note" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
              Pagamento de teste — a confirmação chega por callback. A integração real (Ifthenpay) é activada no checkpoint de pagamento.
            </p>
          </div>
        )}

        <button type="button" className="rz-btn rz-btn-ghost" data-testid="reservas-nova" style={{ marginTop: '1rem' }} onClick={onVoltar}>
          Fazer outra marcação
        </button>
      </div>
    </div>
  );
}
