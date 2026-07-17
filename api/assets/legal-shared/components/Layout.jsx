import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  IconScale,
  IconHome,
  IconUsers,
  IconFolder,
  IconCalendar,
  IconInbox,
  IconCoins,
  IconBook,
  IconFileText,
  IconExternalLink,
  IconBell,
  IconTimer,
  IconColumns,
  IconIdCard,
  IconWallet,
  IconReceipt,
  IconClipboardForm,
  IconDoor,
  IconLibrary,
  IconShieldCheck,
  IconShieldAlert,
  IconCalendarClock,
  IconSearchText,
  IconPenLine,
  IconMailbox,
  IconLifeBuoy,
  IconGrid,
  IconSearch,
  IconCalculator,
  IconSignature,
  IconMic,
  IconChartBar,
  IconTrendingDown,
  IconGavel,
  IconBuilding,
} from './Icons.jsx';
import { appHref, useSharedCollection, markLida } from '../shared.js';

/*
 * Registo dos VINTE E OITO apps da suite jurídica. É a ÚNICA fonte da identidade
 * de cada app (marca, secção, grupo, navegação, título, meta) e do modo como
 * cada um é referido no lançador dos outros. O Layout resolve o app actual por
 * `window.__EKOA_APP_ID`; qualquer prop passada ao Layout sobrepõe-se ao registo.
 *
 * NOTA para os apps novos: o `nav` aqui registado é o mínimo (uma entrada).
 * Cada app passa o seu `nav` real como prop ao Layout a partir do próprio
 * App.jsx - assim os agentes de cada app nunca editam este ficheiro partilhado.
 *
 * `group` liga o app a APP_GROUPS (lançador agrupado). O artefacto público
 * `legal-agenda-reservas` NÃO consta do registo de propósito - é a face pública
 * da agenda, não um 22.º mosaico.
 */
