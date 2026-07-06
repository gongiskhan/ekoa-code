import { Link } from 'react-router-dom';
import { Badge } from '../components/ui.jsx';
import { IconCalendarClock, IconShieldCheck, IconAlertTriangle, IconCheck, IconExternalLink } from '../components/Icons.jsx';
import { PROVIDER_ORDER, PROVIDERS, TIPO_LABEL } from '../providers.js';

/*
 * Calendário da assinatura qualificada - painel informativo estático, fundado na
 * Portaria n.º 350-A/2025, de 09 de Outubro (Tramitação Eletrónica dos Processos
 * nos Tribunais e Serviços do Ministério Público). É o diferenciador do app: dá
 * ao escritório o calendário e as vias disponíveis, com a fonte citada.
 *
 * Fundamentos (do próprio diploma):
 *  - Artigo 5.º, n.os 3 e 4: a peça processual é assinada digitalmente através de
 *    certificado de assinatura eletrónica qualificada que garanta de forma
 *    permanente a qualidade profissional do signatário, podendo usar-se o Sistema
 *    de Certificação de Atributos Profissionais (SCAP) associado ao Cartão de
 *    Cidadão e à Chave Móvel Digital, ou o Sistema de Certificação Eletrónica do
 *    Estado. As assinaturas admitidas limitam-se à qualificada, para todos os
 *    intervenientes processuais.
 *  - Norma sobre produção de efeitos, n.º 4: o disposto nos n.os 3 e 4 do artigo
 *    5.º produz efeitos a partir de 1 de janeiro de 2027, sendo admitido, até essa
 *    data, que advogados, advogados estagiários e solicitadores assinem
 *    digitalmente através de certificado de assinatura eletrónica AVANÇADA.
 */

const FONTE = 'Portaria n.º 350-A/2025, de 09 de Outubro';

const FASES = [
  {
    id: 'ate-2026',
    quando: 'Até 31 de dezembro de 2026',
    titulo: 'Assinatura avançada ainda admitida',
    tom: 'media',
    texto: 'Advogados, advogados estagiários e solicitadores podem assinar digitalmente as peças processuais através de certificado de assinatura eletrónica avançada. Regime transitório do diploma.',
    fundamento: 'Norma sobre produção de efeitos, n.º 4.',
  },
  {
    id: 'desde-2027',
    quando: 'A partir de 1 de janeiro de 2027',
    titulo: 'Assinatura qualificada obrigatória',
    tom: 'alta',
    texto: 'Passa a ser obrigatória a assinatura eletrónica qualificada para todos os intervenientes processuais, através do SCAP associado ao Cartão de Cidadão e à Chave Móvel Digital, ou do Sistema de Certificação Eletrónica do Estado.',
    fundamento: 'Artigo 5.º, n.os 3 e 4.',
  },
];

