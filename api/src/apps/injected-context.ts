/**
 * Served-app context injection (ch07 §7.6; carryover B4 - extracted from the old
 * monolith, logic unchanged; FIXED-9). Every served HTML document is stamped with
 * the byte-compatible context: `window.__EKOA_APP_ID`, the `window.__ekoa` helper
 * (data CRUD + shared namespace + files + end-user SSO + visitor Graph + PDF export
 * + workspace cloud files), the in-page health probe, the demo-bridge script tag,
 * and `<base href="/apps/<id>/">`. The 37-spec legal suite drives the injected
 * handle directly - the script body below is a compatibility contract; do not
 * "improve" it.
 *
 * One deliberate extension (2026-08-15): `signIn()` is frame-aware. The OIDC start
 * leg lives on the /api surface (X-Frame-Options: DENY) and the provider's login
 * page refuses framing too, so navigating the preview iframe there renders
 * "refused to connect". When framed, signIn() opens the flow in a named top-level
 * window instead; the popup half of the handshake (reload the opener frame, close
 * itself) is the `__ekoa_sso_` named-window block below, and the frame additionally
 * polls the quiet /api/app-sso/session probe (200 in both states - no console 401
 * stream) against a baseline captured at popup-open, reloading only on a session
 * CHANGE - a pre-existing consent-less session (re-consent flows) must not reload
 * the frame mid-auth. A BLOCKED popup leaves the frame alone with a console
 * warning: navigating a frame to the start leg can only ever render the refusal.
 * Top-level behavior is unchanged.
 *
 * The framed flow SETTLES (2026-08-15, second pass - a login defect measured on the
 * real customer app): signIn() returns a Promise<boolean>, and both outcomes -
 * signed in, or popup closed without signing in - dispatch a cancelable
 * `ekoa:sso-complete` / `ekoa:sso-cancelled` event and then reload the frame unless
 * the app calls preventDefault(). Without this, an app that flips a button into a
 * loading state on click (as the ERP does) spins FOREVER when the user cancels: the
 * frame no longer navigates away, so nothing ever tells the app the flow ended, and
 * no already-built bundle can be taught to listen. The 150-tick budget with the
 * popup still OPEN stops watching without reloading - the user may still be at the
 * provider.
 */

/** Inject the app context into a served HTML document (placement carried exactly:
 *  base tag right after `<head>`, the script right before `</head>`, both appended
 *  when the document has no head tags). */
