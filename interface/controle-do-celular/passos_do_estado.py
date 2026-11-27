from passos_de_patch import Substituicao, Transformacao

INICIO_DAS_ABAS = 'b.jsxs("div",{className:"flex border-b border-white/5 bg-black/20 flex-shrink-0",style:'
CORPO_DA_JANELA = 'b.jsxs("div",{className:"flex-1 overflow-auto p-6 bg-black/10",children:['
USOS_DE_E_LENGTH_NAS_ABAS = 11

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

EFEITOS = (
    ';F.useEffect(()=>{if(!pUserPicked&&e.length>0){const pAuto=e[0].ios||String(e[0].id).startsWith("ios-")?"ios":"android";'
    'pAuto!==pPlat&&pSetPlat(pAuto)}},[e]);'
    'F.useEffect(()=>{const pList=pDevices;'
    'pList.length>0&&!pList.some(pD=>pD.id===W)&&N(pList[0].id);'
    'pList.length===0&&c!=="devices"&&d("devices")},[pPlat,e]);'
    'F.useEffect(()=>{if(pIsIos&&W){pSetIphoneModel(localStorage.getItem("nova_iphone_model_"+W)||"iPhone 15"),pSetProxy(localStorage.getItem("nova_iphone_proxy_"+W)||""),pSetProxyMsg("");SI&&SI.invoke("iphone:proxy:status",{id:W}).then(pR=>{pR&&pR.success&&pR.on&&(pSetProxyMsg("Ativo no iPhone: "+(pR.upstream||"proxy")),pSetProxyStatus("ok"))}).catch(()=>{})}},[W,pIsIos]);'
    'return Fl?b.jsx("div",{className:"fixed inset-0 z-[9990]'
)


def regiao_das_abas(texto):
    inicio = texto.find(INICIO_DAS_ABAS)
    fim = texto.find(CORPO_DA_JANELA, inicio)
    if min(inicio, fim) < 0 or fim <= inicio:
        raise SystemExit('não achei a região das abas')
    return inicio, fim


def filtrar_abas(texto):
    inicio, fim = regiao_das_abas(texto)
    regiao = texto[inicio:fim]
    usos = regiao.count('e.length')
    if usos != USOS_DE_E_LENGTH_NAS_ABAS:
        raise SystemExit(f'abas: esperava {USOS_DE_E_LENGTH_NAS_ABAS} e.length, achei {usos}')
    return texto[:inicio] + regiao.replace('e.length', 'pDevices.length') + texto[fim:]


PASSOS_DO_ESTADO = [
    Substituicao(
        ',[dl,Jl]=F.useState({width:900,height:620,x:120,y:60}),SI=window.electronAPI',
        ',[dl,Jl]=F.useState({width:900,height:620,x:120,y:60}),[pPlat,pSetPlat]=F.useState("android"),'
        '[pUserPicked,pSetPicked]=F.useState(!1),'
        '[pIphoneModel,pSetIphoneModel]=F.useState("iPhone 15"),[pProxy,pSetProxy]=F.useState(""),'
        '[pProxyMsg,pSetProxyMsg]=F.useState(""),[pProxyStatus,pSetProxyStatus]=F.useState("ok"),SI=window.electronAPI',
        'estados pPlat/pUserPicked',
    ),
    Transformacao('abas filtradas (11 usos de e.length)', filtrar_abas),
    Substituicao('},[c]);const gG=e.find(eI=>eI.id===W)', DEFS, 'lista filtrada + ícones'),
    Substituicao(';return Fl?b.jsx("div",{className:"fixed inset-0 z-[9990]', EFEITOS, 'efeitos de plataforma/seleção'),
]
