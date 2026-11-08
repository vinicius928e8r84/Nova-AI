#!/usr/bin/env python3
"""Aba da proxy do Nova (iPhone): aceita host:porta@usuario:senha e some com "idioma undefined".

Idempotente. Uso: aplicar-proxy-formato.py ALVO.js [--aplicar]
Sem --aplicar so simula (nao grava). Com --aplicar grava e deixa ALVO.js.bak-proxy-formato.
Hunks: A) pNormProxy; B) pSaveProxy normaliza; C) pSaveIos normaliza;
       D) pGeoOnOpen normaliza; E) texto "idioma" so quando o aparelho devolve idioma.
Regra: o formato padrao (usuario:senha@host:porta) tem prioridade; so troca quando ele nao vale.
"""
import sys, shutil
alvo = sys.argv[1]; aplicar = "--aplicar" in sys.argv
s = open(alvo, encoding="utf8").read(); o = s

NORM = ('pNormProxy=pV=>{let pV2=(pV||"").trim(),pSch="";["http://","https://","socks5://","socks5h://","socks4://"].forEach(pS=>{!pSch&&pV2.startsWith(pS)&&(pSch=pS,pV2=pV2.slice(pS.length))});'
        'const pAt=pV2.lastIndexOf("@");if(pAt<0)return (pV||"").trim();'
        'const pOk=pT=>{const pA=pT.split(":");return pA.length===2&&pA[0].length>2&&/^[0-9]{2,5}$/.test(pA[1])};'
        'const pL=pV2.slice(0,pAt),pR=pV2.slice(pAt+1);if(pOk(pR)||!pOk(pL)||pL.indexOf(".")<0)return (pV||"").trim();'
        'const pC=pR.indexOf(":");if(pC<1||pC===pR.length-1)return (pV||"").trim();'
        'return (pSch||"socks5://")+pL+":"+pR.slice(0,pC)+":"+pR.slice(pC+1)},')
hunks = [
 ("A", "pValidProxy=pV=>{", NORM + "pValidProxy=pV=>{", 1),
 ("B", "pSaveProxy=async()=>{const pV=pProxy.trim();", "pSaveProxy=async()=>{const pV=pNormProxy(pProxy);pV!==pProxy.trim()&&pSetProxy(pV);", 1),
 ("C", "pSaveIos=async()=>{if(!W)return;const pV=pProxy.trim();", "pSaveIos=async()=>{if(!W)return;const pV=pNormProxy(pProxy);pV!==pProxy.trim()&&pSetProxy(pV);", 1),
 ("D", '||(pProxy||"").trim();pP&&pGeoApply(pP)}', '||pNormProxy(pProxy);pP&&pGeoApply(pP)}', 1),
 ("E", "` · idioma ${pL.language} · fuso ${pL.timezone||pG.timezone||\"—\"}`", "`${pL.language?` · idioma ${pL.language}`:\"\"} · fuso ${pL.timezone||pG.timezone||\"—\"}`", 1),
]
for nome, velho, novo, n in hunks:
    if novo in s: print(nome, "ja aplicado"); continue
    c = s.count(velho)
    if c != n: print(nome, "ERRO: ancora x%d (esperado %d)" % (c, n)); sys.exit(2)
    s = s.replace(velho, novo); print(nome, "ok")
if s == o: print("nada a fazer"); sys.exit(0)
if aplicar:
    shutil.copy2(alvo, alvo + ".bak-proxy-formato"); open(alvo, "w", encoding="utf8").write(s); print("gravado")
else: print("simulacao: nada gravado")
