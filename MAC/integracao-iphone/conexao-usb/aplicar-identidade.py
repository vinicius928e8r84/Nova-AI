#!/usr/bin/env python3
import sys, os, shutil

alvo = sys.argv[1] if len(sys.argv) > 1 else ""
aplicar = "--aplicar" in sys.argv
if not alvo:
    print("uso: aplicar-identidade.py ALVO.js [--aplicar]")
    sys.exit(2)

s = open(alvo, encoding="utf8").read()
o = s

for dep, marca in (("aplicar-proxy-tipo.py", "pProxyX="), ("aplicar-idioma.py", "pIdiomas=[")):
    if marca not in s:
        print("ERRO: falta rodar antes o %s (nao achei %s)" % (dep, marca))
        sys.exit(2)

NOVOS_ESTADOS = ('[pIdMsg,pSetIdMsg]=F.useState(""),'
                 '[pIdNome,pSetIdNome]=F.useState(""),'
                 '[pIdPrompt,pSetIdPrompt]=F.useState(!1)')
if "[pIdPrompt,pSetIdPrompt]=F.useState" in s:
    print("ID1 ja aplicado")
elif "[pIdMsg,pSetIdMsg]=F.useState" in s:
    s = s.replace('[pIdMsg,pSetIdMsg]=F.useState("")', NOVOS_ESTADOS, 1)
    print("ID1 ok (acrescentou nome/popup)")
else:
    ANC_HOOK = '[pLangConfirm,pSetLangConfirm]=F.useState(!1)'
    if s.count(ANC_HOOK) != 1:
        print("ID1 ERRO: ancora do estado x%d" % s.count(ANC_HOOK))
        sys.exit(2)
    s = s.replace(ANC_HOOK, ANC_HOOK + "," + NOVOS_ESTADOS)
    print("ID1 ok")

MAPA = ('pPaisIdioma=pC=>{const pM={US:"en-US",GB:"en-GB",AU:"en-AU",CA:"en-CA",NZ:"en-US",IE:"en-GB",'
        'BR:"pt-BR",PT:"pt-PT",ES:"es-ES",MX:"es-419",AR:"es-419",CO:"es-419",CL:"es-419",PE:"es-419",'
        'VE:"es-419",FR:"fr-FR",BE:"fr-FR",DE:"de-DE",AT:"de-DE",CH:"de-DE",IT:"it-IT",NL:"nl-NL",'
        'PL:"pl-PL",RU:"ru-RU",SE:"sv-SE",TR:"tr-TR",SA:"ar-SA",AE:"ar-SA",EG:"ar-SA",IN:"hi-IN",'
        'JP:"ja-JP",KR:"ko-KR",CN:"zh-Hans",TW:"zh-Hant",HK:"zh-Hant"};'
        'return pM[String(pC||"").toUpperCase()]||"en-US"}')
ANC_MAPA = '["zh-Hant","Chinês (tradicional)","zh_TW"]'
if "pPaisIdioma=" in s:
    print("ID1b ja aplicado")
else:
    if s.count(ANC_MAPA) != 1:
        print("ID1b ERRO: ancora da lista de idiomas x%d" % s.count(ANC_MAPA))
        sys.exit(2)
    s = s.replace(ANC_MAPA, ANC_MAPA + "," + MAPA)
    print("ID1b ok")

MODELO = ('b.jsxs("div",{children:['
          'b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",children:"Modelo"}),'
          'b.jsxs("div",{className:"relative",children:['
          'b.jsx("select",{value:pIphoneModel,onChange:pE=>pSetIphoneModel(pE.target.value),'
          'className:"w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-white text-xs '
          'font-bold appearance-none focus:outline-none focus:border-purple-400/50 cursor-pointer",'
          'children:pIphoneModels.map(pM=>b.jsx("option",{value:pM.name,className:"bg-[#0A0F18] text-white",'
          'children:pM.name},pM.productType))}),'
          'b.jsx(Ii,{size:12,className:"absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"})'
          ']})]}),')

