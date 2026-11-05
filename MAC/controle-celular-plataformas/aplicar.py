#!/usr/bin/env python3
"""Controle do Celular: separa a tela em duas, iPhone | Android.

Edita o bundle do renderer (index-Dun7lr2S.js) e cria:
  - seletor de plataforma no topo do modal (iPhone / Android, com contagem)
  - lista de dispositivos filtrada por plataforma
  - abas por plataforma (Identidade simulada só no Android, com aviso)
  - no iPhone: sem ADB, sem IP/pareamento/busca de rede (desabilitados com aviso)
    e um guia de conexão próprio
  - controles root (reiniciar/desligar) desabilitados no iPhone com aviso

Uso:
  python3 aplicar.py <bundle-original.js> <bundle-saida.js>

O arquivo de saída é validado com node --check (como módulo .mjs) antes de gravar.
"""
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

if len(sys.argv) != 3:
    print('uso: aplicar.py <origem.js> <saida.js>')
    sys.exit(2)

origem = pathlib.Path(sys.argv[1])
saida = pathlib.Path(sys.argv[2])
s = origem.read_text(encoding='utf-8')
total_original = len(s)
passos = []


def rep(velho, novo, rotulo, esperado=1):
    global s
    n = s.count(velho)
    if n != esperado:
        raise SystemExit(f'[{rotulo}] esperava {esperado} ocorrência(s), achei {n}: {velho[:90]!r}')
    s = s.replace(velho, novo)
    passos.append(rotulo)
    if os.environ.get('CHECK_EACH'):
        with tempfile.TemporaryDirectory() as tmp:
            prova = pathlib.Path(tmp) / 'b.mjs'
            prova.write_text(s, encoding='utf-8')
            r = subprocess.run(['node', '--check', str(prova)], capture_output=True, text=True)
            if r.returncode != 0:
                msg = r.stderr.split('SyntaxError')[-1][:200]
                raise SystemExit(f'quebrou em [{rotulo}]: SyntaxError{msg}')


def match_paren(texto, abertura):
    """Índice APÓS o ')' que casa com o '(' em `abertura`."""
    i, prof, instr, esc = abertura, 0, None, False
    while i < len(texto):
        ch = texto[i]
        if instr:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == instr:
                instr = None
        else:
            if ch in '"\'`':
                instr = ch
            elif ch == '(':
                prof += 1
            elif ch == ')':
                prof -= 1
                if prof == 0:
                    return i + 1
        i += 1
    raise ValueError('parêntese sem fechamento')


# ── 0. sanidade: o bundle é o esperado ───────────────────────────────────────
for marca in ['function III({onClose:I})', 'DISPOSITIVOS REAIS CONECTADOS', 'Suíte de Hardware']:
    if marca not in s:
        raise SystemExit('bundle inesperado, falta: ' + marca)

# ── 1. estados novos: plataforma + escolha manual ────────────────────────────
rep(
    ',[dl,Jl]=F.useState({width:900,height:620,x:120,y:60}),SI=window.electronAPI',
    ',[dl,Jl]=F.useState({width:900,height:620,x:120,y:60}),[pPlat,pSetPlat]=F.useState("android"),'
    '[pUserPicked,pSetPicked]=F.useState(!1),'
    '[pIphoneModel,pSetIphoneModel]=F.useState("iPhone 15"),[pProxy,pSetProxy]=F.useState(""),'
    '[pProxyMsg,pSetProxyMsg]=F.useState(""),[pProxyStatus,pSetProxyStatus]=F.useState("ok"),SI=window.electronAPI',
    'estados pPlat/pUserPicked',
)

# ── 2. abas: contagem/estado passam a usar a lista filtrada ─────────────────
ini_abas = s.find('b.jsxs("div",{className:"flex border-b border-white/5 bg-black/20 flex-shrink-0",style:')
fim_abas = s.find('b.jsxs("div",{className:"flex-1 overflow-auto p-6 bg-black/10",children:[', ini_abas)
if ini_abas < 0 or fim_abas < 0 or fim_abas <= ini_abas:
    raise SystemExit('não achei a região das abas')