const APPS = {
  'legal-nucleo': {
    key: 'nucleo',
    brand: 'Núcleo',
    group: 'gestao',
    sectionLabel: 'Gestão',
    titleFallback: 'Núcleo Jurídico',
    meta: 'O núcleo partilhado de clientes e processos.',
    launcherLabel: 'Núcleo',
    launcherIcon: IconHome,
    nav: [
      { to: '/', label: 'Início', icon: IconHome, end: true, testid: 'nav-inicio' },
      { to: '/clientes', label: 'Clientes', icon: IconUsers, testid: 'nav-clientes' },
      { to: '/processos', label: 'Processos', icon: IconFolder, testid: 'nav-processos' },
    ],
    titleMap: { '/': 'Início', '/clientes': 'Clientes', '/processos': 'Processos' },
  },
  'legal-prazos': {
    key: 'prazos',
    brand: 'Prazos',
    group: 'processual',
    sectionLabel: 'Cálculo',
    titleFallback: 'Prazos Jurídicos',
    meta: 'Cálculo determinístico de prazos processuais (CPC).',
    launcherLabel: 'Prazos',
    launcherIcon: IconCalendar,
    nav: [{ to: '/', label: 'Prazos', icon: IconCalendar, end: true, testid: 'nav-prazos' }],
    titleMap: { '/': 'Prazos' },
  },
  'legal-citius': {
    key: 'citius',
    brand: 'Caixa Citius',
    group: 'processual',
    sectionLabel: 'Triagem',
    titleFallback: 'Caixa Citius',
    meta: 'Triagem determinística de notificações Citius.',
    launcherLabel: 'Caixa Citius',
    launcherIcon: IconInbox,
    nav: [{ to: '/', label: 'Caixa Citius', icon: IconInbox, end: true, testid: 'nav-citius' }],
    titleMap: { '/': 'Caixa Citius' },
  },
  'legal-dossie': {
    key: 'dossie',
    brand: 'Dossiê',
    group: 'processual',
    sectionLabel: 'Compilação',
    titleFallback: 'Dossiê do Processo',
    meta: 'Compila o dossiê completo de um processo, pronto a guardar em PDF.',
    launcherLabel: 'Dossiê',
    launcherIcon: IconBook,
    printChrome: true,
    nav: [{ to: '/', label: 'Dossiê', icon: IconBook, end: true, testid: 'nav-dossie' }],
    titleMap: { '/': 'Dossiê' },
  },
  'legal-honorarios': {
    key: 'honorarios',
    brand: 'Honorários',
    group: 'financeiro',
    sectionLabel: 'Pré-faturação',
    titleFallback: 'Honorários Jurídicos',
    meta: 'Pré-faturas determinísticas de honorários - nunca emite fatura.',
    launcherLabel: 'Honorários',
    launcherIcon: IconCoins,
    nav: [{ to: '/', label: 'Honorários', icon: IconCoins, end: true, testid: 'nav-honorarios' }],
    titleMap: { '/': 'Honorários' },
  },
  'legal-contratos': {
    key: 'contratos',
    brand: 'Contratos',
    group: 'documentos',
    sectionLabel: 'Documentos',
    titleFallback: 'Contratos Jurídicos',
    meta: 'Contratos e procurações em .docx - limpos, editáveis, com as cláusulas-padrão.',
    launcherLabel: 'Contratos',
    launcherIcon: IconFileText,
    nav: [{ to: '/', label: 'Contratos', icon: IconFileText, end: true, testid: 'nav-contratos' }],
    titleMap: { '/': 'Contratos' },
  },
  'legal-kanban': {
    key: 'kanban',
    brand: 'Quadro',
    group: 'gestao',
    sectionLabel: 'Tarefas',
    titleFallback: 'Quadro de Tarefas',
    meta: 'Quadro de tarefas com colunas configuráveis sobre a espinha partilhada.',
    launcherLabel: 'Quadro',
    launcherIcon: IconColumns,
    nav: [{ to: '/', label: 'Quadro', icon: IconColumns, end: true, testid: 'nav-kanban' }],
    titleMap: { '/': 'Quadro' },
  },
  'legal-recursos': {
    key: 'recursos',
    brand: 'Recursos Humanos',
    group: 'gestao',
    sectionLabel: 'Equipa',
    titleFallback: 'Recursos Humanos',
    meta: 'Fichas, férias e ausências e alocação da equipa aos processos.',
    launcherLabel: 'Recursos Humanos',
    launcherIcon: IconIdCard,
    nav: [{ to: '/', label: 'Pessoas', icon: IconIdCard, end: true, testid: 'nav-recursos' }],
    titleMap: { '/': 'Pessoas' },
  },
  'legal-tempos': {
    key: 'tempos',
    brand: 'Tempos',
    group: 'gestao',
    sectionLabel: 'Registo',
    titleFallback: 'Registo de Tempos',
    meta: 'Registo de tempos por processo e tarefa, com temporizador.',
    launcherLabel: 'Tempos',
    launcherIcon: IconTimer,
    nav: [{ to: '/', label: 'Tempos', icon: IconTimer, end: true, testid: 'nav-tempos' }],
    titleMap: { '/': 'Tempos' },
  },
  'legal-agenda': {
    key: 'agenda',
    brand: 'Agenda',
    group: 'gestao',
    sectionLabel: 'Agenda',
    titleFallback: 'Agenda e Marcações',
    meta: 'Agenda partilhada, audiências e marcações com reserva pública.',
    launcherLabel: 'Agenda',
    launcherIcon: IconCalendarClock,
    nav: [{ to: '/', label: 'Agenda', icon: IconCalendarClock, end: true, testid: 'nav-agenda' }],
    titleMap: { '/': 'Agenda' },
  },
  'legal-pecas': {
    key: 'pecas',
    brand: 'Peças',
    group: 'processual',
    sectionLabel: 'Redação',
    titleFallback: 'Redação de Peças',
    meta: 'Redação de peças processuais a partir do processo e dos precedentes.',
    launcherLabel: 'Peças',
    launcherIcon: IconPenLine,
    nav: [{ to: '/', label: 'Peças', icon: IconPenLine, end: true, testid: 'nav-pecas' }],
    titleMap: { '/': 'Peças' },
  },
  'legal-pesquisa': {
    key: 'pesquisa',
    brand: 'Pesquisa',
    group: 'processual',
    sectionLabel: 'Investigação',
    titleFallback: 'Pesquisa Jurídica',
    meta: 'Pesquisa jurídica fundamentada em DGSI e DRE, com citações verificáveis.',
    launcherLabel: 'Pesquisa',
    launcherIcon: IconSearchText,
    nav: [{ to: '/', label: 'Pesquisa', icon: IconSearchText, end: true, testid: 'nav-pesquisa' }],
    titleMap: { '/': 'Pesquisa' },
  },
  'legal-apoio': {
    key: 'apoio',
    brand: 'Apoio Judiciário',
    group: 'processual',
    sectionLabel: 'Apoio',
    titleFallback: 'Apoio Judiciário',
    meta: 'Apoio judiciário: nomeações, prazos SinOA e pedidos de honorários.',
    launcherLabel: 'Apoio Judiciário',
    launcherIcon: IconLifeBuoy,
    nav: [{ to: '/', label: 'Apoio Judiciário', icon: IconLifeBuoy, end: true, testid: 'nav-apoio' }],
    titleMap: { '/': 'Apoio Judiciário' },
  },
  'legal-financas': {
    key: 'financas',
    brand: 'Finanças',
    group: 'financeiro',
    sectionLabel: 'Contabilidade',
    titleFallback: 'Finanças e Contabilidade',
    meta: 'Despesas, conta corrente e provisões; faturação certificada via integração.',
    launcherLabel: 'Finanças',
    launcherIcon: IconWallet,
    nav: [{ to: '/', label: 'Finanças', icon: IconWallet, end: true, testid: 'nav-financas' }],
    titleMap: { '/': 'Finanças' },
  },
  'legal-cobrancas': {
    key: 'cobrancas',
    brand: 'Cobranças',
    group: 'financeiro',
    sectionLabel: 'Cobranças',
    titleFallback: 'Cobranças',
    meta: 'Sequências de lembretes e pagamentos por referência ou ligação.',
    launcherLabel: 'Cobranças',
    launcherIcon: IconReceipt,
    nav: [{ to: '/', label: 'Cobranças', icon: IconReceipt, end: true, testid: 'nav-cobrancas' }],
    titleMap: { '/': 'Cobranças' },
  },
  'legal-modelos': {
    key: 'modelos',
    brand: 'Modelos',
    group: 'documentos',
    sectionLabel: 'Biblioteca',
    titleFallback: 'Biblioteca de Modelos',
    meta: 'Biblioteca de minutas oficiais, com versões e promoção a contratos.',
    launcherLabel: 'Modelos',
    launcherIcon: IconLibrary,
    nav: [{ to: '/', label: 'Modelos', icon: IconLibrary, end: true, testid: 'nav-modelos' }],
    titleMap: { '/': 'Modelos' },
  },
  'legal-forms': {
    key: 'forms',
    brand: 'Formulários',
    group: 'documentos',
    sectionLabel: 'Formulários',
    titleFallback: 'Preenchimento de Formulários',
    meta: 'Preenchimento inteligente de formulários oficiais em PDF.',
    launcherLabel: 'Formulários',
    launcherIcon: IconClipboardForm,
    nav: [{ to: '/', label: 'Formulários', icon: IconClipboardForm, end: true, testid: 'nav-forms' }],
    titleMap: { '/': 'Formulários' },
  },
  'legal-correio': {
    key: 'correio',
    brand: 'Correio',
    group: 'documentos',
    sectionLabel: 'Expediente',
    titleFallback: 'Correio e Notificações',
    meta: 'Correio registado associado a processos, com comprovativos arquivados.',
    launcherLabel: 'Correio',
    launcherIcon: IconMailbox,
    nav: [{ to: '/', label: 'Correio', icon: IconMailbox, end: true, testid: 'nav-correio' }],
    titleMap: { '/': 'Correio' },
  },
  'legal-portal': {
    key: 'portal',
    brand: 'Portal do Cliente',
    group: 'clientes',
    sectionLabel: 'Portal',
    titleFallback: 'Portal do Cliente',
    meta: 'Portal do cliente: estado do processo, documentos e mensagens.',
    launcherLabel: 'Portal do Cliente',
    launcherIcon: IconDoor,
    nav: [{ to: '/', label: 'Portal', icon: IconDoor, end: true, testid: 'nav-portal' }],
    titleMap: { '/': 'Portal' },
  },
  'legal-conflitos': {
    key: 'conflitos',
    brand: 'Conflitos',
    group: 'clientes',
    sectionLabel: 'Conformidade',
    titleFallback: 'Verificação de Conflitos',
    meta: 'Verificação de conflitos de interesses na abertura de dossiês.',
    launcherLabel: 'Conflitos',
    launcherIcon: IconShieldAlert,
    nav: [{ to: '/', label: 'Conflitos', icon: IconShieldAlert, end: true, testid: 'nav-conflitos' }],
    titleMap: { '/': 'Conflitos' },
  },
  'legal-kyc': {
    key: 'kyc',
    brand: 'KYC',
    group: 'clientes',
    sectionLabel: 'Conformidade',
    titleFallback: 'KYC e Diligência',
    meta: 'Identificação e diligência de clientes (Lei n.º 83/2017).',
    launcherLabel: 'KYC',
    launcherIcon: IconShieldCheck,
    nav: [{ to: '/', label: 'KYC', icon: IconShieldCheck, end: true, testid: 'nav-kyc' }],
    titleMap: { '/': 'KYC' },
  },
  'legal-calculos': {
    key: 'calculos',
    brand: 'Cálculos',
    group: 'processual',
    sectionLabel: 'Cálculo',
    titleFallback: 'Cálculos Jurídicos',
    meta: 'Juros, taxa de justiça e memórias de cálculo - todo o cálculo cita a fonte.',
    launcherLabel: 'Cálculos',
    launcherIcon: IconCalculator,
    nav: [{ to: '/', label: 'Cálculos', icon: IconCalculator, end: true, testid: 'nav-calculos' }],
    titleMap: { '/': 'Cálculos' },
  },
  'legal-assinatura': {
    key: 'assinatura',
    brand: 'Assinatura',
    group: 'documentos',
    sectionLabel: 'Assinatura',
    titleFallback: 'Assinatura Qualificada',
    meta: 'Envelopes de assinatura, arquivo probatório e verificação de documentos.',
    launcherLabel: 'Assinatura',
    launcherIcon: IconSignature,
    nav: [{ to: '/', label: 'Assinatura', icon: IconSignature, end: true, testid: 'nav-assinatura' }],
    titleMap: { '/': 'Assinatura' },
  },
  'legal-injuncoes': {
    key: 'injuncoes',
    brand: 'Injunções',
    group: 'processual',
    sectionLabel: 'Recuperação',
    titleFallback: 'Injunções',
    meta: 'Da interpelação à fórmula executória - a fase judicial da cobrança.',
    launcherLabel: 'Injunções',
    launcherIcon: IconGavel,
    nav: [{ to: '/', label: 'Injunções', icon: IconGavel, end: true, testid: 'nav-injuncoes' }],
    titleMap: { '/': 'Injunções' },
  },
  'legal-transcricao': {
    key: 'transcricao',
    brand: 'Transcrição',
    group: 'processual',
    sectionLabel: 'Audiências',
    titleFallback: 'Transcrição de Audiências',
    meta: 'Transcrição de gravações de audiência com excertos prontos para recurso.',
    launcherLabel: 'Transcrição',
    launcherIcon: IconMic,
    nav: [{ to: '/', label: 'Transcrição', icon: IconMic, end: true, testid: 'nav-transcricao' }],
    titleMap: { '/': 'Transcrição' },
  },
  'legal-rcbe': {
    key: 'rcbe',
    brand: 'Beneficiário Efetivo',
    group: 'clientes',
    sectionLabel: 'Conformidade',
    titleFallback: 'Beneficiário Efetivo',
    meta: 'Obrigações RCBE das entidades clientes, com declarações preparadas.',
    launcherLabel: 'Beneficiário Efetivo',
    launcherIcon: IconBuilding,
    nav: [{ to: '/', label: 'RCBE', icon: IconBuilding, end: true, testid: 'nav-rcbe' }],
    titleMap: { '/': 'RCBE' },
  },
  'legal-insolvencias': {
    key: 'insolvencias',
    brand: 'Insolvências',
    group: 'financeiro',
    sectionLabel: 'Créditos',
    titleFallback: 'Insolvências',
    meta: 'Reclamação de créditos, graduação e rateios do lado do credor.',
    launcherLabel: 'Insolvências',
    launcherIcon: IconTrendingDown,
    nav: [{ to: '/', label: 'Insolvências', icon: IconTrendingDown, end: true, testid: 'nav-insolvencias' }],
    titleMap: { '/': 'Insolvências' },
  },
  'legal-jurimetria': {
    key: 'jurimetria',
    brand: 'Jurimetria',
    group: 'processual',
    sectionLabel: 'Estatística',
    titleFallback: 'Jurimetria',
    meta: 'Durações médias por área com fonte citada e comparação interna - estatística, nunca previsão.',
    launcherLabel: 'Jurimetria',
    launcherIcon: IconChartBar,
    nav: [{ to: '/', label: 'Jurimetria', icon: IconChartBar, end: true, testid: 'nav-jurimetria' }],
    titleMap: { '/': 'Jurimetria' },
  },
};