IDIOMA = ('b.jsxs("div",{children:['
          'b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",'
          'children:"Idioma do aparelho"}),'
          'b.jsxs("div",{className:"relative",children:['
          'b.jsx("select",{value:pLang,onChange:pE=>{pSetLang(pE.target.value),pSetLangConfirm(!1)},'
          'className:"w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-white text-xs '
          'font-bold appearance-none focus:outline-none focus:border-purple-400/50 cursor-pointer",'
          'children:pIdiomas.map(pX=>b.jsx("option",{value:pX[0],className:"bg-[#0A0F18] text-white",'
          'children:pX[1]+" — "+pX[0]},pX[0]))}),'
          'b.jsx(Ii,{size:12,className:"absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"})'
          ']})]}),')

PROXY = ('b.jsxs("div",{children:['
         'b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",'
         'children:"Proxy do dispositivo"}),'
         'b.jsxs("div",{className:"flex gap-2",children:['
         'b.jsx("select",{value:pProxyX.schemeOf(pProxy),'
         'onChange:pE=>pSetProxy(pProxyX.withScheme(pE.target.value,pProxy)),title:"Tipo da proxy",'
         'className:"bg-white/[0.03] border border-white/10 rounded-xl px-2 py-2.5 text-white text-[10px] '
         'font-black uppercase focus:outline-none focus:border-purple-400/50",'
         'children:[["socks5","SOCKS5"],["socks5h","SOCKS5H"],["http","HTTP"],["https","HTTPS"],["socks4","SOCKS4"]]'
         '.map(pX=>b.jsx("option",{value:pX[0],className:"bg-[#0A121E] text-white",children:pX[1]},pX[0]))}),'
         'b.jsx("input",{type:"text",spellCheck:!1,value:pProxy,'
         'onChange:pE=>{pSetProxy(pE.target.value),pSetProxyMsg("")},'
         'placeholder:"cole em qualquer formato: host:porta@usuario:senha",'
         'className:"flex-1 min-w-0 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-white '
         'text-xs font-bold placeholder-white/20 focus:outline-none focus:border-purple-400/50"})'
         ']}),'
         'b.jsx("p",{className:"text-[9px] mt-1 font-mono "+(pProxyX.parse(pProxy)&&(pProxyX.schemeOf(pProxy)'
         '==="socks5"||pProxyX.schemeOf(pProxy)==="socks5h")?"text-white/40":"text-amber-400"),children:(()=>{'
         'const pO=pProxyX.parse(pProxy);if(!pO)return "host, porta, usuário e senha — qualquer ordem";'
         'const pSc=pProxyX.schemeOf(pProxy);'
         'return (pO.scheme||"socks5")+" · "+pO.host+":"+pO.port+" · "+(pO.user?"usuário "+pO.user:"sem usuário")'
         '+" · "+(pO.pass?"senha "+String(pO.pass).length+" caracteres":"sem senha")'
         '+((pSc==="socks5"||pSc==="socks5h")?"":" — o aparelho hoje só aplica socks5/socks5h")})()})'
         ']}),')