regiao = s[ini_abas:fim_abas]
if regiao.count('e.length') != 11:
    raise SystemExit(f'abas: esperava 11 e.length, achei {regiao.count("e.length")}')
s = s[:ini_abas] + regiao.replace('e.length', 'pDevices.length') + s[fim_abas:]
passos.append('abas filtradas (11 usos de e.length)')

# ── 3. aba Identidade simulada: liberada também no iPhone ──────────────────
# (antes ficava desabilitada com selo ANDROID; agora abre nos dois lados)

# ── 4. definições derivadas (lista filtrada, contagens, ícones) ─────────────
APPLE = ('M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014'
         '-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 '
         '1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 '
         '3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857'
         '-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 '
         '1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805'
         '-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701')
ANDROID = ('M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997 0-.5511.4482-.9993.9993-.9993'
           '.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997zm-11.046 0c-.5511 '
           '0-.9993-.4486-.9993-.9997 0-.5511.4482-.9993.9993-.9993.5511 0 .9993.4482 '
           '.9993.9993 0 .5511-.4482.9997-.9993.9997zm11.4045-6.02l1.9973-3.4592a.416.416 '
           '0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.2439 13.8533 '
           '7.8508 12 7.8508s-3.5902.3931-5.1367 1.0989L4.841 5.4467a.4161.4161 0 '
           '00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 '
           '14.6589 0 18.761h24c-.3435-4.1021-2.6892-7.5743-6.1185-9.4396z')