/* Grupos do lançador, pela ordem canónica de apresentação. */
const APP_GROUPS = [
  { id: 'gestao', label: 'Gestão' },
  { id: 'processual', label: 'Processual' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'clientes', label: 'Clientes e Conformidade' },
];

const APP_ORDER = [
  'legal-nucleo',
  'legal-kanban',
  'legal-agenda',
  'legal-tempos',
  'legal-recursos',
  'legal-prazos',
  'legal-citius',
  'legal-dossie',
  'legal-pecas',
  'legal-pesquisa',
  'legal-apoio',
  'legal-honorarios',
  'legal-financas',
  'legal-cobrancas',
  'legal-contratos',
  'legal-modelos',
  'legal-forms',
  'legal-correio',
  'legal-portal',
  'legal-conflitos',
  'legal-kyc',
  'legal-calculos',
  'legal-assinatura',
  'legal-injuncoes',
  'legal-transcricao',
  'legal-rcbe',
  'legal-insolvencias',
  'legal-jurimetria',
];

// Map a short key ('nucleo') or a full id ('legal-nucleo') to a registered id.
function normalizeKey(k) {
  if (!k) return null;
  if (APPS[k]) return k;
  const byKey = APP_ORDER.find((id) => APPS[id].key === k);
  return byKey || null;
}

