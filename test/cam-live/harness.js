const { register } = require('../../app/electron/services/cam-live-service.js');
const { criarBancada } = require('./harness-servidor.js');

const bancada = criarBancada(8765, 19351);
register({ ipcMain: bancada.ipcMain, getWindow: () => bancada.win, userDataDir: bancada.dir });
console.log('userData de teste:', bancada.dir);

const PAGE = `<!doctype html><meta charset=utf8><title>Nova (harness)</title>
<body style="background:#0F172A;color:#ddd;font-family:sans-serif"><div id=bar style="display:flex;gap:8px;padding:10px;border-bottom:1px solid #234">
<button class="px-3 py-1.5 bg-red-500/10 border-red-500/30 text-red-400" style="padding:6px 12px;border-radius:8px;border:1px solid;background:#2a1418;color:#f87171">AI Upload</button></div>
<script>
window.electronAPI={isMobile:false,
 invoke:(c,...a)=>fetch('/ipc/invoke/'+c,{method:'POST',body:JSON.stringify(a[0]===undefined?null:a[0])}).then(r=>r.json()),
 send:(c,p)=>{ if(p&&p.data) p={...p,data:Array.from(p.data)}; else if(p instanceof Uint8Array) p={__u8:Array.from(p)}; fetch('/ipc/send/'+c,{method:'POST',body:JSON.stringify(p===undefined?null:p)}); },
 on:(c,cb)=>{(window.__on=window.__on||{})[c]=cb;return()=>{}}};
const es=new EventSource('/events'); es.onmessage=e=>{const {ch,p}=JSON.parse(e.data); window.__on&&window.__on[ch]&&window.__on[ch](p)};
</script><script src="/cam-live-audio.js"></script><script src="/cam-live-dados.js"></script><script src="/cam-live-modelo.js"></script><script src="/cam-live-geometria.js"></script><script src="/cam-live.js"></script>`;

bancada.iniciar(PAGE);