DEFS = (
    '},[c]);const pIsIos=pPlat==="ios",'
    'pDevices=e.filter(pD=>pIsIos?pD.ios||String(pD.id).startsWith("ios-"):!(pD.ios||String(pD.id).startsWith("ios-"))),'
    'pIosCount=e.filter(pD=>pD.ios||String(pD.id).startsWith("ios-")).length,'
    'pAndroidCount=e.length-pIosCount,'
    'pIphoneModels=["iPhone 7","iPhone 7 Plus","iPhone 8","iPhone 8 Plus","iPhone X","iPhone XR","iPhone XS","iPhone XS Max","iPhone 11","iPhone 11 Pro","iPhone 11 Pro Max","iPhone SE (2ª geração)","iPhone 12 mini","iPhone 12","iPhone 12 Pro","iPhone 12 Pro Max","iPhone 13 mini","iPhone 13","iPhone 13 Pro","iPhone 13 Pro Max","iPhone SE (3ª geração)","iPhone 14","iPhone 14 Plus","iPhone 14 Pro","iPhone 14 Pro Max","iPhone 15","iPhone 15 Plus","iPhone 15 Pro","iPhone 15 Pro Max","iPhone 16","iPhone 16 Plus","iPhone 16 Pro","iPhone 16 Pro Max","iPhone 16e","iPhone 17","iPhone 17 Air","iPhone 17 Pro","iPhone 17 Pro Max","iPhone 18","iPhone 18 Air","iPhone 18 Pro","iPhone 18 Pro Max"],'
    'pValidProxy=pV=>{let pV2=pV.trim();["http://","https://","socks5://","socks5h://","socks4://"].forEach(pSch=>{pV2.startsWith(pSch)&&(pV2=pV2.slice(pSch.length))});const pAt=pV2.lastIndexOf("@"),pHostPort=(pAt>=0?pV2.slice(pAt+1):pV2).split(":"),pPort=pHostPort[1]||"";return pHostPort.length>=2&&pHostPort[0].length>2&&pPort.length>=2&&pPort.length<=5&&pPort.split("").every(pCh=>pCh>="0"&&pCh<="9")},'
    'pClearIos=()=>{W&&SI&&SI.invoke("iphone:proxy:clear",{id:W}).catch(()=>{}),W&&(localStorage.removeItem("nova_iphone_model_"+W),localStorage.removeItem("nova_iphone_proxy_"+W)),pSetProxy(""),pSetIphoneModel("iPhone 15"),pSetProxyMsg(""),RI(null),VI("idle"),kI("Perfil do iPhone removido do Nova.")},'
    'pSaveProxy=async()=>{const pV=pProxy.trim();if(!pV){W&&SI&&await SI.invoke("iphone:proxy:clear",{id:W}).catch(()=>{}),W&&localStorage.removeItem("nova_iphone_proxy_"+W),pSetProxyMsg("Proxy removido do iPhone."),pSetProxyStatus("ok");return}if(!pValidProxy(pV)){pSetProxyMsg("Formato inválido. Use socks5://host:porta:usuario:senha."),pSetProxyStatus("error");return}if(!W||!SI){pSetProxyMsg("Nenhum iPhone selecionado."),pSetProxyStatus("error");return}pSetProxyMsg("Aplicando no iPhone..."),pSetProxyStatus("ok");const pR=await SI.invoke("iphone:proxy:set",{id:W,proxy:pV}).catch(pE=>({success:!1,error:String(pE&&pE.message||pE)}));if(pR&&pR.success){localStorage.setItem("nova_iphone_proxy_"+W,pV),pSetProxyMsg("Proxy aplicado no iPhone."),pSetProxyStatus("ok")}else{pSetProxyMsg("Falha: "+((pR&&pR.error)||"não consegui aplicar")),pSetProxyStatus("error")}},'
    'pSaveIos=async()=>{if(!W)return;const pV=pProxy.trim();if(pV&&!pValidProxy(pV)){pSetProxyMsg("Formato inválido. Use socks5://host:porta:usuario:senha."),pSetProxyStatus("error");return}if(pV&&SI){pSetProxyMsg("Aplicando proxy no iPhone..."),pSetProxyStatus("ok");const pR=await SI.invoke("iphone:proxy:set",{id:W,proxy:pV}).catch(pE=>({success:!1,error:String(pE&&pE.message||pE)}));if(!(pR&&pR.success)){pSetProxyMsg("Falha: "+((pR&&pR.error)||"não consegui aplicar o proxy")),pSetProxyStatus("error");return}}W&&(localStorage.setItem("nova_iphone_model_"+W,pIphoneModel),pV?localStorage.setItem("nova_iphone_proxy_"+W,pV):localStorage.removeItem("nova_iphone_proxy_"+W)),RI({ios:!0,model:pIphoneModel,proxy:pV||"—"}),VI("success"),kI("Identidade do iPhone salva no Nova. Modelo: "+pIphoneModel+(pV?" · Proxy: "+pV+" (aplicado no aparelho)":"")+". A troca de modelo no aparelho ainda depende do hook do jailbreak.")},'
    'pPick=pX=>{pSetPicked(!0),pSetPlat(pX)},'
    'pAppleIcon=({size:pSz=12,className:pCls})=>b.jsx("svg",{width:pSz,height:pSz,viewBox:"0 0 24 24",fill:"currentColor",'
    '"aria-hidden":"true",className:pCls,children:b.jsx("path",{d:"' + APPLE + '"})}),'
    'pAndroidIcon=({size:pSz=12,className:pCls})=>b.jsx("svg",{width:pSz,height:pSz,viewBox:"0 0 24 24",fill:"currentColor",'
    '"aria-hidden":"true",className:pCls,children:b.jsx("path",{d:"' + ANDROID + '"})}),'
    'gG=pDevices.find(eI=>eI.id===W)'
)
rep('},[c]);const gG=e.find(eI=>eI.id===W)', DEFS, 'lista filtrada + ícones')

# ── 5. efeitos: seguir a plataforma do aparelho e ajustar a seleção ─────────
EFEITOS = (
    ';F.useEffect(()=>{if(!pUserPicked&&e.length>0){const pAuto=e[0].ios||String(e[0].id).startsWith("ios-")?"ios":"android";'
    'pAuto!==pPlat&&pSetPlat(pAuto)}},[e]);'
    'F.useEffect(()=>{const pList=pDevices;'
    'pList.length>0&&!pList.some(pD=>pD.id===W)&&N(pList[0].id);'
    'pList.length===0&&c!=="devices"&&d("devices")},[pPlat,e]);'
    'F.useEffect(()=>{if(pIsIos&&W){pSetIphoneModel(localStorage.getItem("nova_iphone_model_"+W)||"iPhone 15"),pSetProxy(localStorage.getItem("nova_iphone_proxy_"+W)||""),pSetProxyMsg("");SI&&SI.invoke("iphone:proxy:status",{id:W}).then(pR=>{pR&&pR.success&&pR.on&&(pSetProxyMsg("Ativo no iPhone: "+(pR.upstream||"proxy")),pSetProxyStatus("ok"))}).catch(()=>{})}},[W,pIsIos]);'
    'return Fl?b.jsx("div",{className:"fixed inset-0 z-[9990]'
)
rep(';return Fl?b.jsx("div",{className:"fixed inset-0 z-[9990]', EFEITOS, 'efeitos de plataforma/seleção')