/*
 * Resolve which app's identity to render, in precedence order:
 *   1. explicit `appKey` prop  (App.jsx passes it; survives forks)
 *   2. window.__EKOA_APP_ID    (correct for the featured build, wrong for a
 *                               FORK served at /apps/<uuid>/ - hence the prop)
 *   3. served path /apps/legal-xxx/  (works when slug/legal-served)
 *   4. document.title match against a known brand
 *   5. legal-nucleo, as a last resort only.
 */
function resolveAppId(appKey) {
  const explicit = normalizeKey(appKey);
  if (explicit) return explicit;
  if (typeof window !== 'undefined') {
    const injected = window.__EKOA_APP_ID;
    if (injected && APPS[injected]) return injected;
    const path = (window.location && window.location.pathname) || '';
    const m = path.match(/\/apps\/(legal-[a-z-]+)(?:\/|$)/);
    if (m && APPS[m[1]]) return m[1];
    const title = (typeof document !== 'undefined' && document.title ? document.title : '').toLowerCase();
    if (title) {
      const hit = APP_ORDER.find((id) => title.includes(APPS[id].brand.toLowerCase()));
      if (hit) return hit;
    }
  }
  return 'legal-nucleo';
}

/* Normalização para pesquisa: minúsculas e sem diacríticos. */
function foldText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/* Data relativa, curta e em PT-PT: "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias". */
function relativeTime(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  return `há ${d} dias`;
}