GEO = ('b.jsxs("div",{children:['
       'b.jsxs("div",{className:"flex items-center justify-between mb-1",children:['
       'b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase",'
       'children:"Coordenadas (vazio = puxa da proxy)"}),'
       'b.jsx("button",{onClick:()=>{if(!SI||!W)return;pSetIdMsg("puxando a geo da proxy...");'
       'SI.invoke("spoofer:geo-from-proxy",{deviceId:W,proxy:pProxyX.norm(pProxy)}).then(pG=>{'
       'if(pG&&pG.success){Gl(String(pG.lat)),cl(String(pG.lon));'
       'const pCc=pG.countryCode||pG.country;pSetLang(pPaisIdioma(pCc));'
       'pSetIdMsg("geo da proxy: "+(pG.city||"?")+" / "+(pG.country||"?")+" (IP "+(pG.ip||"?")+") · idioma "+pPaisIdioma(pCc))}'
       'else{pSetIdMsg("não peguei a geo: "+((pG&&pG.error)||"sem resposta"))}})'
       '.catch(pE=>pSetIdMsg(pLangErro(pE)))},'
       'className:"text-[8px] font-black uppercase tracking-wider px-2 py-1 rounded-md bg-white/[0.04] '
       'border border-white/10 text-white/50 hover:border-purple-400/40 hover:text-purple-300 transition-all",'
       'children:"puxar da proxy"})]}),'
       'b.jsxs("div",{className:"grid grid-cols-2 gap-2",children:['
       'b.jsxs("div",{children:['
       'b.jsx("label",{className:"text-[8px] font-bold text-white/30 uppercase tracking-widest mb-1 block",'
       'children:"Latitude"}),'
       'b.jsx("input",{type:"text",value:j,onChange:pE=>Gl(pE.target.value),placeholder:"—",'
       'className:"w-full bg-white/[0.02] border border-white/10 rounded-lg px-3 py-2 text-white text-xs '
       'font-mono placeholder-white/20 focus:outline-none focus:border-purple-400/50"})]}),'
       'b.jsxs("div",{children:['
       'b.jsx("label",{className:"text-[8px] font-bold text-white/30 uppercase tracking-widest mb-1 block",'
       'children:"Longitude"}),'
       'b.jsx("input",{type:"text",value:II,onChange:pE=>cl(pE.target.value),placeholder:"—",'
       'className:"w-full bg-white/[0.02] border border-white/10 rounded-lg px-3 py-2 text-white text-xs '
       'font-mono placeholder-white/20 focus:outline-none focus:border-purple-400/50"})]})]})'
       ']}),')

SALVAR = ('b.jsx("button",{onClick:()=>{if(!SI||!W)return;(async()=>{'
          'try{'
          'let pGeoTz="",pGeoPais="";'
          'pSetIdMsg("1/5 modelo...");'
          'if(pIphoneModel){const pMT=((pIphoneModels.find(pM=>pM.name===pIphoneModel)||{}).productType)||pIphoneModel;'
          'const pR1=await SI.invoke("spoofer:apply-ios-model",{deviceId:W,productType:pMT});'
          'if(!(pR1&&pR1.success))throw new Error("modelo: "+((pR1&&pR1.error)||"falhou"));}'
          'pSetIdMsg("2/5 proxy...");'
          'if(pProxy&&String(pProxy).trim()){const pR2=await SI.invoke("iphone:proxy:set",{id:W,'
          'proxy:pProxyX.norm(pProxy)});if(!(pR2&&pR2.success))throw new Error("proxy: "+((pR2&&pR2.error)||"falhou"));}'
          'pSetIdMsg("3/5 coordenadas...");'
          'let pLa=String(j||"").trim(),pLo=String(II||"").trim();'
          'if(!pLa||!pLo){const pG=await SI.invoke("spoofer:geo-from-proxy",{deviceId:W,proxy:pProxyX.norm(pProxy)});'
          'if(!(pG&&pG.success))throw new Error("geo da proxy: "+((pG&&pG.error)||"sem resposta"));'
          'pLa=String(pG.lat);pLo=String(pG.lon);pGeoTz=pG.timezone||"";pGeoPais=pG.countryCode||pG.country||"";'
          'Gl(pLa);cl(pLo);pSetLang(pPaisIdioma(pGeoPais));}'
          'const pR3=await SI.invoke("spoofer:set-location",{deviceId:W,'
          'latitude:parseFloat(pLa),longitude:parseFloat(pLo)});'
          'if(!(pR3&&pR3.success))throw new Error("GPS: "+((pR3&&pR3.error)||"falhou"));'
          'if(pGeoTz){pSetIdMsg("4/5 fuso "+pGeoTz+"...");'
          'await SI.invoke("spoofer:apply-locale",{deviceId:W,timezone:pGeoTz}).catch(()=>{});}'
          'pSetIdMsg("5/5 idioma "+pLang+"...");'
          'const pLg=await SI.invoke("spoofer:get-language",{deviceId:W}).catch(()=>null);'
          'if(pLg&&pLg.success&&pLg.language){'
          'if(pLg.language!==pLang){const pLc=((pIdiomas.find(pX=>pX[0]===pLang)||[])[2])||String(pLang).replace("-","_");'
          'const pR5=await SI.invoke("spoofer:apply-language",{deviceId:W,language:pLang,locale:pLc,'
          'confirmGlobal:!0,respring:!1}).catch(pE=>({success:!1,error:String(pE&&pE.message||pE)}));'
          'if(!(pR5&&pR5.success))throw new Error("idioma: "+((pR5&&pR5.error)||"falhou"));}}'
          'else{pSetIdMsg("tudo salvo · o idioma não foi aplicado: "+((pLg&&(pLg.error||pLg.motivo))'
          '||"o app não respondeu ao pedido de idioma — feche e reabra o Nova"));return;}'
          'pSetIdMsg("tudo salvo no iPhone ✓ · CAM LIVE segue no ar (a interface do iPhone só muda com respring)");'
          '}catch(pE){pSetIdMsg("parei: "+pLangErro(pE))}})()},'
          'className:"flex-1 py-3 bg-gradient-to-r from-purple-600 to-purple-500 text-white rounded-xl font-black '
          'text-[11px] uppercase tracking-widest hover:from-purple-500 hover:to-purple-400 active:scale-[0.98] '
          'transition-all shadow-[0_0_20px_rgba(168,85,247,0.4)]",children:"Salvar"})')