# ── 6. seletor de plataforma acima das abas ────────────────────────────────
PLATAFORMA = (
    'b.jsxs("div",{className:"flex items-center gap-2.5 px-3 md:px-5 py-2 bg-black/40 border-b border-white/5 flex-shrink-0",children:['
    'b.jsx("span",{className:"hidden sm:block text-[8px] font-black text-white/25 uppercase tracking-[0.24em]",children:"Plataforma"}),'
    'b.jsxs("div",{className:"flex p-0.5 rounded-xl bg-black/50 border border-white/10 gap-0.5",children:['
    'b.jsxs("button",{onClick:()=>pPick("ios"),className:`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${pIsIos?"":"text-white/40 hover:text-white/70"}`,style:pIsIos?{background:"#fff",color:"#000",boxShadow:"0 0 16px rgba(255,255,255,0.18)"}:null,children:['
    'b.jsx(pAppleIcon,{size:12}),"iPhone",'
    'b.jsx("span",{className:`text-[8px] px-1 rounded ${pIsIos?"bg-black/10 text-black/60":"bg-white/5 text-white/35"}`,children:pIosCount})]}),'
    'b.jsxs("button",{onClick:()=>pPick("android"),className:`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${!pIsIos?"":"text-white/40 hover:text-white/70"}`,style:!pIsIos?{background:"#3ddc84",color:"#000",boxShadow:"0 0 16px rgba(61,220,132,0.22)"}:null,children:['
    'b.jsx(pAndroidIcon,{size:12}),"Android",'
    'b.jsx("span",{className:`text-[8px] px-1 rounded ${!pIsIos?"bg-black/10 text-black/60":"bg-white/5 text-white/35"}`,children:pAndroidCount})]})'
    ']}),'
    'b.jsx("span",{className:"ml-auto hidden md:block text-[8px] font-black uppercase tracking-[0.18em] text-white/25",children:pIsIos?"USB · Atalhos · Jailbreak":"USB · Wi-Fi · ADB"})'
    ']}),'
)
TAB_KEY = 'b.jsxs("div",{className:"flex border-b border-white/5 bg-black/20 flex-shrink-0",style:'
rep(TAB_KEY, PLATAFORMA + TAB_KEY, 'seletor iPhone | Android')

# ── 7. botão Reparar ADB: desabilitado no iPhone ───────────────────────────
rep(
    'b.jsx("button",{onClick:XG,disabled:v,className:"hidden sm:block px-2 py-1 bg-white/5 border border-white/10 hover:border-j-cyan/40 text-j-cyan rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",title:"Reiniciar ADB",children:"Reparar ADB"})',
    'pIsIos?b.jsx("span",{className:"hidden sm:block px-2 py-1 bg-white/5 border border-white/10 text-white/25 rounded-lg text-[9px] font-black uppercase tracking-wider cursor-not-allowed",title:"Exclusivo Android",children:"Reparar ADB"}):'
    'b.jsx("button",{onClick:XG,disabled:v,className:"hidden sm:block px-2 py-1 bg-white/5 border border-white/10 hover:border-j-cyan/40 text-j-cyan rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",title:"Reiniciar ADB",children:"Reparar ADB"})',
    'Reparar ADB só no Android',
)

