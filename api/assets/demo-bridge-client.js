/*
 * Ekoa Tutorial Bridge - CLIENT (injected into every served artifact app).
 *
 * Plain browser IIFE, no build step. The platform injects this file via a
 * <script src="/__ekoa/demo-bridge.js"> tag added by injectAppContext() in
 * cortex/src/server.ts. It is a no-op until a demo host (the dashboard) sends a
 * `demo.init` postMessage, so it NEVER affects normal (non-demo) app usage.
 *
 * Protocol (postMessage envelope: { __ekoaDemo: 1, type, id, ... }):
 *   Host -> app:  demo.init {hostOrigin}, demo.spotlight {id,target,copy,placement?},
 *                 demo.await {id,target,event}, demo.annotate {id,target,copy},
 *                 demo.clear {id}, demo.end {id}
 *   App -> host:  demo.ready {targets}, demo.targets-changed {targets},
 *                 demo.ack {id}, demo.action {id,target,event},
 *                 demo.result-ready {target,summary?}, demo.error {id,reason}
 *
 * Origin validation: the host origin is pinned from the FIRST demo.init whose
 * origin matches document.referrer's origin (when the referrer is absent, the
 * first init is accepted and its origin pinned). Afterwards any message from a
 * different origin is rejected, and every reply is posted with an explicit
 * targetOrigin. This keeps a served app from being driven by a hostile frame.
 *
 * The React sugar the legal apps use (window.__ekoaDemo.emitResultReady, etc.)
 * lives in ekoa-data/legal-shared/demo.js and calls into the API this file
 * installs at window.__ekoaDemo.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__ekoaDemoBridgeInstalled) return;
  window.__ekoaDemoBridgeInstalled = true;

  var MASK_COLOR = 'rgba(15, 23, 42, 0.5)';
  var DEFAULT_TIMEOUT_MS = 15000;
  var POLL_MS = 200;
  var MUTATION_DEBOUNCE_MS = 300;

  var hostOrigin = null; // pinned on first valid demo.init
  var active = false;
  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) { reducedMotion = false; }

  // Cache of emitted result-ready events so a demo.await/demo.annotate arriving
  // AFTER the app already signalled resolves immediately.
  var resultCache = Object.create(null); // target -> summary|null

  // Pending awaits keyed by envelope id. Each: { id, target, event, timer, cleanup }
  var pendingAwaits = Object.create(null);

  // Currently drawn overlay (spotlight or annotate). One at a time.
  var overlay = null; // { root, hole, tooltip, target, reposition }

  // ---- messaging -------------------------------------------------------------

  function post(type, payload) {
    if (!hostOrigin || typeof window.parent === 'undefined' || window.parent === window) return;
    var msg = { __ekoaDemo: 1, type: type };
    if (payload) {
      for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
    }
    try { window.parent.postMessage(msg, hostOrigin); } catch (_) { /* host gone */ }
  }

  function currentTargets() {
    var out = [];
    var seen = Object.create(null);
    var nodes = document.querySelectorAll('[data-demo-target]');
    for (var i = 0; i < nodes.length; i++) {
      var name = nodes[i].getAttribute('data-demo-target');
      if (name && !seen[name]) { seen[name] = true; out.push(name); }
    }
    return out;
  }

  function findTarget(name) {
    if (!name) return null;
    // A CSS-safe attribute selector; names are simple kebab identifiers.
    try {
      return document.querySelector('[data-demo-target="' + String(name).replace(/"/g, '\\"') + '"]');
    } catch (_) { return null; }
  }

  // ---- spotlight / annotate overlay -----------------------------------------

  function clearOverlay() {
    if (!overlay) return;
    try {
      window.removeEventListener('scroll', overlay.reposition, true);
      window.removeEventListener('resize', overlay.reposition, true);
    } catch (_) { /* ignore */ }
    if (overlay.root && overlay.root.parentNode) overlay.root.parentNode.removeChild(overlay.root);
    overlay = null;
  }

  function placeTooltip(tooltip, rect, placement) {
    var margin = 12;
    var tw = tooltip.offsetWidth || 280;
    var th = tooltip.offsetHeight || 96;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var below = rect.bottom + margin + th <= vh;
    var above = rect.top - margin - th >= 0;
    var top;
    // Prefer requested placement, else auto-flip to whichever side fits.
    if (placement === 'above' && above) top = rect.top - margin - th;
    else if (placement === 'below' && below) top = rect.bottom + margin;
    else if (below) top = rect.bottom + margin;
    else if (above) top = rect.top - margin - th;
    else top = Math.max(margin, Math.min(vh - th - margin, rect.bottom + margin));
    var left = rect.left;
    if (left + tw + margin > vw) left = Math.max(margin, vw - tw - margin);
    if (left < margin) left = margin;
    tooltip.style.top = Math.round(top) + 'px';
    tooltip.style.left = Math.round(left) + 'px';
  }

  function drawOverlay(kind, name, copy, placement) {
    clearOverlay();
    var el = findTarget(name);
    if (!el) return false;

    var root = document.createElement('div');
    root.setAttribute('data-ekoa-demo-overlay', kind);
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';

    var hole = document.createElement('div');
    hole.style.cssText =
      'position:fixed;border-radius:10px;box-shadow:0 0 0 9999px ' + MASK_COLOR + ';' +
      'transition:top .15s ease,left .15s ease,width .15s ease,height .15s ease;';
    if (!reducedMotion) {
      hole.style.outline = '2px solid rgba(45, 212, 191, 0.9)';
      hole.style.outlineOffset = '2px';
      hole.style.animation = 'ekoaDemoPulse 1.6s ease-in-out infinite';
    } else {
      hole.style.outline = '2px solid rgba(45, 212, 191, 0.9)';
      hole.style.outlineOffset = '2px';
    }

    var tooltip = null;
    if (copy && (copy.titlePt || copy.bodyPt)) {
      tooltip = document.createElement('div');
      tooltip.style.cssText =
        'position:fixed;max-width:280px;background:#ffffff;color:#0f172a;border:1px solid #e2e8f0;' +
        'border-radius:12px;padding:12px 14px;box-shadow:0 8px 24px rgba(15,23,42,.14);' +
        'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;line-height:1.45;';
      if (copy.titlePt) {
        var t = document.createElement('div');
        t.style.cssText = 'font-weight:600;margin-bottom:4px;';
        t.textContent = copy.titlePt;
        tooltip.appendChild(t);
      }
      if (copy.bodyPt) {
        var b = document.createElement('div');
        b.style.cssText = 'color:#475569;';
        b.textContent = copy.bodyPt;
        tooltip.appendChild(b);
      }
    }

    root.appendChild(hole);
    if (tooltip) root.appendChild(tooltip);
    document.body.appendChild(root);

    var reposition = function () {
      var target = findTarget(name);
      if (!target) return;
      var r = target.getBoundingClientRect();
      hole.style.top = Math.round(r.top - 4) + 'px';
      hole.style.left = Math.round(r.left - 4) + 'px';
      hole.style.width = Math.round(r.width + 8) + 'px';
      hole.style.height = Math.round(r.height + 8) + 'px';
      if (tooltip) placeTooltip(tooltip, r, placement);
    };

    overlay = { root: root, hole: hole, tooltip: tooltip, target: name, reposition: reposition };
    reposition();
    // Re-place tooltip once its real size is known.
    if (tooltip) reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition, true);
    return true;
  }

  // Poll for a target up to timeoutMs, then run onFound(el) or emit demo.error.
  function whenTargetAvailable(id, name, timeoutMs, onFound) {
    var deadline = Date.now() + (timeoutMs || DEFAULT_TIMEOUT_MS);
    var found = findTarget(name);
    if (found) { onFound(found); return; }
    var timer = window.setInterval(function () {
      var el = findTarget(name);
      if (el) { window.clearInterval(timer); onFound(el); return; }
      if (Date.now() > deadline) {
        window.clearInterval(timer);
        post('demo.error', { id: id, reason: 'target-not-found', target: name });
      }
    }, POLL_MS);
  }

  // ---- await handling --------------------------------------------------------

  function clearAwait(id) {
    var a = pendingAwaits[id];
    if (!a) return;
    if (a.timer) window.clearTimeout(a.timer);
    if (typeof a.cleanup === 'function') { try { a.cleanup(); } catch (_) {} }
    delete pendingAwaits[id];
  }

  function handleAwait(id, name, event, timeoutMs) {
    clearAwait(id);
    var timeout = timeoutMs || DEFAULT_TIMEOUT_MS;

    if (event === 'result-ready') {
      // Already emitted? Resolve immediately from cache.
      if (Object.prototype.hasOwnProperty.call(resultCache, name)) {
        post('demo.action', { id: id, target: name, event: 'result-ready', summary: resultCache[name] });
        return;
      }
      // FALLBACK DE VISIBILIDADE (fase 2): annotate-result significa "aponta
      // ao resultado quando estiver no ecrã". A emissão explícita
      // (emitResultReady/useDemoResult) continua a ser o sinal preferido, mas
      // quando a app não emite, o próprio alvo VISÍVEL é o sinal - sem isto,
      // qualquer spec cuja app não emita morre por timeout.
      var vis = window.setInterval(function () {
        var el = findTarget(name);
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          clearAwait(id);
          post('demo.action', { id: id, target: name, event: 'result-ready', summary: null });
        }
      }, 300);
      var timer = window.setTimeout(function () {
        clearAwait(id);
        post('demo.error', { id: id, reason: 'timeout', target: name });
      }, timeout);
      pendingAwaits[id] = {
        id: id, target: name, event: 'result-ready', timer: timer,
        cleanup: function () { window.clearInterval(vis); },
      };
      return;
    }

    // event === 'click' (default DOM event). Listener DELEGADO ao documento em
    // fase de captura: sobrevive a navegações SPA e a re-renders do React, e
    // elimina a corrida "clique antes do attach" (o alvo pode nem existir
    // ainda quando o demo.await chega - p. ex. logo após um navigate()).
    var deadline = Date.now() + timeout;

    var onEvt = function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-demo-target="' + name + '"]') : null;
      if (!el) return;
      clearAwait(id);
      post('demo.action', { id: id, target: name, event: event });
    };
    document.addEventListener(event, onEvt, true);
    var timer = window.setTimeout(function () {
      clearAwait(id);
      post('demo.error', { id: id, reason: 'timeout', target: name });
    }, Math.max(0, deadline - Date.now()));
    pendingAwaits[id] = {
      id: id, target: name, event: event, timer: timer,
      cleanup: function () { try { document.removeEventListener(event, onEvt, true); } catch (_) {} },
    };
  }

  // Resolve any pending result-ready awaits for a target once the app signals.
  function resolveResultAwaits(name, summary) {
    for (var id in pendingAwaits) {
      if (!Object.prototype.hasOwnProperty.call(pendingAwaits, id)) continue;
      var a = pendingAwaits[id];
      if (a.event === 'result-ready' && a.target === name) {
        clearAwait(id);
        post('demo.action', { id: id, target: name, event: 'result-ready', summary: summary });
      }
    }
  }

  // ---- public API (window.__ekoaDemo) ---------------------------------------

  window.__ekoaDemo = {
    isActive: function () { return active === true; },
    registerDemoTargets: function (map) {
      // The bridge discovers data-demo-target attributes automatically; this is
      // an escape hatch for apps that want to announce targets explicitly.
      if (!map) return;
      try {
        var names = Array.isArray(map) ? map : Object.keys(map);
        if (active) post('demo.targets-changed', { targets: currentTargets().concat(names) });
      } catch (_) { /* non-fatal */ }
    },
    emitResultReady: function (target, summary) {
      if (!target) return;
      resultCache[target] = (summary === undefined ? null : summary);
      if (active) {
        post('demo.result-ready', { target: target, summary: resultCache[target] });
        resolveResultAwaits(target, resultCache[target]);
      }
    },
  };

  // ---- mutation observer (keep target discovery fresh) ----------------------

  var mutationTimer = null;
  var lastTargetsKey = '';
  function scheduleTargetsScan() {
    if (mutationTimer) return;
    mutationTimer = window.setTimeout(function () {
      mutationTimer = null;
      if (!active) return;
      var targets = currentTargets();
      var key = targets.join('|');
      if (key !== lastTargetsKey) {
        lastTargetsKey = key;
        post('demo.targets-changed', { targets: targets });
      }
      if (overlay) overlay.reposition();
    }, MUTATION_DEBOUNCE_MS);
  }
  var observer = null;
  function startObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(scheduleTargetsScan);
    try { observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-demo-target'] }); } catch (_) {}
  }
  function stopObserver() {
    if (observer) { try { observer.disconnect(); } catch (_) {} observer = null; }
  }

  // ---- teardown --------------------------------------------------------------

  function endDemo() {
    for (var id in pendingAwaits) if (Object.prototype.hasOwnProperty.call(pendingAwaits, id)) clearAwait(id);
    clearOverlay();
    stopObserver();
    active = false;
    hostOrigin = null;
    lastTargetsKey = '';
  }

  // ---- message dispatch ------------------------------------------------------

  function refererOrigin() {
    try {
      if (!document.referrer) return null;
      return new URL(document.referrer).origin;
    } catch (_) { return null; }
  }

  window.addEventListener('message', function (e) {
    var data = e && e.data;
    if (!data || data.__ekoaDemo !== 1 || typeof data.type !== 'string') return;

    if (data.type === 'demo.init') {
      // Pin the host origin from the FIRST valid init only.
      if (hostOrigin) {
        if (e.origin !== hostOrigin) return; // reject re-init from another origin
      } else {
        var ref = refererOrigin();
        if (ref && e.origin !== ref) return; // referrer known but mismatched -> reject
        hostOrigin = e.origin;
      }
      active = true;
      startObserver();
      lastTargetsKey = currentTargets().join('|');
      post('demo.ready', { targets: currentTargets() });
      return;
    }

    // Every other message must come from the pinned host origin.
    if (!hostOrigin || e.origin !== hostOrigin) return;

    switch (data.type) {
      case 'demo.spotlight': {
        whenTargetAvailable(data.id, data.target, data.timeoutMs, function () {
          var ok = drawOverlay('spotlight', data.target, data.copy, data.placement);
          if (ok) post('demo.ack', { id: data.id, target: data.target });
          else post('demo.error', { id: data.id, reason: 'target-not-found', target: data.target });
        });
        break;
      }
      case 'demo.annotate': {
        // Draw attention on the result element AND, if the result was already
        // emitted, echo an action so the host can advance without re-waiting.
        whenTargetAvailable(data.id, data.target, data.timeoutMs, function () {
          var ok = drawOverlay('annotate', data.target, data.copy, data.placement);
          if (ok) post('demo.ack', { id: data.id, target: data.target });
          else post('demo.error', { id: data.id, reason: 'target-not-found', target: data.target });
        });
        break;
      }
      case 'demo.await': {
        handleAwait(data.id, data.target, data.event || 'click', data.timeoutMs);
        break;
      }
      case 'demo.clear': {
        clearAwait(data.id);
        clearOverlay();
        post('demo.ack', { id: data.id });
        break;
      }
      case 'demo.end': {
        var endId = data.id;
        endDemo();
        // hostOrigin was just reset; reply is best-effort (parent may be gone).
        try { if (e.source) e.source.postMessage({ __ekoaDemo: 1, type: 'demo.ack', id: endId }, e.origin); } catch (_) {}
        break;
      }
      default:
        break;
    }
  });

  // Keyframes for the (motion-safe) accent pulse.
  try {
    var style = document.createElement('style');
    style.setAttribute('data-ekoa-demo', 'styles');
    style.textContent =
      '@keyframes ekoaDemoPulse{0%,100%{outline-color:rgba(45,212,191,.9)}50%{outline-color:rgba(45,212,191,.35)}}';
    (document.head || document.documentElement).appendChild(style);
  } catch (_) { /* ignore */ }
})();
