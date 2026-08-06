import { useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { ToastHost } from './components/ui.jsx';
import {
  IconPainel, IconDividas, IconClientes, IconPerfis, IconFila, IconBanco, IconDefinicoes,
} from './components/Icons.jsx';
import { LangContext } from './i18n.js';
import { DefinicoesContext } from './hooks.js';
import { carregarDefinicoes, gravarDefinicoes } from './ekoa.js';
import { semearOmissao } from './dados-omissao.js';
import PainelPage from './pages/PainelPage.jsx';
import DividasPage from './pages/DividasPage.jsx';
import DividaDetailPage from './pages/DividaDetailPage.jsx';
import NovaDividaPage from './pages/NovaDividaPage.jsx';
import ClientesPage from './pages/ClientesPage.jsx';
import ClienteDetailPage from './pages/ClienteDetailPage.jsx';
import PerfisPage from './pages/PerfisPage.jsx';
import FilaPage from './pages/FilaPage.jsx';
import ReconciliacaoPage from './pages/ReconciliacaoPage.jsx';
import DefinicoesPage from './pages/DefinicoesPage.jsx';

// Cobranças - recuperação de créditos do escritório. Lê os clientes da base
// COMUM do espaço de trabalho (espinha partilhada `clientes`) e as pré-faturas
// emitidas do Honorários (leitura estrita); todo o restante estado vive nas
// coleções próprias da app.
const NAV = [
  { to: '/', pt: 'Painel', en: 'Dashboard', icon: IconPainel, end: true, demoTarget: 'nav-painel', testid: 'nav-painel' },
  { to: '/dividas', pt: 'Dívidas', en: 'Debts', icon: IconDividas, demoTarget: 'nav-dividas', testid: 'nav-dividas' },
  { to: '/clientes', pt: 'Clientes', en: 'Customers', icon: IconClientes, demoTarget: 'nav-clientes', testid: 'nav-clientes' },
  { to: '/fila', pt: 'Fila de trabalho', en: 'Work queue', icon: IconFila, demoTarget: 'nav-fila', testid: 'nav-fila' },
  { to: '/reconciliacao', pt: 'Reconciliação', en: 'Reconciliation', icon: IconBanco, demoTarget: 'nav-reconciliacao', testid: 'nav-reconciliacao' },
  { to: '/perfis', pt: 'Perfis', en: 'Profiles', icon: IconPerfis, demoTarget: 'nav-perfis', testid: 'nav-perfis' },
  { to: '/definicoes', pt: 'Definições', en: 'Settings', icon: IconDefinicoes, demoTarget: 'nav-definicoes', testid: 'nav-definicoes' },
];

const TITULOS = {
  '/': { pt: 'Painel de envelhecimento', en: 'Ageing dashboard' },
  '/dividas': { pt: 'Dívidas', en: 'Debts' },
  '/nova': { pt: 'Nova dívida', en: 'New debt' },
  '/clientes': { pt: 'Clientes', en: 'Customers' },
  '/fila': { pt: 'Fila de trabalho', en: 'Work queue' },
  '/reconciliacao': { pt: 'Reconciliação bancária', en: 'Bank reconciliation' },
  '/perfis': { pt: 'Perfis de cobrança', en: 'Collection profiles' },
  '/definicoes': { pt: 'Definições', en: 'Settings' },
};

/** Regista a superfície operável para o runtime de ações do assistente. */
function RegistoEkoaApp() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    window.__cobrancasRota = location.pathname;
  }, [location]);
  useEffect(() => {
    const anterior = window.__ekoaApp;
    // Ações `custom` do manifesto de UI: navegam para a página responsável e
    // deixam uma intenção pendente que a página consome ao montar.
    const comIntencao = (rota, intencao) => () => {
      window.__cobrancasAcaoPendente = intencao;
      navigate(rota);
      return { status: 'done' };
    };
    window.__ekoaApp = {
      ...(anterior || {}),
      navigate: (rota) => navigate(String(rota || '/')),
      get route() { return window.__cobrancasRota || '/'; },
      actions: {
        ...(anterior && anterior.actions),
        'sincronizar-honorarios': comIntencao('/dividas', 'sincronizar'),
        'executar-correspondencia': comIntencao('/reconciliacao', 'corresponder'),
        'processar-lembretes': comIntencao('/fila', 'processar'),
      },
    };
    return () => { window.__ekoaApp = anterior; };
  }, [navigate]);
  return null;
}

export default function App() {
  const [lang, setLangState] = useState('pt');
  const [definicoes, setDefinicoes] = useState(null);

  // Arranque: lê as definições (idioma incluído) da coleção da app.
  const recarregarDefinicoes = useCallback(async () => {
    const d = await carregarDefinicoes();
    setDefinicoes(d);
    const idioma = d.idioma === 'en' ? 'en' : 'pt';
    setLangState(idioma);
    window.__COBRANCAS_LANG = idioma;
    return d;
  }, []);

  // Arranque vazio (instância featured/nova): semeia perfis, tipos de ação e
  // definições por omissão ANTES de ler as definições - idempotente.
  useEffect(() => {
    semearOmissao().then(() => recarregarDefinicoes()).catch(() => {});
  }, [recarregarDefinicoes]);

  // Trocar o idioma: efeito imediato + persistência servidor-side.
  const setLang = useCallback((novo) => {
    if (novo !== 'pt' && novo !== 'en') return;
    setLangState(novo);
    window.__COBRANCAS_LANG = novo;
    setDefinicoes((atual) => {
      if (atual && atual.id) {
        gravarDefinicoes(atual.id, { idioma: novo }).catch(() => {});
        return { ...atual, idioma: novo };
      }
      return atual;
    });
  }, []);

  const atualizarDefinicoes = useCallback(async (patch) => {
    let atualizada = null;
    setDefinicoes((atual) => atual ? { ...atual, ...patch } : atual);
    if (definicoes && definicoes.id) {
      atualizada = await gravarDefinicoes(definicoes.id, patch);
    }
    return atualizada;
  }, [definicoes]);

  const langCtx = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  const defCtx = useMemo(
    () => ({ definicoes, atualizarDefinicoes, recarregarDefinicoes }),
    [definicoes, atualizarDefinicoes, recarregarDefinicoes],
  );

  return (
    <LangContext.Provider value={langCtx}>
      <DefinicoesContext.Provider value={defCtx}>
        <RegistoEkoaApp />
        <Layout nav={NAV} titulos={TITULOS}>
          <Routes>
            <Route path="/" element={<PainelPage />} />
            <Route path="/dividas" element={<DividasPage />} />
            <Route path="/dividas/:id" element={<DividaDetailPage />} />
            <Route path="/nova" element={<NovaDividaPage />} />
            <Route path="/clientes" element={<ClientesPage />} />
            <Route path="/clientes/:id" element={<ClienteDetailPage />} />
            <Route path="/perfis" element={<PerfisPage />} />
            <Route path="/fila" element={<FilaPage />} />
            <Route path="/reconciliacao" element={<ReconciliacaoPage />} />
            <Route path="/definicoes" element={<DefinicoesPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
        <ToastHost />
      </DefinicoesContext.Provider>
    </LangContext.Provider>
  );
}