# ── 8. faixa "Modo iPhone" no topo do conteúdo ─────────────────────────────
BANNER = (
    'pIsIos&&b.jsxs("div",{className:"mb-3 flex flex-wrap items-center gap-1.5",children:['
    'b.jsx("span",{className:"text-[9px] font-black text-white uppercase tracking-widest mr-1",children:"Modo iPhone"}),'
    '["USB","Atalhos","Câmera por jailbreak","Sem ADB"].map(pC=>b.jsx("span",{className:"px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[8px] font-bold text-white/50 uppercase tracking-wider",children:pC},pC))'
    ']}),'
)
rep(
    'b.jsxs("div",{className:"flex-1 overflow-auto p-6 bg-black/10",children:[',
    'b.jsxs("div",{className:"flex-1 overflow-auto p-6 bg-black/10",children:[' + BANNER,
    'faixa Modo iPhone',
)

# ── 9. tela Dispositivos: textos e lista por plataforma ─────────────────────
rep(
    'children:"DISPOSITIVOS REAIS CONECTADOS"',
    'children:pIsIos?"IPHONES CONECTADOS":"ANDROIDS CONECTADOS"',
    'título dos dispositivos',
)
rep(
    'children:pIsIos?"IPHONES CONECTADOS":"ANDROIDS CONECTADOS"}),e.length===0?',
    'children:pIsIos?"IPHONES CONECTADOS":"ANDROIDS CONECTADOS"}),pDevices.length===0?',
    'estado vazio por plataforma',
)
rep(
    'children:"Nenhum dispositivo USB ou Wi-Fi detectado."',
    'children:pIsIos?"Nenhum iPhone conectado.":"Nenhum Android conectado."',
    'texto vazio (título)',
)
rep(
    'children:"Conecte seu celular via USB com a depuração USB ativada."',
    'children:pIsIos?"Conecte o iPhone por USB e toque em Confiar neste computador.":"Conecte o celular por USB com a Depuração USB ativada."',
    'texto vazio (dica)',
)
rep('children:e.map(', 'children:pDevices.map(', 'cartões de dispositivo filtrados')

# ── 10. conexão por IP / pareamento / rede: desabilitadas no iPhone ────────
rep(
    'children:[b.jsxs("div",{className:"flex items-center gap-2",children:[b.jsx("button",{onClick:()=>g("direct")',
    'children:[b.jsxs("div",{className:"flex items-center gap-2",style:pIsIos?{opacity:.4,pointerEvents:"none"}:null,children:[b.jsx("button",{onClick:()=>g("direct")',
    'modos de conexão esmaecidos no iOS',
)
rep(
    'onClick:yG,disabled:v,className:"px-4 py-2 bg-j-cyan/10',
    'onClick:()=>pIsIos||yG(),disabled:v||pIsIos,style:pIsIos?{opacity:.4}:null,className:"px-4 py-2 bg-j-cyan/10',
    'busca na rede desabilitada no iOS',
)
for cond, rotulo in [('Q==="direct"&&', 'form direto'), ('Q==="pair"&&', 'form pareamento'), ('Q==="guide"&&', 'guia Android')]:
    rep(cond, '!pIsIos&&' + cond, rotulo + ' oculto no iOS')

rep(
    ',!pIsIos&&Q==="direct"&&b.jsxs("form"',
    ',pIsIos&&b.jsx("p",{className:"text-[8px] font-black text-white/25 uppercase tracking-widest",children:"Exclusivo Android · conexão por IP, pareamento e busca na rede usam ADB"}),!pIsIos&&Q==="direct"&&b.jsxs("form"',
    'aviso Exclusivo Android na conexão',
)

