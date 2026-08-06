/*
 * i18n da app Cobranças - PT-PT por omissão, EN opcional (brief). Padrão da
 * plataforma (o único precedente real nas apps Ekoa): pares inline tr(pt, en)
 * + hook reativo useLang(), com o idioma GLOBAL espelhado em
 * window.__COBRANCAS_LANG para os helpers fora de componentes (emails,
 * documentos, CSV).
 *
 * PERSISTÊNCIA: a escolha grava-se SERVIDOR-SIDE na coleção `definicoes`
 * (window.__ekoa) - localStorage/sessionStorage são proibidos nas apps Ekoa
 * (contrato do coding-agent; prevalece sobre a mecânica sugerida no brief).
 * Sobrevive a reloads e a mudanças de dispositivo.
 */
import { createContext, useContext } from 'react';

export const LANGS = [
  { id: 'pt', label: 'PT', name: 'Português' },
  { id: 'en', label: 'EN', name: 'English' },
];

export const LangContext = createContext({ lang: 'pt', setLang: () => {} });

/** Idioma global atual - utilizável FORA de componentes React. */
export function currentLang() {
  return (typeof window !== 'undefined' && window.__COBRANCAS_LANG) || 'pt';
}

/** Par inline: devolve o texto no idioma atual (recuo sempre para PT). */
export function tr(pt, en) {
  return currentLang() === 'en' && en != null && en !== '' ? en : pt;
}

/** Hook reativo - componentes que traduzem DEVEM chamá-lo para re-renderizar. */
export function useLang() {
  return useContext(LangContext).lang;
}

export function useSetLang() {
  return useContext(LangContext).setLang;
}