REGISTRAR = ('b.jsx("button",{onClick:()=>{if(!W)return;'
             'pSetIdNome((pIphoneModel||"perfil")+" · "+(pProxyX.schemeOf(pProxy)||"socks5")+" · "+pLang);'
             'pSetIdPrompt(!0);pSetIdMsg("")},'
             'className:"flex-1 py-3 bg-white/[0.04] border border-purple-500/30 text-purple-200 rounded-xl '
             'font-black text-[11px] uppercase tracking-widest hover:border-purple-400/60 transition-all",'
             'children:"Registrar modelo"})')

RESTAURAR = ('b.jsx("button",{onClick:()=>{if(!SI||!W)return;(async()=>{'
             'pSetIdMsg("desfazendo tudo no iPhone...");'
             'await SI.invoke("spoofer:stop-gps",{deviceId:W}).catch(()=>{});'
             'await SI.invoke("spoofer:revert-locale",{deviceId:W}).catch(()=>{});'
             'await SI.invoke("iphone:proxy:clear",{id:W}).catch(()=>{});'
             'await SI.invoke("spoofer:clear-ios-model",{deviceId:W}).catch(()=>{});'
             'await SI.invoke("spoofer:revert-language",{deviceId:W,confirmGlobal:!0}).catch(()=>{});'
             'pSetProxy("");Gl("");cl("");'
             'pSetIdMsg("celular restaurado: modelo, proxy, GPS, fuso e idioma no original · CAM LIVE segue no ar")'
             '})()},'
             'className:"flex-1 py-3 bg-white/[0.03] border border-red-500/25 text-red-400/80 rounded-xl '
             'font-black text-[11px] uppercase tracking-widest hover:border-red-400/50 hover:text-red-300 '
             'transition-all",children:"Restaurar celular"})')