# ── 11. guia de conexão do iPhone (último filho do bloco de conexão) ───────
GUIA_IOS = (
    ',pIsIos&&b.jsxs("div",{className:"p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3 max-w-xl text-[11px] text-white/70",children:['
    'b.jsxs("div",{className:"flex items-center gap-2",children:['
    'b.jsx(pAppleIcon,{size:12}),'
    'b.jsx("span",{className:"font-bold text-white uppercase tracking-wider text-xs",children:"Como conectar seu iPhone"})]}),'
    'b.jsxs("ol",{className:"list-decimal list-inside space-y-1.5 leading-relaxed text-white/80",children:['
    'b.jsx("li",{children:"Conecte o iPhone ao Mac com um cabo USB."}),'
    'b.jsxs("li",{children:["No iPhone, toque em ",b.jsx("strong",{children:"Confiar"}),\' quando aparecer "Confiar neste computador?".\']}),'
    'b.jsxs("li",{children:["O aparelho aparece acima com o ID ",b.jsx("code",{children:"ios-..."}),". Selecione e clique em ",b.jsx("strong",{children:"Conectar"})," para abrir o console USB."]}),'
    'b.jsxs("li",{children:["Wi-Fi e Bluetooth usam os atalhos ",b.jsx("code",{children:"Nova WiFi On / Nova WiFi Off"})," no app Atalhos do iPhone."]}),'
    'b.jsxs("li",{children:["A câmera exige jailbreak + OBSGraphBridge (",b.jsx("code",{children:"instalar-iphone.command"}),")."]})'
    ']}),'
    'b.jsx("p",{className:"text-[9px] text-white/30 uppercase tracking-widest leading-relaxed",children:"Conexão por IP, pareamento e busca na rede são exclusivos do Android (ADB)."})'
    ']})'
)
bloco = s.find('b.jsxs("div",{className:"border-t border-white/5 pt-6 space-y-4",children:[')
if bloco < 0:
    raise SystemExit('não achei o bloco de conexão')
abre = s.find('(', bloco + len('b.jsxs'))
fim = match_paren(s, abre)
if s[fim - 3:fim] != ']})':
    raise SystemExit('fim inesperado do bloco de conexão: ' + s[fim - 12:fim])
s = s[:fim - 3] + GUIA_IOS + s[fim - 3:]
passos.append('guia do iPhone')

# ── 12. Controles: atalhos no iPhone, comandos root desabilitados ──────────
rep(
    'children:"DISPARADORES DE COMANDOS ROOT"}),b.jsxs("div",{className:"flex gap-3"',
    'children:"DISPARADORES DE COMANDOS ROOT"}),pIsIos&&b.jsx("span",{className:"text-[7px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-1.5 py-0.5 uppercase tracking-wider",children:"Exclusivo Android"}),b.jsxs("div",{className:"flex gap-3"',
    'selo Android nos comandos root',
)
rep(
    'children:b.jsx("div",{className:`w-4 h-4 rounded-full bg-black transition-all ${B?"translate-x-6":"translate-x-0"}`})})]})]}),b.jsxs("div",{className:"border-t border-white/5 pt-6 space-y-3"',
    'children:b.jsx("div",{className:`w-4 h-4 rounded-full bg-black transition-all ${B?"translate-x-6":"translate-x-0"}`})})]})]}),pIsIos&&b.jsx("p",{className:"text-[9px] text-white/35 uppercase tracking-widest leading-relaxed",children:"No iPhone, Wi-Fi e Bluetooth são alternados pelos atalhos Nova WiFi On/Off do app Atalhos."}),b.jsxs("div",{className:"border-t border-white/5 pt-6 space-y-3"',
    'dica dos atalhos no iPhone',
)
rep(
    'b.jsx("button",{onClick:async()=>{SI&&(await SI.invoke("physical-mobile:control-app",{id:W,packageName:"",action:"reboot"})',
    'b.jsx("button",{disabled:pIsIos,style:pIsIos?{opacity:.4}:null,onClick:async()=>{SI&&(await SI.invoke("physical-mobile:control-app",{id:W,packageName:"",action:"reboot"})',
    'reiniciar desabilitado no iOS',
)
rep(
    'b.jsx("button",{onClick:async()=>{SI&&(await SI.invoke("physical-mobile:control-app",{id:W,packageName:"",action:"shutdown"})',
    'b.jsx("button",{disabled:pIsIos,style:pIsIos?{opacity:.4}:null,onClick:async()=>{SI&&(await SI.invoke("physical-mobile:control-app",{id:W,packageName:"",action:"shutdown"})',
    'desligar desabilitado no iOS',
)

