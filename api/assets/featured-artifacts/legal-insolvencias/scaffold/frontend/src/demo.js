/*
 * Açúcar React sobre a ponte de demonstrações (Tutorial Bridge) - CANÓNICO.
 *
 * A plataforma injecta em cada app servida um cliente de ponte
 * (`window.__ekoaDemo`, ver cortex: demo-bridge-client.js) que fala com o
 * anfitrião (dashboard) por postMessage com validação de origem. Este módulo
 * é apenas a camada ergonómica para os apps da suite jurídica:
 *
 *   emitResultReady(target, summary?)  - sinaliza ao anfitrião que o resultado
 *                                        de um passo (annotate-result) está visível.
 *   registerDemoTargets(map)           - regista alvos dinâmicos (raramente
 *                                        necessário: o cliente descobre
 *                                        automaticamente os data-demo-target).
 *   useDemoResult(target, deps)        - hook: emite result-ready quando as
 *                                        dependências ficam verdadeiras.
 *
 * Sem a ponte (app aberta fora de uma demo), tudo degrada para no-ops.
 * Sincronizado por scripts/sync-legal-shared.mjs - editar AQUI, nunca as cópias.
 */

import { useEffect } from 'react';

function demoApi() {
  if (typeof window !== 'undefined' && window.__ekoaDemo) return window.__ekoaDemo;
  return null;
}

/* A app está a correr dentro de uma demonstração activa? */
export function isDemoActive() {
  const api = demoApi();
  return !!(api && typeof api.isActive === 'function' ? api.isActive() : api);
}

/* Sinaliza que o resultado de um passo está pronto/visível no ecrã. */
export function emitResultReady(target, summary) {
  const api = demoApi();
  if (api && typeof api.emitResultReady === 'function') {
    try {
      api.emitResultReady(target, summary);
    } catch { /* não fatal */ }
  }
}

/* Regista alvos dinâmicos (nome -> elemento). Normalmente desnecessário. */
export function registerDemoTargets(map) {
  const api = demoApi();
  if (api && typeof api.registerDemoTargets === 'function') {
    try {
      api.registerDemoTargets(map);
    } catch { /* não fatal */ }
  }
}

/*
 * Emite `result-ready` para `target` assim que `ready` passa a verdadeiro.
 * Uso: useDemoResult('prazos-radar', itens.length > 0).
 */
export function useDemoResult(target, ready, summary) {
  useEffect(() => {
    if (ready) emitResultReady(target, summary);
    // `summary` é intencionalmente não-reactivo: só interessa no momento do disparo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ready]);
}
