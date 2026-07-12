/*
 * Ekoa In-Page Action Runtime - CLIENT (injected into every served artifact app).
 *
 * Plain browser IIFE, no build step (sibling to demo-bridge-client.js). The
 * platform injects this file via a <script src="/__ekoa/action-runtime.js"> tag
 * added by injectAppContext() in api/src/apps/injected-context.ts. It is a no-op
 * until a host (the operator assistant panel) sends an `actions.init`
 * postMessage, so it NEVER affects normal app usage.
 *
 * It executes the app's declared ui_actions (shared/src/action-manifest.ts) by
 * driving the app's OWN state layer through user-EQUIVALENT DOM events - the
 * same events a human interaction produces - so the app's validation and
 * business logic always run. It carries NO authorisation logic: the destructive
 * confirmation is a UX affordance only; server-side authorisation lives in a
 * later block.
 *
 * Protocol (postMessage envelope: { __ekoaActions: 1, type, ... }):
 *   Host -> app:  actions.init {hostOrigin},
 *                 actions.execute {id, action}  (action = a manifest AppAction
 *                   JSON, with param VALUES carried on action.params),
 *                 actions.cancel {id}
 *   App -> host:  actions.ready {targets},
 *                 actions.result {id, status:'done'|'failed'|'cancelled'|'confirm-pending', detail?},
 *                 actions.error {id, reason},
 *                 actions.tour-request {id, tourId}  (kind 'startTour' only)
 *
 * Origin validation mirrors the demo bridge: the host origin is pinned from the
 * FIRST actions.init whose origin matches document.referrer's origin (when the
 * referrer is absent, the first init is accepted and its origin pinned).
 * Afterwards any message from a different origin is rejected, and every reply is
 * posted with an explicit targetOrigin. This keeps a served app from being
 * driven by a hostile frame.
 *
 * Optional app-side hooks the runtime looks for (a generated app MAY provide
 * them on window.__ekoaApp): `navigate(route)` for local-state page navigation,
 * and `actions[<id>](params)` for kind 'custom'.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__ekoaActionRuntimeInstalled) return;
  window.__ekoaActionRuntimeInstalled = true;

  var POLL_MS = 200;
  var TARGET_TIMEOUT_MS = 8000;
  var HIGHLIGHT_MS = 2500;

  var hostOrigin = null; // pinned on first valid actions.init
  var active = false;
  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) { reducedMotion = false; }

  // Execution state. `queue` holds not-yet-started executes; `activeItem` is the
  // one currently running or awaiting confirmation. teardown() removes the
  // item's transient UI/timers WITHOUT reporting - the caller decides the report.
  var queue = [];
  var activeItem = null; // { id, action, teardown }

  function noop() {}

  // ---- messaging -------------------------------------------------------------

  function post(type, payload) {
    if (!hostOrigin || typeof window.parent === 'undefined' || window.parent === window) return;
    var msg = { __ekoaActions: 1, type: type };
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
    try {
      return document.querySelector('[data-demo-target="' + String(name).replace(/"/g, '\\"') + '"]');
    } catch (_) { return null; }
  }

  function refererOrigin() {
    try {
      if (!document.referrer) return null;
      return new URL(document.referrer).origin;
    } catch (_) { return null; }
  }

  // ---- param values ----------------------------------------------------------

  // At EXECUTE time action.params carries VALUES (an object like { valor: 'X' }),
  // distinct from the manifest's param DEFINITIONS (an array). Read defensively.
  function paramsObject(action) {
    var p = action && action.params;
    if (p && typeof p === 'object' && !Array.isArray(p)) return p;
    return {};
  }
  function paramValue(action, keys) {
    var p = paramsObject(action);
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(p, keys[i]) && p[keys[i]] != null) return p[keys[i]];
    }
    return undefined;
  }

  // ---- user-equivalent DOM events -------------------------------------------

  // Set an input/textarea/select value via the NATIVE setter, then dispatch
  // bubbling input+change events so React's synthetic-event tracking (which reads
  // the native value) sees the change and runs the app's onChange/validation.
  function setNativeValue(el, value) {
    var proto;
    if (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) proto = HTMLTextAreaElement.prototype;
    else if (typeof HTMLSelectElement !== 'undefined' && el instanceof HTMLSelectElement) proto = HTMLSelectElement.prototype;
    else proto = HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fireEvent(el, type) {
    var ev;
    try {
      ev = new Event(type, { bubbles: true });
    } catch (_) {
      ev = document.createEvent('Event');
      ev.initEvent(type, true, false);
    }
    el.dispatchEvent(ev);
  }

  function fieldInside(host) {
    if (!host) return null;
    var tag = host.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return host;
    return host.querySelector ? host.querySelector('input,textarea,select') : null;
  }

  // ---- highlight / driving indicator ----------------------------------------

  var hlOverlay = null;
  var hlTimer = null;

  function clearHighlight() {
    if (hlTimer) { window.clearTimeout(hlTimer); hlTimer = null; }
    if (!hlOverlay) return;
    try {
      window.removeEventListener('scroll', hlOverlay.reposition, true);
      window.removeEventListener('resize', hlOverlay.reposition, true);
    } catch (_) { /* ignore */ }
    if (hlOverlay.root && hlOverlay.root.parentNode) hlOverlay.root.parentNode.removeChild(hlOverlay.root);
    hlOverlay = null;
  }

  // Spotlight ring around the element being driven (mirrors demo-bridge
  // drawOverlay minus the tooltip). Auto-clears after ~2.5s or on the next call.
  function highlightTarget(el) {
    clearHighlight();
    if (!el || !document.body) return;

    var root = document.createElement('div');
    root.setAttribute('data-ekoa-actions-ui', 'highlight');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';

    var ring = document.createElement('div');
    ring.style.cssText =
      'position:fixed;border-radius:10px;box-shadow:0 0 0 9999px rgba(15,23,42,0.28);' +
      'outline:2px solid var(--color-primary, #0f766e);outline-offset:2px;' +
      'transition:top .15s ease,left .15s ease,width .15s ease,height .15s ease;';
    if (!reducedMotion) ring.style.animation = 'ekoaActionsPulse 1.4s ease-in-out infinite';

    root.appendChild(ring);
    document.body.appendChild(root);

    var reposition = function () {
      var r = el.getBoundingClientRect();
      ring.style.top = Math.round(r.top - 4) + 'px';
      ring.style.left = Math.round(r.left - 4) + 'px';
      ring.style.width = Math.round(r.width + 8) + 'px';
      ring.style.height = Math.round(r.height + 8) + 'px';
    };

    hlOverlay = { root: root, reposition: reposition };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition, true);
    hlTimer = window.setTimeout(clearHighlight, HIGHLIGHT_MS);
  }

  var badge = null;
  function showDrivingBadge() {
    if (badge || !document.body) return;
    badge = document.createElement('div');
    badge.setAttribute('data-ekoa-actions-ui', 'badge');
    badge.textContent = 'Assistente a executar...';
    badge.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483001;' +
      'background:var(--color-primary, #0f766e);color:var(--color-on-primary, #ffffff);' +
      'font-family:var(--font-sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif);' +
      'font-size:var(--text-sm, 13px);padding:8px 12px;border-radius:var(--radius-md, 8px);' +
      'box-shadow:0 8px 24px rgba(15,23,42,.18);pointer-events:none;';
    document.body.appendChild(badge);
  }
  function hideDrivingBadge() {
    if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
    badge = null;
  }

  // ---- destructive confirmation (UX affordance, NOT authorisation) -----------

  var confirmCard = null;
  function clearConfirm() {
    if (confirmCard && confirmCard.parentNode) confirmCard.parentNode.removeChild(confirmCard);
    confirmCard = null;
  }

  function showConfirm(action, onConfirm, onCancel) {
    clearConfirm();
    if (!document.body) { onCancel(); return; }

    var root = document.createElement('div');
    root.setAttribute('data-ekoa-actions-ui', 'confirm');
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483002;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(15,23,42,0.45);' +
      'font-family:var(--font-sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif);';

    var card = document.createElement('div');
    card.style.cssText =
      'max-width:320px;width:calc(100% - 32px);background:var(--color-surface, #ffffff);' +
      'color:var(--color-text, #0f172a);border:1px solid var(--color-border, #e2e8f0);' +
      'border-radius:var(--radius-lg, 12px);padding:20px;box-shadow:0 12px 32px rgba(15,23,42,.24);';

    var title = document.createElement('div');
    title.style.cssText = 'font-size:var(--text-base, 15px);font-weight:600;line-height:1.4;margin-bottom:16px;';
    title.textContent = 'Confirmar ação: ' + (action.labelPt || action.id || '');

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.setAttribute('data-demo-target', 'ekoa-cancelar-acao');
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.style.cssText =
      'padding:8px 14px;border-radius:var(--radius-md, 8px);border:1px solid var(--color-border, #e2e8f0);' +
      'background:transparent;color:var(--color-text, #0f172a);font-size:var(--text-sm, 13px);cursor:pointer;';

    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.setAttribute('data-demo-target', 'ekoa-confirm-acao');
    confirmBtn.textContent = 'Confirmar';
    confirmBtn.style.cssText =
      'padding:8px 14px;border-radius:var(--radius-md, 8px);border:1px solid var(--color-primary, #0f766e);' +
      'background:var(--color-primary, #0f766e);color:var(--color-on-primary, #ffffff);' +
      'font-size:var(--text-sm, 13px);cursor:pointer;';

    cancelBtn.addEventListener('click', function () { onCancel(); });
    confirmBtn.addEventListener('click', function () { onConfirm(); });

    row.appendChild(cancelBtn);
    row.appendChild(confirmBtn);
    card.appendChild(title);
    card.appendChild(row);
    root.appendChild(card);
    document.body.appendChild(root);
    confirmCard = root;
  }

  // ---- navigation ------------------------------------------------------------

  function doNavigate(route) {
    route = route || '';
    if (window.__ekoaApp && typeof window.__ekoaApp.navigate === 'function') {
      try { window.__ekoaApp.navigate(route); return true; } catch (_) { return false; }
    }
    // Fallback for router-based apps: hash routes go straight to location.hash;
    // path routes use pushState + a popstate dispatch so a listening router reacts.
    try {
      if (route.charAt(0) === '#') { window.location.hash = route; return true; }
      window.history.pushState({}, '', route);
      var pop;
      try { pop = new PopStateEvent('popstate', { state: {} }); }
      catch (_) { pop = document.createEvent('Event'); pop.initEvent('popstate', true, false); }
      window.dispatchEvent(pop);
      return true;
    } catch (_) {
      try { window.location.hash = route; return true; } catch (_) { return false; }
    }
  }

  // ---- execution queue -------------------------------------------------------

  function runNext() {
    if (activeItem || queue.length === 0) return;
    var item = queue.shift();
    activeItem = { id: item.id, action: item.action, teardown: noop, resolve: item.resolve, reject: item.reject };
    startItem(item.id, item.action);
  }

  // Terminal report for the active item. Tears down its transient UI and drains.
  // An item enqueued through the SAME-DOCUMENT API (window.__ekoaActions.execute) carries a
  // `resolve`/`reject` pair instead of a host frame; report to it directly. Cross-frame items
  // carry neither and report via post() (the iframe/dashboard host). post() no-ops in the
  // same-document case (no parent), so no message leaks.
  function finish(status, detail) {
    if (!activeItem) return;
    var id = activeItem.id;
    var settle = activeItem.resolve;
    try { activeItem.teardown(); } catch (_) { /* ignore */ }
    hideDrivingBadge();
    var payload = { id: id, status: status };
    if (detail) payload.detail = detail;
    activeItem = null;
    post('actions.result', payload);
    if (settle) { try { settle(payload); } catch (_) { /* ignore */ } }
    runNext();
  }

  // Terminal STRUCTURAL failure (mirrors demo.error): the action could not run.
  function fail(reason) {
    if (!activeItem) return;
    var id = activeItem.id;
    var settle = activeItem.reject;
    try { activeItem.teardown(); } catch (_) { /* ignore */ }
    hideDrivingBadge();
    activeItem = null;
    post('actions.error', { id: id, reason: reason });
    if (settle) { try { settle({ id: id, status: 'error', reason: reason }); } catch (_) { /* ignore */ } }
    runNext();
  }

  function startItem(id, action) {
    if (action && action.destructive === true) {
      // Client-side confirmation before ANY dispatch (UX, not authorisation).
      activeItem.teardown = clearConfirm;
      showConfirm(
        action,
        function onConfirm() {
          clearConfirm();
          if (activeItem) activeItem.teardown = noop;
          perform(id, action);
        },
        function onCancel() { finish('cancelled'); }
      );
      post('actions.result', { id: id, status: 'confirm-pending' });
      return;
    }
    perform(id, action);
  }

  // Resolve an element target, polling up to TARGET_TIMEOUT_MS (targets may not
  // exist yet - e.g. right after a navigate). fail('target-not-found') on timeout.
  function withTarget(id, name, onFound) {
    var found = findTarget(name);
    if (found) { onFound(found); return; }
    var deadline = Date.now() + TARGET_TIMEOUT_MS;
    var timer = window.setInterval(function () {
      if (!activeItem || activeItem.id !== id) { window.clearInterval(timer); return; }
      var el = findTarget(name);
      if (el) { window.clearInterval(timer); onFound(el); return; }
      if (Date.now() > deadline) { window.clearInterval(timer); fail('target-not-found'); }
    }, POLL_MS);
    activeItem.teardown = function () { window.clearInterval(timer); };
  }

  function perform(id, action) {
    if (!action || typeof action.kind !== 'string') { fail('invalid-action'); return; }
    showDrivingBadge();

    switch (action.kind) {
      case 'navigate': {
        var ok = doNavigate(action.route || '');
        finish(ok ? 'done' : 'failed', ok ? undefined : 'navigate-failed');
        break;
      }
      case 'startTour': {
        // The tour player lands in a later slice; the runtime only surfaces the request.
        post('actions.tour-request', { id: id, tourId: action.tourId || null });
        finish('done');
        break;
      }
      case 'custom': {
        var fn = window.__ekoaApp && window.__ekoaApp.actions && window.__ekoaApp.actions[action.id];
        if (typeof fn !== 'function') { fail('unregistered-custom-action'); break; }
        try { fn(paramsObject(action)); finish('done'); }
        catch (_) { fail('custom-action-threw'); }
        break;
      }
      case 'setField': {
        withTarget(id, action.target, function (host) {
          if (!activeItem) return;
          var field = fieldInside(host);
          if (!field) { finish('failed', 'no-field'); return; }
          highlightTarget(field);
          var val = paramValue(action, ['valor', 'value']);
          setNativeValue(field, val == null ? '' : String(val));
          fireEvent(field, 'input');
          fireEvent(field, 'change');
          finish('done');
        });
        break;
      }
      case 'toggle': {
        withTarget(id, action.target, function (host) {
          if (!activeItem) return;
          var el = null;
          try {
            el = host.matches && host.matches('input,button,[role="switch"],[role="checkbox"]')
              ? host
              : host.querySelector('input[type="checkbox"],input[type="radio"],[role="switch"],[role="checkbox"],button');
          } catch (_) { el = null; }
          var clickEl = el || host;
          highlightTarget(clickEl);
          try { clickEl.click(); } catch (_) { finish('failed', 'not-clickable'); return; }
          finish('done');
        });
        break;
      }
      case 'select': {
        withTarget(id, action.target, function (host) {
          if (!activeItem) return;
          var sel = host.tagName === 'SELECT' ? host : (host.querySelector ? host.querySelector('select') : null);
          if (!sel) { finish('failed', 'no-select'); return; }
          highlightTarget(sel);
          var val = paramValue(action, ['value']);
          var idx = paramValue(action, ['index']);
          if (val != null) {
            setNativeValue(sel, String(val));
          } else if (idx != null && sel.options && sel.options[Number(idx)]) {
            setNativeValue(sel, sel.options[Number(idx)].value);
          }
          fireEvent(sel, 'input');
          fireEvent(sel, 'change');
          finish('done');
        });
        break;
      }
      case 'highlight': {
        withTarget(id, action.target, function (host) {
          if (!activeItem) return;
          highlightTarget(host);
          finish('done');
        });
        break;
      }
      default:
        fail('unsupported-kind');
        break;
    }
  }

  // ---- cancellation ----------------------------------------------------------

  function cancelById(id) {
    if (activeItem && activeItem.id === id) {
      var settle = activeItem.resolve;
      try { activeItem.teardown(); } catch (_) { /* ignore */ }
      hideDrivingBadge();
      activeItem = null;
      post('actions.result', { id: id, status: 'cancelled' });
      if (settle) { try { settle({ id: id, status: 'cancelled' }); } catch (_) { /* ignore */ } }
      runNext();
      return;
    }
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id) {
        var qitem = queue.splice(i, 1)[0];
        post('actions.result', { id: id, status: 'cancelled' });
        if (qitem && qitem.resolve) { try { qitem.resolve({ id: id, status: 'cancelled' }); } catch (_) { /* ignore */ } }
        return;
      }
    }
  }

  // PAUSE-ON-USER-INPUT: a real (isTrusted) pointer/keyboard event during a
  // queued/executing sequence means the human took over - never fight them.
  // Cancel the active item (if it is still WAITING) and everything queued, and
  // report cancelled for each. Events on the runtime's OWN UI (the confirm
  // buttons, overlays) are ignored - they are the assistant, not the user.
  function cancelAllForUserInput() {
    var settlers = [];
    if (activeItem) {
      try { activeItem.teardown(); } catch (_) { /* ignore */ }
      settlers.push({ id: activeItem.id, resolve: activeItem.resolve });
      activeItem = null;
    }
    for (var i = 0; i < queue.length; i++) settlers.push({ id: queue[i].id, resolve: queue[i].resolve });
    queue.length = 0;
    hideDrivingBadge();
    clearHighlight();
    clearConfirm();
    for (var j = 0; j < settlers.length; j++) {
      var payload = { id: settlers[j].id, status: 'cancelled', detail: 'user-input' };
      post('actions.result', payload);
      if (settlers[j].resolve) { try { settlers[j].resolve(payload); } catch (_) { /* ignore */ } }
    }
  }

  function onUserInput(e) {
    if (!e || e.isTrusted !== true || !active) return;
    var t = e.target;
    if (t && t.closest) {
      try { if (t.closest('[data-ekoa-actions-ui]')) return; } catch (_) { /* ignore */ }
    }
    if (!activeItem && queue.length === 0) return;
    cancelAllForUserInput();
  }
  window.addEventListener('pointerdown', onUserInput, true);
  window.addEventListener('keydown', onUserInput, true);

  // ---- message dispatch ------------------------------------------------------

  window.addEventListener('message', function (e) {
    var data = e && e.data;
    if (!data || data.__ekoaActions !== 1 || typeof data.type !== 'string') return;

    if (data.type === 'actions.init') {
      // Pin the host origin from the FIRST valid init only (demo-bridge discipline).
      if (hostOrigin) {
        if (e.origin !== hostOrigin) return; // reject re-init from another origin
      } else {
        var ref = refererOrigin();
        if (ref && e.origin !== ref) return; // referrer known but mismatched -> reject
        hostOrigin = e.origin;
      }
      active = true;
      post('actions.ready', { targets: currentTargets() });
      return;
    }

    // Every other message must come from the pinned host origin.
    if (!hostOrigin || e.origin !== hostOrigin) return;

    switch (data.type) {
      case 'actions.execute': {
        if (!data.action || typeof data.id === 'undefined' || data.id === null) return;
        queue.push({ id: data.id, action: data.action });
        runNext();
        break;
      }
      case 'actions.cancel': {
        if (typeof data.id === 'undefined' || data.id === null) return;
        cancelById(data.id);
        break;
      }
      default:
        break;
    }
  });

  // ---- SAME-DOCUMENT public API ----------------------------------------------
  // The operator assistant PANEL (operator-run D2) mounts INSIDE the served app (same document,
  // at #ekoa-assistant-root), so it has no host frame to postMessage across - the cross-frame
  // path (post() -> window.parent) refuses same-window drive by design. This direct API routes a
  // manifest action through the SAME executor (same events, same highlight, same destructive
  // confirmation, same pause-on-user-input) and resolves a Promise with the terminal result. The
  // dashboard/tour iframe path is unchanged.
  var idSeq = 0;
  window.__ekoaActions = {
    /** Execute one manifest action; resolves { id, status:'done'|'failed'|'cancelled', detail? }
     *  or rejects on a structural error ({ status:'error', reason }). Never dispatches without the
     *  app's own events + (for destructive actions) the confirmation card. */
    execute: function (action) {
      return new Promise(function (resolve, reject) {
        if (!action || typeof action !== 'object') { reject({ status: 'error', reason: 'invalid-action' }); return; }
        active = true; // same-document drive needs no init handshake
        var id = 'panel-' + (++idSeq);
        queue.push({ id: id, action: action, resolve: resolve, reject: reject });
        runNext();
      });
    },
    /** Cancel a pending/active same-document action by the id returned in a result. */
    cancel: function (id) { cancelById(id); },
  };

  // Keyframes for the (motion-safe) accent pulse on the driven target.
  try {
    var style = document.createElement('style');
    style.setAttribute('data-ekoa-actions', 'styles');
    style.textContent =
      '@keyframes ekoaActionsPulse{0%,100%{outline-color:var(--color-primary, #0f766e)}50%{outline-color:rgba(45,212,191,.4)}}';
    (document.head || document.documentElement).appendChild(style);
  } catch (_) { /* ignore */ }
})();