# ── 12b. Identidade simulada do iPhone: só modelo (7..18) + proxy ─────────
# Marca escondida
rep(
    'b.jsxs("div",{children:[b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",children:"Marca"})',
    'b.jsxs("div",{style:pIsIos?{display:"none"}:null,children:[b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",children:"Marca"})',
    'Marca escondida no iPhone',
)
# Select de modelo: lista do iPhone quando estiver no modo iPhone
rep(
    'b.jsx("select",{value:D,onChange:eI=>dI(eI.target.value),className:"w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-white text-xs font-bold appearance-none focus:outline-none focus:border-purple-400/50 cursor-pointer",children:(lI[mI]||[]).map(eI=>b.jsxs("option",{value:eI.model,className:"bg-[#0A0F18] text-white",children:[eI.name," (",eI.model,")"]},eI.model))})',
    'b.jsx("select",{value:pIsIos?pIphoneModel:D,onChange:pIsIos?pE=>pSetIphoneModel(pE.target.value):eI=>dI(eI.target.value),className:"w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-white text-xs font-bold appearance-none focus:outline-none focus:border-purple-400/50 cursor-pointer",children:pIsIos?pIphoneModels.map(pM=>b.jsx("option",{value:pM,className:"bg-[#0A0F18] text-white",children:pM},pM)):(lI[mI]||[]).map(eI=>b.jsxs("option",{value:eI.model,className:"bg-[#0A0F18] text-white",children:[eI.name," (",eI.model,")"]},eI.model))})',
    'select de modelo do iPhone (7 a 18)',
)
# Campo de proxy, logo abaixo do modelo
PROXY = (
    'pIsIos&&b.jsxs("div",{children:['
    'b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",children:"Proxy do dispositivo"}),'
    'b.jsxs("div",{className:"flex gap-2",children:['
    'b.jsx("input",{type:"text",value:pProxy,onChange:pE=>{pSetProxy(pE.target.value),pSetProxyMsg("")},placeholder:"socks5://host:porta:usuario:senha",className:"flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-white text-xs font-bold placeholder-white/20 focus:outline-none focus:border-purple-400/50"}),'
    'b.jsx("button",{onClick:pSaveProxy,className:"px-3 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/40 text-purple-200 text-[10px] font-black uppercase tracking-wider hover:bg-purple-500/20 transition-all",children:"Salvar"})'
    ']}),'
    'pProxyMsg&&b.jsx("p",{className:`text-[9px] mt-1 font-bold ${pProxyStatus==="error"?"text-red-400":"text-emerald-400"}`,children:pProxyMsg})'
    ']}),'
)
rep(
    ',b.jsxs("button",{onClick:el,disabled:uI==="applying"||!D',
    ',' + PROXY + 'b.jsxs("button",{onClick:el,disabled:uI==="applying"||!D',
    'campo de proxy do iPhone',
)
# Botão: salvar identidade (iPhone) em vez de aplicar perfil Android
rep(
    'onClick:el,disabled:uI==="applying"||!D,',
    'onClick:pIsIos?pSaveIos:el,disabled:pIsIos?!1:uI==="applying"||!D,',
    'ação do botão no iPhone',
)
rep(
    'uI==="applying"?"Aplicando Falsificação Profunda de IMEI...":"Aplicar Perfil de Falsificação Completo"',
    'pIsIos?"Salvar identidade do iPhone":uI==="applying"?"Aplicando Falsificação Profunda de IMEI...":"Aplicar Perfil de Falsificação Completo"',
    'rótulo do botão no iPhone',
)
# Painel "Identidade aplicada" com campos do iPhone
rep(
    'children:[["Model",k.model],',
    'children:(k.ios?[["Modelo",k.model],["Proxy",k.proxy||"—"],["Perfil","Nova (salvo no app)"]]:[["Model",k.model],',
    'painel aplicado: iPhone',
)
rep(
    '["IMSI",k.imsi]].map(',
    '["IMSI",k.imsi]]).map(',
    'painel aplicado: fecha lista Android',
)
rep(
    'eI==="Model"?"text-white font-bold"',
    'eI==="Model"||eI==="Modelo"?"text-white font-bold"',
    'cor do campo Modelo',
)

