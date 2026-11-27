from delimitadores import fim_do_delimitador
from passos_de_patch import Substituicao, SubstituicaoDeMensagemCurta, Transformacao

MARCA_DOS_BOTOES = '"Fixar GPS Falso"'
ABERTURA_DOS_BOTOES = 'b.jsxs("div",{className:"grid grid-cols-2 gap-2"'

HELPER = (
    'pGeoApply=async pPx=>{if(!W||!SI)return;const pG=await SI.invoke("spoofer:geo-from-proxy",{deviceId:W,'
    'proxy:(pPx||"").trim()}).catch(pE=>({success:!1,error:String(pE&&pE.message||pE)}));'
    'if(!(pG&&pG.success)){kI("Não consegui pegar a localização da proxy: "+((pG&&pG.error)||"erro")),VI("error");return}'
    'Gl(String(pG.lat)),cl(String(pG.lon));'
    'const pA=await SI.invoke("spoofer:set-location",{deviceId:W,latitude:pG.lat,longitude:pG.lon})'
    '.catch(pE=>({success:!1,error:String(pE&&pE.message||pE)}));'
    'const pL=await SI.invoke("spoofer:apply-locale",{deviceId:W,timezone:pG.timezone,countryCode:pG.countryCode})'
    '.catch(pE=>({success:!1,error:String(pE&&pE.message||pE)}));'
    'const pLT=pL&&pL.success?` · idioma ${pL.language} · fuso ${pL.timezone||pG.timezone||"—"}`'
    ':(pL&&pL.error==="helper-not-installed"?" · idioma: helper não instalado":(pL&&pL.error?` · idioma: ${pL.error}`:""));'
    'pA&&pA.success?(M("set"),kI(`✓ GPS em ${pG.city} / ${pG.country} (IP ${pG.ip})`+pLT),VI("success"))'
    ':(M("error"),kI(`Proxy em ${pG.city} / ${pG.country}, mas o GPS não aplicou: ${(pA&&pA.error)||"erro"}`),VI("error"))},'
    'pGeoOnOpen=()=>{if(!W||!SI||!String(W).startsWith("ios-"))return;const pP=localStorage.getItem("nova_iphone_proxy_"+W)||(pProxy||"").trim();'
    'pP&&pGeoApply(pP)},'
)

NOVOS_BOTOES = (
    'b.jsxs("div",{className:"flex items-center justify-between gap-2",children:['
    'b.jsx("span",{className:`text-[9px] font-bold uppercase tracking-wider ${yl==="set"?"text-emerald-400":"text-white/35"}`,'
    'children:yl==="set"?"GPS aplicado pela proxy":"O GPS é aplicado sozinho ao salvar a proxy"}),'
    'yl==="set"&&b.jsxs("button",{onClick:Ul,className:"py-1.5 px-3 rounded-lg font-black text-[9px] uppercase tracking-widest '
    'flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all",'
    'children:[b.jsx(GG,{size:9})," Parar"]})]})'
)


def achar_abertura_antes_da_marca(texto):
    inicio = texto.rfind(ABERTURA_DOS_BOTOES, 0, texto.find(MARCA_DOS_BOTOES))
    if inicio < 0:
        raise SystemExit(f'[botões GPS] não achei {ABERTURA_DOS_BOTOES!r} antes do marcador')
    return inicio


def trocar_botoes_de_gps(texto):
    if texto.find(MARCA_DOS_BOTOES) < 0:
        raise SystemExit('[botões GPS] não achei "Fixar GPS Falso"')
    inicio = achar_abertura_antes_da_marca(texto)
    fim = fim_do_delimitador(texto, texto.index('(', inicio))
    return texto[:inicio] + NOVOS_BOTOES + texto[fim + 1:]


PASSOS = [
    Substituicao(
        'pSaveProxy=async()=>{const pV=pProxy.trim();',
        HELPER + 'pSaveProxy=async()=>{const pV=pProxy.trim();',
        'helper pGeoApply',
    ),
    Substituicao(
        'F.useEffect(()=>{c==="spoofer"&&Object.keys(lI).length===0&&Vl()},[c]);',
        'F.useEffect(()=>{c==="spoofer"&&Object.keys(lI).length===0&&Vl()},[c]);'
        'F.useEffect(()=>{c==="spoofer"&&pGeoOnOpen()},[c,W]);',
        'useEffect geo ao abrir',
    ),
    Substituicao(
        'pSetProxyMsg("Proxy aplicado no iPhone."),pSetProxyStatus("ok")}',
        'pSetProxyMsg("Proxy aplicado no iPhone."),pSetProxyStatus("ok"),await pGeoApply(pV)}',
        'geo ao salvar proxy',
    ),
    SubstituicaoDeMensagemCurta(
        'ainda depende do hook do jailbreak.")}',
        'ainda depende do hook do jailbreak."),await pGeoApply(pV)}',
        'geo ao salvar identidade',
    ),
    Substituicao(
        'Ul=async()=>{if(!(!W||!SI))try{await SI.invoke("spoofer:stop-gps",{deviceId:W}),M("idle"),kI("Loop de GPS falso parado. Localização real restaurada."),VI("idle")}catch(eI){kI(`Error: ${eI.message}`)}}',
        'Ul=async()=>{if(!(!W||!SI))try{await SI.invoke("spoofer:stop-gps",{deviceId:W}).catch(()=>{}),'
        'await SI.invoke("spoofer:revert-locale",{deviceId:W}).catch(()=>{}),M("idle"),'
        'kI("GPS, fuso e idioma restaurados."),VI("idle")}catch(eI){kI(`Error: ${eI.message}`)}}',
        'parar restaura idioma/fuso',
    ),
    Transformacao('remove botão Fixar GPS', trocar_botoes_de_gps),
]
