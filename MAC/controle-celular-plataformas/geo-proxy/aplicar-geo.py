#!/usr/bin/env python3
"""Aplica no renderer do Nova: localização automática vinda da proxy.

O que muda no painel "Identidade simulada":
  - ao salvar a proxy (botão SALVAR e botão "Salvar identidade do iPhone"),
    a localização é buscada da proxy e o GPS é aplicado no aparelho;
  - ao abrir a aba com uma proxy salva, a localização é reaplicada;
  - o botão "Fixar GPS Falso" some (vira texto de status); "Parar" continua.

Uso:
  python3 aplicar-geo.py <bundle-original.js> <bundle-saida.js>
"""
import pathlib
import re
import subprocess
import sys
import tempfile

if len(sys.argv) != 3:
    print('uso: aplicar-geo.py <origem.js> <saida.js>')
    sys.exit(2)

origem = pathlib.Path(sys.argv[1])
saida = pathlib.Path(sys.argv[2])
s = origem.read_text(encoding='utf-8')
passos = []


def rep(velho, novo, rotulo, esperado=1):
    global s
    n = s.count(velho)
    if n != esperado:
        raise SystemExit(f'[{rotulo}] esperava {esperado} ocorrência(s), achei {n}: {velho[:90]!r}')
    s = s.replace(velho, novo)
    passos.append(rotulo)


def check(rotulo):
    with tempfile.TemporaryDirectory() as tmp:
        prova = pathlib.Path(tmp) / 'bundle.mjs'
        prova.write_text(s, encoding='utf-8')
        r = subprocess.run(['node', '--check', str(prova)], capture_output=True, text=True)
        if r.returncode != 0:
            msg = r.stderr.split('SyntaxError')[-1][:300]
            raise SystemExit(f'quebrou em [{rotulo}]: SyntaxError{msg}')


def match_close(texto, i):
    """Índice do delimitador que fecha o que abre em texto[i] (string-aware)."""
    pares = {'(': ')', '[': ']', '{': '}'}
    abre = texto[i]
    fecha = pares[abre]
    prof = 0
    instr = None
    esc = False
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
            elif ch in '([{':
                prof += 1
            elif ch in ')]}':
                prof -= 1
                if prof == 0:
                    return i
        i += 1
    raise SystemExit('delimitador não fechou')


def achar_antes(texto, marcador, abertura, rotulo):
    pos = texto.find(marcador)
    if pos < 0:
        raise SystemExit(f'[{rotulo}] marcador não encontrado: {marcador[:60]!r}')
    i = texto.rfind(abertura, 0, pos)
    if i < 0:
        raise SystemExit(f'[{rotulo}] não achei {abertura!r} antes do marcador')
    return i


# 1) helper de geo + efeito que reaplica ao abrir a aba ---------------------------------
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
rep('pSaveProxy=async()=>{const pV=pProxy.trim();', HELPER + 'pSaveProxy=async()=>{const pV=pProxy.trim();', 'helper pGeoApply')

rep(
    'F.useEffect(()=>{c==="spoofer"&&Object.keys(lI).length===0&&Vl()},[c]);',
    'F.useEffect(()=>{c==="spoofer"&&Object.keys(lI).length===0&&Vl()},[c]);'
    'F.useEffect(()=>{c==="spoofer"&&pGeoOnOpen()},[c,W]);',
    'useEffect geo ao abrir',
)

# 2) salvar proxy -> aplica geo + GPS ---------------------------------------------------
rep(
    'pSetProxyMsg("Proxy aplicado no iPhone."),pSetProxyStatus("ok")}',
    'pSetProxyMsg("Proxy aplicado no iPhone."),pSetProxyStatus("ok"),await pGeoApply(pV)}',
    'geo ao salvar proxy',
)

# 3) salvar identidade do iPhone -> aplica geo + GPS ------------------------------------
velho_fim = 'ainda depende do hook do jailbreak.")}'
if s.count(velho_fim) != 1:
    raise SystemExit(f'[geo ao salvar identidade] esperava 1, achei {s.count(velho_fim)}')
s = s.replace(velho_fim, 'ainda depende do hook do jailbreak."),await pGeoApply(pV)}')
passos.append('geo ao salvar identidade')

# 3b) "Parar" também restaura idioma e fuso
rep(
    'Ul=async()=>{if(!(!W||!SI))try{await SI.invoke("spoofer:stop-gps",{deviceId:W}),M("idle"),kI("Loop de GPS falso parado. Localização real restaurada."),VI("idle")}catch(eI){kI(`Error: ${eI.message}`)}}',
    'Ul=async()=>{if(!(!W||!SI))try{await SI.invoke("spoofer:stop-gps",{deviceId:W}).catch(()=>{}),'
    'await SI.invoke("spoofer:revert-locale",{deviceId:W}).catch(()=>{}),M("idle"),'
    'kI("GPS, fuso e idioma restaurados."),VI("idle")}catch(eI){kI(`Error: ${eI.message}`)}}',
    'parar restaura idioma/fuso',
)

# 4) remove o botão "Fixar GPS Falso" --------------------------------------------------
marca = '"Fixar GPS Falso"'
pos = s.find(marca)
if pos < 0:
    raise SystemExit('[botões GPS] não achei "Fixar GPS Falso"')
ini = achar_antes(s, marca, 'b.jsxs("div",{className:"grid grid-cols-2 gap-2"', 'botões GPS')
fim = match_close(s, s.index('(', ini))        # fecha o parêntese de b.jsxs(...)
NOVOS_BOTOES = (
    'b.jsxs("div",{className:"flex items-center justify-between gap-2",children:['
    'b.jsx("span",{className:`text-[9px] font-bold uppercase tracking-wider ${yl==="set"?"text-emerald-400":"text-white/35"}`,'
    'children:yl==="set"?"GPS aplicado pela proxy":"O GPS é aplicado sozinho ao salvar a proxy"}),'
    'yl==="set"&&b.jsxs("button",{onClick:Ul,className:"py-1.5 px-3 rounded-lg font-black text-[9px] uppercase tracking-widest '
    'flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all",'
    'children:[b.jsx(GG,{size:9})," Parar"]})]})'
)
s = s[:ini] + NOVOS_BOTOES + s[fim + 1:]
passos.append('remove botão Fixar GPS')

check('final')
saida.write_text(s, encoding='utf-8')
print(f'ok: {len(passos)} passos, {len(s)} bytes (origem {len(origem.read_text(encoding="utf-8"))})')
for p in passos:
    print('  -', p)