/*
 * Sino de notificações - lê a colecção partilhada `notificacoes`, mostra o
 * número de não-lidas e um menu com as 8 mais recentes. Clicar num item marca-o
 * como lido e, se tiver `href`, navega (seguro entre apps via location.href).
 */
function NotificationsBell() {
  const { items, refresh } = useSharedCollection('notificacoes');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const list = Array.isArray(items) ? items : [];
  const unread = list.filter((n) => !n.lida).length;
  const latest = [...list]
    .sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime())
    .slice(0, 8);

  const onItem = async (n) => {
    try {
      if (n && !n.lida && n.id != null) await markLida(n.id);
    } catch { /* não fatal */ }
    if (n && n.href) {
      window.location.href = n.href;
      return;
    }
    await refresh();
    setOpen(false);
  };

  const onMarkAll = async () => {
    try {
      await Promise.all(list.filter((n) => !n.lida && n.id != null).map((n) => markLida(n.id)));
    } catch { /* não fatal */ }
    await refresh();
  };

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="bell-button"
        data-testid="bell"
        aria-label={`Notificações${unread > 0 ? ` (${unread} por ler)` : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconBell />
        {unread > 0 && (
          <span className="bell-badge" data-testid="bell-badge">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="bell-menu" data-testid="bell-menu" role="menu">
          <div className="bell-menu-head">
            <span className="bell-menu-title">Notificações</span>
            {unread > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onMarkAll}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          {latest.length === 0 ? (
            <div className="bell-empty">Sem notificações.</div>
          ) : (
            <ul className="bell-list">
              {latest.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`bell-item${n.lida ? '' : ' is-unread'}`}
                    data-testid="bell-item"
                    role="menuitem"
                    onClick={() => onItem(n)}
                  >
                    <span className="bell-item-title">{n.titulo || 'Notificação'}</span>
                    {n.corpo && <span className="bell-item-body">{n.corpo}</span>}
                    <span className="bell-item-date">{relativeTime(n.data)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * Painel "Todas as aplicações" - o lançador completo, à escala de 21 apps.
 * Campo de pesquisa (insensível a diacríticos) + grupos com mosaicos de ícone.
 * Acessível por teclado: Escape fecha, setas percorrem os mosaicos visíveis,
 * o foco entra na pesquisa ao abrir e regressa ao botão ao fechar.
 */
function LauncherPanel({ appId, onClose }) {
  const [query, setQuery] = useState('');
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (searchRef.current) searchRef.current.focus();
  }, []);

  useEffect(() => {
    // Captura: o Escape fecha SÓ o painel (não chega aos listeners de bolha,
    // p. ex. o sino) e o Tab fica preso dentro do diálogo (aria-modal real).
    const focusables = () => (panelRef.current
      ? Array.from(panelRef.current.querySelectorAll('input, button, a.launcher-tile, button.launcher-tile'))
      : []);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const els = focusables();
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!panelRef.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const tiles = focusables().filter((el) => el.classList.contains('launcher-tile'));
        if (tiles.length === 0) return;
        e.preventDefault();
        const idx = tiles.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown'
          ? tiles[Math.min(idx + 1, tiles.length - 1)] || tiles[0]
          : idx <= 0 ? searchRef.current : tiles[idx - 1];
        if (next) next.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const folded = foldText(query.trim());
  const groups = useMemo(() => APP_GROUPS.map((g) => ({
    ...g,
    apps: APP_ORDER
      .filter((id) => APPS[id].group === g.id)
      .filter((id) => {
        if (!folded) return true;
        const a = APPS[id];
        return foldText(`${a.launcherLabel} ${a.brand} ${a.meta}`).includes(folded);
      })
      .map((id) => ({ id, ...APPS[id], isCurrent: id === appId })),
  })).filter((g) => g.apps.length > 0), [folded, appId]);

  return (
    <div className="launcher-overlay" data-testid="launcher-panel" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="launcher-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Lançador de aplicações"
        ref={panelRef}
      >
        <div className="launcher-head">
          <span className="launcher-panel-title">Todas as aplicações</span>
          <button type="button" className="btn btn-ghost btn-sm" data-testid="launcher-close" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="launcher-search">
          <IconSearch aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder="Pesquisar aplicações"
            aria-label="Pesquisar aplicações"
            data-testid="launcher-search"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {groups.length === 0 ? (
          <div className="launcher-empty" data-testid="launcher-empty">Sem resultados para a pesquisa.</div>
        ) : (
          groups.map((g) => (
            <div key={g.id} className="launcher-group" role="group" aria-label={g.label}>
              <span className="launcher-group-label">{g.label}</span>
              <div className="launcher-panel-grid">
                {g.apps.map((a) => (a.isCurrent ? (
                  <button
                    key={a.id}
                    type="button"
                    className="launcher-tile is-current"
                    data-testid={`launcher-${a.key}`}
                    aria-current="page"
                    onClick={onClose}
                  >
                    <span className="launcher-tile-icon" aria-hidden="true"><a.launcherIcon size={20} /></span>
                    <span className="launcher-tile-label">{a.launcherLabel}</span>
                  </button>
                ) : (
                  <a
                    key={a.id}
                    href={appHref(a.id)}
                    className="launcher-tile"
                    data-testid={`launcher-${a.key}`}
                  >
                    <span className="launcher-tile-icon" aria-hidden="true"><a.launcherIcon size={20} /></span>
                    <span className="launcher-tile-label">{a.launcherLabel}</span>
                  </a>
                )))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/*
 * Moldura partilhada de todos os apps da suite jurídica. Todas as props são
 * opcionais - na sua ausência, a identidade vem do registo via __EKOA_APP_ID.
 */
export default function Layout({ children, appKey, nav, appName, tagline, sectionLabel, meta, titleMap }) {
  const location = useLocation();
  const appId = resolveAppId(appKey);
  const reg = APPS[appId] || APPS['legal-nucleo'];

  const navItems = nav ?? reg.nav;
  const brand = appName ?? reg.brand;
  const brandTagline = tagline ?? 'Edição jurídica';
  const section = sectionLabel ?? reg.sectionLabel;
  const metaText = meta ?? reg.meta;
  const titles = titleMap ?? reg.titleMap;
  const title = (titles && titles[location.pathname]) || reg.titleFallback;
  const chromeHidden = reg.printChrome ? ' no-print' : '';

  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherBtnRef = useRef(null);

  // Indicação permanente de dados de demonstração (espinha `demo_estado`):
  // enquanto o conjunto demo estiver instalado, TODAS as apps mostram a faixa.
  // Silencioso em caso de falha - a faixa nunca bloqueia a app.
  const { items: demoEstado } = useSharedCollection('demo_estado');
  const demoAtiva = Array.isArray(demoEstado) && demoEstado.some((r) => r && r.ativo);

  // Vizinhos: os OUTROS apps do grupo do app actual (acesso a um clique),
  // pela ordem canónica. O resto vive no painel "Todas as aplicações".
  const siblings = APP_ORDER
    .filter((id) => id !== appId && APPS[id].group === reg.group)
    .map((id) => ({
      href: appHref(id),
      label: APPS[id].launcherLabel,
      icon: APPS[id].launcherIcon,
      testid: `launcher-side-${APPS[id].key}`,
    }));

  const closeLauncher = () => {
    setLauncherOpen(false);
    if (launcherBtnRef.current) launcherBtnRef.current.focus();
  };

  return (
    <div className="app-shell">
      {demoAtiva ? (
        <div className={`demo-banner${chromeHidden}`} data-testid="demo-banner" role="status">
          Dados de demonstração instalados - Fonseca &amp; Associados. Nenhuma ação toca sistemas externos reais.
        </div>
      ) : null}
      <aside className={`sidebar${chromeHidden}`} aria-label="Navegação principal">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon" aria-hidden="true">
            <IconScale />
          </div>
          <div>
            <span className="sidebar-brand-text">{brand}</span>
            <span className="sidebar-brand-tagline">{brandTagline}</span>
          </div>
        </div>

        <div className="stack stack-2">
          <span className="nav-section-label">{section}</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-testid={item.testid}
                className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
              >
                {Icon ? <Icon /> : null}
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>

        <div className="stack stack-2">
          <span className="nav-section-label">Edição jurídica</span>
          {siblings.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.href}
                href={item.href}
                data-testid={item.testid}
                className="nav-link nav-launcher"
              >
                <Icon />
                <span>{item.label}</span>
                <span className="nav-launcher-mark" aria-hidden="true"><IconExternalLink /></span>
              </a>
            );
          })}
          <button
            type="button"
            ref={launcherBtnRef}
            className="nav-link nav-launcher launcher-all-btn"
            data-testid="launcher-all"
            aria-haspopup="dialog"
            aria-expanded={launcherOpen}
            onClick={() => setLauncherOpen(true)}
          >
            <IconGrid />
            <span>Todas as aplicações</span>
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className={`top-bar${chromeHidden}`}>
          <span className="top-bar-title">{title}</span>
          <div className="top-bar-actions">
            {metaText && <span className="top-bar-meta">{metaText}</span>}
            <NotificationsBell />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      {launcherOpen && <LauncherPanel appId={appId} onClose={closeLauncher} />}
    </div>
  );
}
