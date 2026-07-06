import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getShared, updateShared, createShared, formatEur, formatDate, registarEvento, appHref } from '../shared.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconGavel, IconCheck, IconMail } from '../components/Icons.jsx';
import { useDemoResult } from '../demo.js';
import { cartaInterpelacao, prepararRequerimento, transitar, PRAZO_OPOSICAO_DIAS } from '../engine/injuncoes.mjs';
import { calcularJuros, calcularTaxaJustica, guardarCalculo } from '../calculos-cliente.js';
import { ESTADO_LABEL, ESTADO_TONE } from './InjuncoesPage.jsx';

/* Passos da submissão ASSISTIDA no BNI (sem API oficial - o compensatório é a
 * proveniência: um evento por passo, brief §3.2.5). */
const PASSOS_BNI = [
  'Rever o requerimento preparado (formato Portaria 220-A/2008, red. 267/2018).',
  'Autenticar-se no Citius/BNI com o certificado profissional.',
  'Transcrever os campos preparados para o formulário do BNI.',
  'Submeter no BNI e guardar o comprovativo no dossiê.',
];

export default function InjuncaoDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const [inj, setInj] = useState(null);
  const [aCorrer, setACorrer] = useState(false);
  const [passosFeitos, setPassosFeitos] = useState({});

  const carregar = async () => {
    const r = await getShared('injuncoes', id);
    setInj(r);
    if (r && r.passosBni) setPassosFeitos(r.passosBni);
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  useDemoResult('injuncao-formula', Boolean(inj && inj.estado === 'formula_executoria'), 'Fórmula executória aposta');

  const ehDemo = Boolean(inj && inj.demo);
  const extraDemo = ehDemo ? { demoSet: inj.demoSet } : {};

  async function calcularJurosETaxa() {
    setACorrer(true);
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      const cobranca = inj.cobrancaId ? await getShared('cobrancas', inj.cobrancaId) : null;
      const vencimento = (cobranca && cobranca.dataVencimento) || inj.dataVencimento;
      if (!vencimento) { toast('Sem data de vencimento no crédito.'); return; }

      const rJuros = await calcularJuros({ valor: inj.capital, dataVencimento: vencimento, dataFim: hoje, tipoJuro: inj.transacaoComercial ? 'comercial' : 'civil' });
      if (!rJuros.ok) { toast(rJuros.error || 'O cálculo de juros falhou.'); return; }
      const jurosRow = await guardarCalculo({ tipo: 'juros', titulo: `Juros - injunção ${inj.descricao || ''}`, injuncaoId: inj.id, resultado: rJuros.resultado, ...(ehDemo ? { demo: true, demoSet: inj.demoSet } : {}) });

      const valorAcao = Math.round((Number(inj.capital) + Number(rJuros.resultado.totalJuros || 0)) * 100) / 100;
      const rTaxa = await calcularTaxaJustica({ valorAcao, tabela: 'I-A', ano: new Date().getFullYear() });
      if (!rTaxa.ok) { toast(rTaxa.error || 'O cálculo da taxa de justiça falhou.'); return; }
      const taxaRow = await guardarCalculo({ tipo: 'custas', titulo: `Taxa de justiça - injunção ${inj.descricao || ''}`, injuncaoId: inj.id, resultado: rTaxa.resultado, ...(ehDemo ? { demo: true, demoSet: inj.demoSet } : {}) });

      const requerimento = prepararRequerimento({
        credor: 'O escritório (mandatário do credor)', devedor: inj.devedor, descricao: inj.descricao,
        capital: inj.capital,
        jurosValor: rJuros.resultado.totalJuros, jurosCalculoId: jurosRow && jurosRow.id,
        taxaJusticaValor: rTaxa.resultado.valor, taxaJusticaCalculoId: taxaRow && taxaRow.id,
      });
      await updateShared('injuncoes', id, { juros: rJuros.resultado, taxaJustica: rTaxa.resultado, requerimento });
      await carregar();
      toast('Juros por troços e taxa de justiça calculados pelo serviço.');
    } catch {
      toast('O serviço de cálculos não respondeu.');
    } finally {
      setACorrer(false);
    }
  }

  async function enviarInterpelacao() {
    setACorrer(true);
    try {
      const jurosTexto = inj.juros
        ? `${formatEur(inj.juros.totalJuros)} (${(inj.juros.trocos || []).length} troço(s), cada um com o seu Aviso citado - memória de cálculo disponível)`
        : null;
      const texto = cartaInterpelacao({
        credor: 'o nosso constituinte', devedor: inj.devedor, descricao: inj.descricao,
        valor: inj.capital, jurosTexto,
      });
      // Registada via legal-correio (linha `correio`): o envio real é simulado
      // pré-checkpoint; nenhum sistema externo é tocado em demonstração.
      await createShared('correio', {
        tipo: 'registado', destinatario: inj.devedor, assunto: `Interpelação - ${inj.descricao || 'crédito'}`,
        corpo: texto, estado: ehDemo ? 'simulado' : 'por_enviar', injuncaoId: inj.id,
        ...(ehDemo ? { demo: true, demoSet: inj.demoSet } : {}),
      });
      await updateShared('injuncoes', id, { interpelacao: { texto, quando: new Date().toISOString() } });
      await registarEvento({ app: 'legal-injuncoes', acao: 'interpelacao-enviada', fundamentacao: 'Interpelação formal registada via legal-correio.', proveniencia: ehDemo ? 'simulada' : 'correio-registado', demo: ehDemo, extra: extraDemo });
      await carregar();
      toast('Interpelação registada no correio.');
    } catch {
      toast('Não foi possível registar a interpelação.');
    } finally {
      setACorrer(false);
    }
  }

  async function marcarPasso(idx) {
    const prox = { ...passosFeitos, [idx]: true };
    setPassosFeitos(prox);
    await updateShared('injuncoes', id, { passosBni: prox });
    await registarEvento({
      app: 'legal-injuncoes', acao: `bni:passo-${idx + 1}`,
      fundamentacao: PASSOS_BNI[idx], proveniencia: ehDemo ? 'simulada' : 'manual-assistido',
      demo: ehDemo, extra: extraDemo,
    });
  }

  async function mudarEstado(novo) {
    try {
      transitar(inj.estado, novo); // valida ruidosamente
    } catch (err) {
      toast(String(err.message || err));
      return;
    }
    setACorrer(true);
    try {
      const patch = { estado: novo, trilho: [...(inj.trilho || []), { acao: novo, quando: new Date().toISOString() }] };
      await updateShared('injuncoes', id, patch);
      await registarEvento({ app: 'legal-injuncoes', acao: `estado:${novo}`, fundamentacao: `Estado da injunção: ${ESTADO_LABEL[novo] || novo}.`, proveniencia: ehDemo ? 'simulada' : 'manual', demo: ehDemo, extra: extraDemo });

      if (novo === 'notificada') {
        // Prazo de oposição de 15 dias entra no radar (legal-prazos é o dono
        // da contagem processual - aqui só se cria a linha).
        const limite = new Date(); limite.setDate(limite.getDate() + PRAZO_OPOSICAO_DIAS);
        await createShared('prazos', {
          descricao: `Oposição à injunção - ${inj.descricao || ''} (${PRAZO_OPOSICAO_DIAS} dias)`,
          dataLimite: limite.toISOString().slice(0, 10), estado: 'pendente',
          injuncaoId: inj.id, ...(ehDemo ? { demo: true, demoSet: inj.demoSet } : {}),
        });
      }
      if (novo === 'formula_executoria') {
        await createShared('tarefas', {
          titulo: `Preparar execução - ${inj.descricao || 'injunção'}`, estado: 'pendente', prioridade: 'alta',
          injuncaoId: inj.id, ...(ehDemo ? { demo: true, demoSet: inj.demoSet } : {}),
        });
      }
      await carregar();
      toast(`Estado: ${ESTADO_LABEL[novo] || novo}.`);
    } catch {
      toast('Não foi possível mudar o estado.');
    } finally {
      setACorrer(false);
    }
  }

  if (!inj) return <EmptyState title="Injunção não encontrada" hint="Volte à lista." />;

  const todosPassos = PASSOS_BNI.every((_, i) => passosFeitos[i]);

  return (
    <div className="stack stack-6" data-demo-page="injuncoes/detalhe" data-testid="injuncao-detalhe">
      <div className="page-header">
        <div>
          <h1 className="page-title">{inj.descricao || 'Injunção'}</h1>
          <p className="card-subtitle">{inj.devedor} · capital {formatEur(inj.capital)} · {inj.elegibilidade ? inj.elegibilidade.fundamento : ''}</p>
        </div>
        <div className="row row-2">
          <Badge tone={ESTADO_TONE[inj.estado] || 'neutral'} data-testid="injuncao-estado">{ESTADO_LABEL[inj.estado] || inj.estado}</Badge>
          <Button variant="secondary" onClick={() => navigate('/')}>Voltar</Button>
        </div>
      </div>

      <section className="card" data-testid="injuncao-calculos" data-demo-target="injuncoes-explicacao">
        <h2 className="card-title">Juros e taxa de justiça (serviço de cálculos)</h2>
        {inj.juros ? (
          <div className="stack stack-2">
            <p className="text-small" style={{ margin: 0 }} data-testid="injuncao-juros">
              Juros de mora: <strong>{formatEur(inj.juros.totalJuros)}</strong> em {(inj.juros.trocos || []).length} troço(s)
              {' - '}{(inj.juros.trocos || []).map((t) => t.aviso).filter(Boolean).join('; ') || 'Avisos citados na memória'}
            </p>
            <p className="text-small" style={{ margin: 0 }} data-testid="injuncao-taxa">
              Taxa de justiça: <strong>{inj.taxaJustica ? formatEur(inj.taxaJustica.valor) : '-'}</strong>
              {inj.taxaJustica ? ` (${inj.taxaJustica.ucCount} UC - ${inj.taxaJustica.citacao || 'RCP, Tabela I'})` : ''}
            </p>
            {inj.requerimento ? (
              <p className="text-small" style={{ margin: 0 }} data-testid="injuncao-total">
                Pedido total do requerimento: <strong>{formatEur(inj.requerimento.pedido.total)}</strong> ({inj.requerimento.formato})
              </p>
            ) : null}
          </div>
        ) : (
          <Button data-testid="injuncao-calcular" data-demo-target="injuncoes-calcular" disabled={aCorrer} onClick={calcularJurosETaxa}>
            Calcular juros por troços + taxa de justiça
          </Button>
        )}
      </section>

      <section className="card" data-testid="injuncao-interpelacao">
        <h2 className="card-title">Interpelação formal</h2>
        {inj.interpelacao ? (
          <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 'var(--sp-3)', borderRadius: 'var(--r-2)', fontSize: '0.8125rem' }} data-testid="interpelacao-texto">
            {inj.interpelacao.texto}
          </pre>
        ) : (
          <>
            <p className="card-subtitle">Carta-modelo com os juros citados pelo serviço; registada via legal-correio.</p>
            <Button data-testid="injuncao-interpelar" data-demo-target="injuncoes-interpelar" disabled={aCorrer} onClick={enviarInterpelacao}>
              <IconMail /> Registar interpelação
            </Button>
          </>
        )}
      </section>

      {inj.estado === 'preparada' ? (
        <section className="card" data-testid="injuncao-bni">
          <h2 className="card-title">Submissão assistida no BNI (Citius)</h2>
          <p className="card-subtitle">
            Não existe API oficial: a plataforma prepara tudo e o mandatário confirma no BNI.
            Cada passo fica registado com proveniência (registo_eventos).
          </p>
          <ol className="stack stack-2" style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {PASSOS_BNI.map((p, i) => (
              <li key={i} className="row row-2" style={{ alignItems: 'center' }}>
                <input type="checkbox" data-testid={`bni-passo-${i}`} data-demo-target={`bni-passo-${i}`} checked={Boolean(passosFeitos[i])} disabled={Boolean(passosFeitos[i])} onChange={() => marcarPasso(i)} />
                <span className="text-small">{p}</span>
              </li>
            ))}
          </ol>
          <Button data-testid="injuncao-submeter" data-demo-target="injuncoes-submeter" disabled={aCorrer || !todosPassos} onClick={() => mudarEstado('submetida')}>
            <IconGavel /> Marcar como submetida
          </Button>
        </section>
      ) : null}

      {inj.estado === 'submetida' ? (
        <section className="card">
          <h2 className="card-title">Notificação do requerido</h2>
          <p className="card-subtitle">Quando o requerido for notificado, o prazo de oposição de {PRAZO_OPOSICAO_DIAS} dias entra no radar de prazos.</p>
          <Button data-testid="injuncao-notificada" data-demo-target="injuncoes-notificada" disabled={aCorrer} onClick={() => mudarEstado('notificada')}>Marcar como notificada</Button>
        </section>
      ) : null}

      {inj.estado === 'notificada' ? (
        <section className="card">
          <h2 className="card-title">Desfecho</h2>
          <div className="row row-2" style={{ flexWrap: 'wrap' }}>
            <Button data-testid="injuncao-formula" data-demo-target="injuncoes-formula" disabled={aCorrer} onClick={() => mudarEstado('formula_executoria')}>
              <IconCheck /> Fórmula executória (sem oposição)
            </Button>
            <Button variant="secondary" data-testid="injuncao-oposicao" disabled={aCorrer} onClick={() => mudarEstado('oposicao')}>Oposição deduzida</Button>
            <Button variant="secondary" data-testid="injuncao-paga" disabled={aCorrer} onClick={() => mudarEstado('pagamento')}>Paga</Button>
          </div>
        </section>
      ) : null}

      {inj.estado === 'formula_executoria' ? (
        <section className="card" data-testid="injuncao-executoria">
          <h2 className="card-title">Fórmula executória aposta</h2>
          <p className="text-small">
            O requerimento vale como título executivo. Foi aberta a tarefa "Preparar execução" e o prazo de oposição ficou no radar.
            Consulte os prazos em <a href={appHref('legal-prazos')} className="stat-link">Prazos</a>.
          </p>
        </section>
      ) : null}
    </div>
  );
}