POPUP = ('pIdPrompt&&b.jsxs("div",{className:"p-3 rounded-xl bg-purple-500/10 border border-purple-500/40 '
         'flex flex-col gap-2",children:['
         'b.jsx("label",{className:"text-[9px] font-bold text-purple-200 uppercase tracking-widest",'
         'children:"Nome do modelo"}),'
         'b.jsx("input",{type:"text",autoFocus:!0,value:pIdNome,onChange:pE=>pSetIdNome(pE.target.value),'
         'placeholder:"ex.: iPhone 15 · Texas · inglês",'
         'className:"w-full bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-white text-xs '
         'font-bold placeholder-white/25 focus:outline-none focus:border-purple-400/60"}),'
         'b.jsxs("div",{className:"flex gap-2",children:['
         'b.jsx("button",{onClick:()=>{const pNm=String(pIdNome||"").trim();if(!pNm)return;'
         'const pK="nova_identidade_"+W;let pL=[];try{pL=JSON.parse(localStorage.getItem(pK)||"[]")}catch{pL=[]}'
         'pL.unshift({nome:pNm,modelo:pIphoneModel,proxy:pProxy,idioma:pLang,lat:j,lon:II,'
         'em:new Date().toISOString()});'
         'try{localStorage.setItem(pK,JSON.stringify(pL.slice(0,12)))}catch{}'
         'pSetIdPrompt(!1);'
         'pSetIdMsg("registrado: \\""+pNm+"\\" · modelo "+(pIphoneModel||"?")+" + proxy "'
         '+(pProxyX.schemeOf(pProxy)||"socks5")+" + idioma "+pLang+" + coordenadas"'
         '+(String(j||"").trim()&&String(II||"").trim()?" "+j+", "+II:" (da proxy)")'
         '+". Nada foi enviado ao iPhone — clique em Salvar para aplicar.")},'
         'className:"flex-1 py-2 rounded-lg bg-purple-500/30 border border-purple-400/50 text-white '
         'text-[10px] font-black uppercase tracking-wider",children:"Salvar modelo"}),'
         'b.jsx("button",{onClick:()=>{pSetIdPrompt(!1),pSetIdMsg("registro cancelado")},'
         'className:"px-3 py-2 rounded-lg bg-white/[0.04] border border-white/15 text-white/60 text-[10px] '
         'font-black uppercase tracking-wider",children:"Cancelar"})]})]}),')

LISTA = ('b.jsx("div",{className:"flex flex-wrap gap-1",children:(()=>{'
         'let pL=[];try{pL=JSON.parse(localStorage.getItem("nova_identidade_"+W)||"[]")}catch{pL=[]}'
         'return pL.length?pL.map((pS,pI)=>b.jsx("button",{'
         'onClick:()=>{pSetIphoneModel(pS.modelo||pIphoneModel);pSetProxy(pS.proxy||"");'
         'pSetLang(pS.idioma||pLang);Gl(pS.lat||"");cl(pS.lon||"");'
         'pSetIdMsg("carregado: "+(pS.nome||"?")+" — clique Salvar para aplicar")},'
         'className:"px-2 py-1 bg-white/[0.03] border border-white/10 rounded-md text-[8px] font-bold '
         'text-white/50 uppercase tracking-wider hover:border-purple-400/40 hover:text-purple-300 transition-all",'
         'children:(pS.nome||"perfil")+(pS.idioma?" · "+pS.idioma:"")},pI)):'
         'b.jsx("span",{className:"text-[8px] text-white/25 uppercase tracking-wider",'
         'children:"nenhum modelo registrado ainda"})})()}),')