# ── 12c. iPhone: esconde ações Android e adapta "Restaurar" ────────────────
rep(
    'uI==="success"&&b.jsxs("button",{onClick:sG',
    'uI==="success"&&!pIsIos&&b.jsxs("button",{onClick:sG',
    'soft reboot escondido no iPhone',
)
rep(
    '(uI==="success"||k)&&b.jsxs("button",{onClick:Kl',
    '(uI==="success"||k)&&!pIsIos&&b.jsxs("button",{onClick:Kl',
    'verificação Android escondida no iPhone',
)
rep(
    'b.jsxs("button",{onClick:fI,disabled:uI==="applying",className:"w-full py-2 bg-white/[0.03] border border-red-500/20 text-red-400/70 rounded-xl font-black text-[10px] uppercase tracking-widest hover:border-red-400/50 hover:text-red-300 transition-all flex items-center justify-center gap-2",children:[b.jsx(en,{size:10})," Restaurar identidade real e reiniciar"]})',
    'b.jsxs("button",{onClick:()=>pIsIos?pClearIos():fI(),disabled:uI==="applying",className:"w-full py-2 bg-white/[0.03] border border-red-500/20 text-red-400/70 rounded-xl font-black text-[10px] uppercase tracking-widest hover:border-red-400/50 hover:text-red-300 transition-all flex items-center justify-center gap-2",children:[b.jsx(en,{size:10}),pIsIos?" Remover identidade salva":" Restaurar identidade real e reiniciar"]})',
    'Restaurar vira Remover no iPhone',
)
rep(
    'b.jsxs("div",{className:"flex items-center gap-2 px-3 py-2 bg-black/30 border border-white/5 rounded-xl",children:[b.jsx("span",{className:"text-[8px] font-black text-white/30 uppercase tracking-widest mr-1",children:"Segurança:"})',
    '!pIsIos&&b.jsxs("div",{className:"flex items-center gap-2 px-3 py-2 bg-black/30 border border-white/5 rounded-xl",children:[b.jsx("span",{className:"text-[8px] font-black text-white/30 uppercase tracking-widest mr-1",children:"Segurança:"})',
    'chips de segurança escondidos no iPhone',
)

rep(
    'b.jsxs("div",{className:"mt-1 space-y-1.5",children:[b.jsx("span",{className:"text-[9px] font-black text-white/30 uppercase tracking-widest block",children:"Propriedades Play Integrity Injetadas"})',
    '!pIsIos&&b.jsxs("div",{className:"mt-1 space-y-1.5",children:[b.jsx("span",{className:"text-[9px] font-black text-white/30 uppercase tracking-widest block",children:"Propriedades Play Integrity Injetadas"})',
    'Play Integrity escondido no iPhone',
)
rep(
    'b.jsxs("div",{className:"mt-2 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl space-y-2",children:[',
    '!pIsIos&&b.jsxs("div",{className:"mt-2 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl space-y-2",children:[',
    'IMEI duplo escondido no iPhone',
)

rep(
    'b.jsxs("div",{className:"mt-2 p-4 bg-gradient-to-r from-blue-900/10 to-purple-900/10 border border-blue-500/15 rounded-2xl space-y-3",children:[',
    '!pIsIos&&b.jsxs("div",{className:"mt-2 p-4 bg-gradient-to-r from-blue-900/10 to-purple-900/10 border border-blue-500/15 rounded-2xl space-y-3",children:[',
    'certificação Play Store escondida no iPhone',
)

# ── 13. validação de sintaxe (ESM) ─────────────────────────────────────────
with tempfile.TemporaryDirectory() as tmp:
    prova = pathlib.Path(tmp) / 'bundle.mjs'
    prova.write_text(s, encoding='utf-8')
    r = subprocess.run(['node', '--check', str(prova)], capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr)
        raise SystemExit('sintaxe inválida — nada foi gravado')

saida.write_text(s, encoding='utf-8')
print(f'ok: {origem.name} → {saida.name}  ({total_original} → {len(s)} bytes, {len(s)-total_original:+d})')
for p in passos:
    print('  ·', p)