export function injectAppContext(html: string, appId: string): string {
  const script = `<script>
window.__EKOA_APP_ID=${JSON.stringify(appId)};
(function(){
  var APP_DATA_PREFIX='/api/app-data/';
  var SHARED_DATA_PREFIX='/api/app-shared/';
  function ekoaFetch(path,options){
    options=options||{};
    var headers=Object.assign({
      'Content-Type':'application/json',
      'X-Ekoa-App-Id':window.__EKOA_APP_ID
    },options.headers||{});
    return fetch(path,Object.assign({},options,{headers:headers}));
  }
  function unwrap(res){
    return res.json().then(function(json){
      if(!res.ok){throw new Error((json&&json.error)||('Request failed: '+res.status));}
      return json&&json.data;
    });
  }
  var ssoWatchTimer=null;
  function watchSsoPopup(w){
    if(ssoWatchTimer){clearInterval(ssoWatchTimer);ssoWatchTimer=null;}
    var ticks=0,closedTicks=0,baseline,done=false;
    function sessionKey(u){return u?String(u.email||'')+'|'+String(u.oid||'')+'|'+String(!!u.canSendMail):null;}
    function probeSession(){
      return ekoaFetch('/api/app-sso/session').then(function(res){return res.json();}).then(function(j){
        return sessionKey(j&&j.data);
      });
    }
    return new Promise(function(resolve){
      function settle(signedIn){
        if(done)return; done=true;
        if(ssoWatchTimer){clearInterval(ssoWatchTimer);ssoWatchTimer=null;}
        // The app cannot know the popup finished, so its own pending UI (a spinner on the
        // sign-in button) would stay forever - the frame no longer navigates away as it did
        // before the popup existed. Reloading restores the truth from the server in BOTH
        // outcomes. An app that would rather keep its in-page state listens for the event
        // and calls preventDefault(); every already-built bundle has no listener and gets
        // the reload that unsticks it.
        var handled=false;
        try{handled=!window.dispatchEvent(new CustomEvent('ekoa:sso-'+(signedIn?'complete':'cancelled'),{cancelable:true}));}catch(_){}
        resolve(!!signedIn);
        if(!handled)window.location.reload();
      }
      probeSession().then(function(k){baseline=k;}).catch(function(){baseline=null;});
      ssoWatchTimer=setInterval(function(){
        ticks++;
        var closed=true;
        try{closed=!!w.closed;}catch(_){}
        if(closed)closedTicks++;
        probeSession().then(function(k){
          if(k!==null&&k!==baseline)return void settle(true);
          if(closedTicks>1)return void settle(false);
          // Popup still open past the budget: the user may still be mid-flow at the
          // provider, so stop watching WITHOUT reloading under them.
          if(ticks>150){done=true;clearInterval(ssoWatchTimer);ssoWatchTimer=null;resolve(false);}
        }).catch(function(){
          if(closedTicks>1)return void settle(false);
          if(ticks>150){done=true;clearInterval(ssoWatchTimer);ssoWatchTimer=null;resolve(false);}
        });
      },2000);
    });
  }
  window.__ekoa={
    fetch:ekoaFetch,
    list:function(collection){
      return ekoaFetch(APP_DATA_PREFIX+collection).then(unwrap).then(function(d){return Array.isArray(d)?d:[];});
    },
    get:function(collection,id){
      return ekoaFetch(APP_DATA_PREFIX+collection+'/'+encodeURIComponent(id)).then(function(res){
        if(res.status===404)return null;
        return unwrap(res);
      });
    },
    create:function(collection,data){
      return ekoaFetch(APP_DATA_PREFIX+collection,{method:'POST',body:JSON.stringify(data||{})}).then(unwrap);
    },
    update:function(collection,id,patch){
      return ekoaFetch(APP_DATA_PREFIX+collection+'/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(patch||{})}).then(unwrap);
    },
    delete:function(collection,id){
      return ekoaFetch(APP_DATA_PREFIX+collection+'/'+encodeURIComponent(id),{method:'DELETE'}).then(function(res){
        if(res.status===404)return false;
        if(!res.ok)throw new Error('Request failed: '+res.status);
        return true;
      });
    },
    shared:{
      list:function(collection){
        return ekoaFetch(SHARED_DATA_PREFIX+collection).then(unwrap).then(function(d){return Array.isArray(d)?d:[];});
      },
      get:function(collection,id){
        return ekoaFetch(SHARED_DATA_PREFIX+collection+'/'+encodeURIComponent(id)).then(function(res){
          if(res.status===404)return null;
          return unwrap(res);
        });
      },
      create:function(collection,data){
        return ekoaFetch(SHARED_DATA_PREFIX+collection,{method:'POST',body:JSON.stringify(data||{})}).then(unwrap);
      },
      update:function(collection,id,patch){
        return ekoaFetch(SHARED_DATA_PREFIX+collection+'/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(patch||{})}).then(unwrap);
      },
      delete:function(collection,id){
        return ekoaFetch(SHARED_DATA_PREFIX+collection+'/'+encodeURIComponent(id),{method:'DELETE'}).then(function(res){
          if(res.status===404)return false;
          if(!res.ok)throw new Error('Request failed: '+res.status);
          return true;
        });
      }
    },
    uploadFile:function(file,opts){
      return fetch('/api/app-files',{
        method:'POST',
        headers:{
          'X-Ekoa-App-Id':window.__EKOA_APP_ID,
          'X-Filename':encodeURIComponent((opts&&opts.name)||(file&&file.name)||'unnamed'),
          'Content-Type':(file&&file.type)||'application/octet-stream'
        },
        body:file
      }).then(unwrap);
    },
    deleteFile:function(id){
      return ekoaFetch('/api/app-files/'+window.__EKOA_APP_ID+'/'+encodeURIComponent(id),{method:'DELETE'}).then(function(res){
        if(res.status===404)return false;
        if(!res.ok)throw new Error('Request failed: '+res.status);
        return true;
      });
    },
    signIn:function(returnPath){
      var target=window.location.href;
      if(returnPath){try{target=new URL(returnPath,window.location.href).href;}catch(_){}}
      var ret;
      try{var t=new URL(target);ret=t.pathname+t.search;}catch(_){ret=window.location.pathname;}
      var u='/api/app-sso/microsoft/start?appId='+encodeURIComponent(window.__EKOA_APP_ID)+'&return='+encodeURIComponent(ret);
      var framed=false;
      try{framed=window.self!==window.top;}catch(_){framed=true;}
      if(framed){
        var w=null;
        try{w=window.open(u,'__ekoa_sso_'+window.__EKOA_APP_ID);}catch(_){}
        if(w)return watchSsoPopup(w);
        console.warn('[ekoa] sign-in popup blocked - allow pop-ups for this site and try again');
        return Promise.resolve(false);
      }
      window.location.assign(u);
    },
    whoami:function(){
      return ekoaFetch('/api/app-sso/me').then(function(res){
        if(res.status===401)return null;
        return unwrap(res);
      });
    },
    signOut:function(){
      return ekoaFetch('/api/app-sso/logout',{method:'POST'}).then(function(res){return res.ok;});
    },
    graphFetch:function(path,options){
      options=options||{};
      var headers=Object.assign({'X-Ekoa-App-Id':window.__EKOA_APP_ID},options.headers||{});
      return fetch('/api/app-sso/m365/'+path,Object.assign({},options,{headers:headers,credentials:'include'}));
    },
    passwordSignIn:function(identity,password,opts){
      opts=opts||{};
      return fetch('/api/app-sso/login',{method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json','X-Ekoa-App-Id':window.__EKOA_APP_ID},
        body:JSON.stringify({collection:opts.collection||'utilizadores',identityField:opts.identityField||'email',identity:identity,password:password})
      }).then(function(res){return res.json().catch(function(){return{};}).then(function(j){return {ok:res.ok,status:res.status,data:j&&j.data,error:j&&j.error};});});
    },
    setUserPassword:function(o){
      o=o||{};
      return fetch('/api/app-sso/set-password',{method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json','X-Ekoa-App-Id':window.__EKOA_APP_ID},
        body:JSON.stringify({collection:o.collection||'utilizadores',identityField:o.identityField||'email',identity:o.identity,password:o.password})
      }).then(function(res){return res.json().catch(function(){return{};}).then(function(j){return {ok:res.ok,status:res.status,error:j&&j.error};});});
    },
    exportPdf:function(opts){
      opts=opts||{};
      var html=opts.html;
      if(!html){
        var root=document.documentElement.cloneNode(true);
        var kill=root.querySelectorAll('script,.no-print,[data-no-pdf]');
        for(var i=kill.length-1;i>=0;i--){var n=kill[i];if(n&&n.parentNode)n.parentNode.removeChild(n);}
        html='<!DOCTYPE html>'+root.outerHTML;
      }
      return ekoaFetch('/api/app-pdf',{method:'POST',body:JSON.stringify({html:html,format:opts.format,landscape:!!opts.landscape})})
        .then(unwrap)
        .then(function(d){
          if(opts.download!==false){
            var name=String(opts.filename||document.title||'documento').replace(/[^\\w\\- .]+/g,' ').trim()||'documento';
            var a=document.createElement('a');
            a.href=d.url;
            a.download=name.replace(/\\.pdf$/i,'')+'.pdf';
            document.body.appendChild(a);a.click();document.body.removeChild(a);
          }
          return d;
        });
    },
    cloudFiles:{
      status:function(){
        return ekoaFetch('/api/app-cloud-files/status').then(unwrap);
      },
      upload:function(file,opts){
        opts=opts||{};
        return fetch('/api/app-cloud-files/'+encodeURIComponent(opts.provider||'microsoft')+'/upload',{
          method:'POST',
          headers:{
            'X-Ekoa-App-Id':window.__EKOA_APP_ID,
            'X-Filename':encodeURIComponent(opts.name||(file&&file.name)||'documento'),
            'Content-Type':(opts.type||(file&&file.type))||'application/octet-stream'
          },
          body:file
        }).then(unwrap);
      },
      list:function(provider,query){
        return ekoaFetch('/api/app-cloud-files/'+encodeURIComponent(provider)+'/list'+(query?'?query='+encodeURIComponent(query):'')).then(unwrap);
      },
      download:function(provider,id){
        return fetch('/api/app-cloud-files/'+encodeURIComponent(provider)+'/download?id='+encodeURIComponent(id),{
          headers:{'X-Ekoa-App-Id':window.__EKOA_APP_ID}
        }).then(function(res){
          if(!res.ok){
            return res.json().catch(function(){return{};}).then(function(j){throw new Error((j&&j.error)||('Request failed: '+res.status));});
          }
          var name='ficheiro';
          try{name=decodeURIComponent(res.headers.get('X-Filename')||'')||name;}catch(_){}
          return res.blob().then(function(blob){return{name:name,type:res.headers.get('Content-Type')||blob.type,blob:blob};});
        });
      }
    }
  };
})();
(function(){
  try{
    if(window.name&&window.name.lastIndexOf('__ekoa_sso_',0)===0&&window.opener){
      var opener=window.opener;
      try{
        if(opener!==window&&opener.__EKOA_APP_ID===window.__EKOA_APP_ID&&opener.self!==opener.top){
          window.name='';
          try{opener.location.reload();}catch(_){}
          window.close();
        }
      }catch(_){/* cross-origin or dead opener - leave this window alone */}
    }
  }catch(_){}
})();
(function(){
  try {
    var reported = false;
    var firstError = null;
    var DELAY_MS = 3000;
    var MAX_MS = 10000;

    function captureMessage(e){
      try {
        if (e && e.error && e.error.message) return String(e.error.message);
        if (e && e.message) return String(e.message);
        if (e && e.reason) {
          if (e.reason.message) return String(e.reason.message);
          return String(e.reason);
        }
      } catch (_) {}
      return '';
    }

    window.addEventListener('error', function(e){
      if (firstError) return;
      firstError = { reason: 'uncaught-error', message: captureMessage(e) || 'Error' };
    });
    window.addEventListener('unhandledrejection', function(e){
      if (firstError) return;
      firstError = { reason: 'unhandled-rejection', message: captureMessage(e) || 'UnhandledRejection' };
    });

    function bodyHasContent(){
      try {
        var b = document.body;
        if (!b) return false;
        if (b.children && b.children.length > 0) return true;
        var txt = (b.textContent || '').replace(/\\s+/g, '');
        return txt.length > 0;
      } catch (_) { return true; }
    }

    function report(){
      if (reported) return;
      reported = true;
      var now = new Date().toISOString();
      var payload;
      if (firstError) {
        payload = { status: 'broken', reason: firstError.reason, errorMessage: (firstError.message || '').slice(0, 500), capturedAt: now };
      } else if (!bodyHasContent()) {
        payload = { status: 'broken', reason: 'empty-dom', errorMessage: null, capturedAt: now };
      } else {
        payload = { status: 'healthy', reason: null, errorMessage: null, capturedAt: now };
      }
      try {
        fetch('/api/app-health', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Ekoa-App-Id': window.__EKOA_APP_ID },
          body: JSON.stringify(payload),
          keepalive: true
        }).catch(function(){});
      } catch (_) {}
    }

    function schedule(){ setTimeout(report, DELAY_MS); }
    setTimeout(function(){ if (!reported) report(); }, MAX_MS);
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });
  } catch (_) { /* probe must never crash the app */ }
})();
</script>
<script src="/__ekoa/demo-bridge.js"></script>
<script src="/__ekoa/action-runtime.js"></script>`;
  // <base> makes relative asset URLs (./bundle.js) resolve from the app root on
  // DEEP paths too (/apps/<id>/rota/sub) - without it a hard reload of a
  // BrowserRouter sub-route 404s its own bundle. /api/... and /apps/... URLs are
  // absolute and unaffected; react-router uses its basename, not the DOM base.
  const baseTag = `<base href="/apps/${appId}/">`;
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>${baseTag}`);
  }
  if (html.includes('</head>')) {
    return html.replace('</head>', script + '</head>');
  }
  return html + '\n' + baseTag + script;
}