PAINEL = (
 'b.jsxs("div",{className:"space-y-3 mb-4",children:['
 'b.jsxs("div",{className:"border-b border-white/5 pb-2",children:['
 'b.jsxs("span",{className:"text-[10px] font-black text-white/40 uppercase tracking-widest flex items-center gap-2",'
 'children:[b.jsx(li,{size:10,className:"text-purple-400"})," Perfil do dispositivo"]})]}),'
 'b.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[' + MODELO + IDIOMA + ']}),'
 + PROXY + GEO +
 'b.jsxs("div",{className:"flex gap-2",children:[' + SALVAR + ',' + REGISTRAR + ',' + RESTAURAR + ']}),'
 + POPUP + LISTA +
 'pIdMsg&&b.jsx("p",{className:"text-[9px] font-mono text-white/60",children:pIdMsg}),'
 'pLangConfirm&&b.jsxs("div",{className:"p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 '
 'flex flex-col gap-2",children:['
 'b.jsxs("p",{className:"text-[9.5px] font-bold text-amber-200 leading-relaxed",children:['
 '"Confirma aplicar o idioma ",b.jsx("b",{children:pLang})," no aparelho inteiro? A interface do iPhone '
 'só muda com respring, e o respring derruba o CAM LIVE."]}),'
 'b.jsxs("div",{className:"flex gap-2",children:['
 'b.jsx("button",{onClick:()=>{const pLc=((pIdiomas.find(pX=>pX[0]===pLang)||[])[2])||String(pLang).replace("-","_");'
 'SI&&SI.invoke("spoofer:apply-language",{deviceId:W,language:pLang,locale:pLc,confirmGlobal:!0,respring:!1})'
 '.then(pR=>{pSetLangConfirm(!1);pSetIdMsg(pR&&pR.success?"idioma aplicado: "+pLang+" (sem respring)"'
 ':"não aplicou: "+((pR&&pR.error)||""))}).catch(pE=>{pSetLangConfirm(!1);pSetIdMsg(pLangErro(pE))})},'
 'className:"flex-1 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-100 text-[10px] '
 'font-black uppercase tracking-wider",children:"Aplicar sem respring"}),'
 'b.jsx("button",{onClick:()=>{pSetLangConfirm(!1),pSetIdMsg("idioma: cancelado")},'
 'className:"px-3 py-2 rounded-lg bg-white/[0.04] border border-white/15 text-white/60 text-[10px] '
 'font-black uppercase tracking-wider",children:"Cancelar"})]})]}),'
 ']}),'
)

INICIO_PAINEL = 'b.jsxs("div",{className:"space-y-3 mb-4",children:['
GRID = 'b.jsxs("div",{className:"grid grid-cols-2 gap-5",children:['
GRID_OCULTO = 'b.jsxs("div",{className:"grid grid-cols-2 gap-5",children:[b.jsxs("div",{className:"space-y-3",style:{display:"none"},children:['

i = s.find(INICIO_PAINEL)
if i >= 0:
    fim = s.find(GRID_OCULTO, i)
    if fim < 0:
        print("ID2 ERRO: painel existe mas nao achei o fim")
        sys.exit(2)
    if s[i:fim] == PAINEL:
        print("ID2 ja aplicado")
    else:
        s = s[:i] + PAINEL + s[fim:]
        print("ID2 ok (painel v2 no lugar do anterior)")
else:
    if s.count(GRID) != 1:
        print("ID2 ERRO: ancora do grid x%d (esperado 1)" % s.count(GRID))
        sys.exit(2)
    s = s.replace(GRID, PAINEL + GRID_OCULTO)
    print("ID2 ok (painel novo + coluna antiga oculta)")

ANC_LAT = ('b.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[b.jsxs("div",{children:['
           'b.jsx("label",{className:"text-[8px] font-bold text-white/30 uppercase tracking-widest mb-1 block",'
           'children:"Latitude"})')
NOVO_LAT = ANC_LAT.replace('className:"grid grid-cols-2 gap-2"',
                           'className:"grid grid-cols-2 gap-2",style:{display:"none"}')
if NOVO_LAT in s:
    print("ID3 ja aplicado")
else:
    c = s.count(ANC_LAT)
    if c != 1:
        print("ID3 ERRO: ancora das coordenadas antigas x%d (esperado 1)" % c)
        sys.exit(2)
    s = s.replace(ANC_LAT, NOVO_LAT)
    print("ID3 ok")

if s == o:
    print("nada a fazer")
    sys.exit(0)
if aplicar:
    shutil.copy2(alvo, alvo + ".bak-identidade")
    open(alvo, "w", encoding="utf8").write(s)
    print("gravado (backup %s.bak-identidade)" % os.path.basename(alvo))
else:
    print("simulacao: nada gravado")