export default function CalendarioPage() {
  return (
    <div data-demo-page="assinatura/calendario" data-testid="assinatura-calendario-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendário da assinatura qualificada</h1>
          <p className="page-subtitle">
            O regime da tramitação eletrónica caminha para a assinatura qualificada obrigatória. Este
            calendário resume as datas e as vias disponíveis, com a fonte citada.
          </p>
        </div>
      </div>

      {/* Destaque da data-alvo */}
      <section className="resultado-panel" data-testid="assinatura-calendario-destaque" data-demo-target="assinatura-calendario">
        <div className="row row-2" style={{ alignItems: 'center' }}>
          <span aria-hidden="true" style={{ color: 'var(--accent-strong, #16304c)', display: 'inline-flex' }}><IconCalendarClock /></span>
          <h2 className="card-title" style={{ margin: 0 }}>1 de janeiro de 2027</h2>
        </div>
        <p className="text-muted" style={{ margin: 'var(--sp-2, 0.5rem) 0 0' }}>
          Data a partir da qual a assinatura eletrónica qualificada passa a ser obrigatória para todos os
          intervenientes processuais. Até lá, admite-se a assinatura avançada para advogados, advogados
          estagiários e solicitadores.
        </p>
        <p className="text-subtle text-xs" style={{ margin: 'var(--sp-3, 0.75rem) 0 0' }} data-testid="assinatura-calendario-fonte">
          Fonte: {FONTE}. Artigo 5.º, n.os 3 e 4; norma sobre produção de efeitos, n.º 4.
        </p>
      </section>

      {/* Faseamento */}
      <section className="card" style={{ marginTop: 'var(--sp-5, 1.25rem)' }} aria-label="Faseamento">
        <h2 className="card-title">Faseamento</h2>
        <ul className="passos-list" style={{ listStyle: 'none', margin: 'var(--sp-3, 0.75rem) 0 0', padding: 0 }}>
          {FASES.map((fase) => (
            <li
              key={fase.id}
              className="passo-item"
              data-testid={`assinatura-fase-${fase.id}`}
              style={{
                border: '1px solid var(--line-1, #e2e8f0)',
                borderRadius: 'var(--r-2, 0.5rem)',
                padding: 'var(--sp-3, 0.75rem) var(--sp-4, 1rem)',
                marginBottom: 'var(--sp-3, 0.75rem)',
              }}
            >
              <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-3, 0.75rem)' }}>
                <div className="stack stack-1" style={{ minWidth: 0 }}>
                  <span className="text-strong">{fase.quando}</span>
                  <span className="text-subtle">{fase.titulo}</span>
                </div>
                <Badge tone={fase.tom}>{fase.tom === 'alta' ? 'Qualificada' : 'Avançada'}</Badge>
              </div>
              <p className="text-muted" style={{ margin: 'var(--sp-2, 0.5rem) 0 0' }}>{fase.texto}</p>
              <p className="text-subtle text-xs" style={{ margin: 'var(--sp-2, 0.5rem) 0 0' }}>{fase.fundamento}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Vias de assinatura disponíveis */}
      <section className="card" style={{ marginTop: 'var(--sp-5, 1.25rem)' }} aria-label="Vias de assinatura" data-demo-target="assinatura-vias" data-testid="assinatura-vias">
        <h2 className="card-title">Vias de assinatura</h2>
        <p className="card-subtitle">
          Cada via corresponde a um método de assinatura de um signatário. As vias qualificadas cumprem o
          regime de 2027; a via avançada (Adobe Sign) serve documentos não sujeitos a qualificação.
        </p>
        <ul className="stack stack-3" style={{ listStyle: 'none', margin: 'var(--sp-3, 0.75rem) 0 0', padding: 0 }}>
          {PROVIDER_ORDER.map((key) => {
            const p = PROVIDERS[key];
            return (
              <li
                key={key}
                className="passo-item"
                data-testid={`assinatura-via-${key}`}
                style={{
                  border: '1px solid var(--line-1, #e2e8f0)',
                  borderRadius: 'var(--r-2, 0.5rem)',
                  padding: 'var(--sp-3, 0.75rem) var(--sp-4, 1rem)',
                  background: p.disponivel ? 'var(--surface-1, #f8fafc)' : 'transparent',
                }}
              >
                <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-3, 0.75rem)' }}>
                  <div className="stack stack-1" style={{ minWidth: 0 }}>
                    <div className="row row-2" style={{ alignItems: 'center' }}>
                      <span aria-hidden="true" style={{ display: 'inline-flex', color: p.disponivel ? 'var(--ok, #16a34a)' : 'var(--warn, #b45309)' }}>
                        {p.disponivel ? <IconCheck /> : <IconAlertTriangle />}
                      </span>
                      <span className="text-strong">{p.nome}</span>
                    </div>
                    <p className="text-muted" style={{ margin: 0 }}>{p.resumo || p.motivo || ''}</p>
                    {!p.disponivel && p.motivo ? (
                      <p className="text-subtle text-xs" style={{ margin: 0 }}>{p.motivo}</p>
                    ) : null}
                  </div>
                  <div className="stack stack-1" style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                    <Badge tone={p.tipo === 'qualificada' ? 'ok' : p.tipo === 'avancada' ? 'info' : 'neutral'}>
                      {TIPO_LABEL[p.tipo] || p.tipo}
                    </Badge>
                    <Badge tone={p.disponivel ? 'ok' : 'neutral'}>{p.disponivel ? 'Disponível' : 'Indisponível'}</Badge>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card" style={{ marginTop: 'var(--sp-5, 1.25rem)' }}>
        <div className="row-space-between" style={{ alignItems: 'center', gap: 'var(--sp-3, 0.75rem)', flexWrap: 'wrap' }}>
          <div className="row row-2" style={{ alignItems: 'center' }}>
            <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--accent-strong, #16304c)' }}><IconShieldCheck /></span>
            <span className="text-strong">Preparar um envelope de assinatura</span>
          </div>
          <div className="row row-wrap" style={{ gap: 'var(--sp-2, 0.5rem)' }}>
            <Link to="/novo" className="btn btn-primary btn-sm" data-testid="assinatura-calendario-novo">Novo envelope</Link>
            <a
              href="https://validador.autenticacao.gov.pt"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              data-testid="assinatura-calendario-validador"
            >
              Validador oficial <IconExternalLink />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
