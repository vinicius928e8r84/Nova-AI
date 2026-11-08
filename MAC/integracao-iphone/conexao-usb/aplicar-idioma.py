#!/usr/bin/env python3
"""Seletor de idioma do iPhone na tela "Identidade simulada" do Nova.

O que faz no bundle do app:
  T8a) ramo do pProxyX ganha o tradutor de erro (mensagem clara quando o IPC não existe);
  T8b) dois estados novos: idioma escolhido e mensagem;
  T8c) bloco na tela: seletor de idioma + Ler do aparelho + Aplicar.

Depende de dois IPCs que AINDA NÃO EXISTEM no app (Backend/iOS):
  spoofer:get-language  { deviceId }                        -> { success, language, locale }
  spoofer:set-language  { deviceId, language, locale }      -> { success, language, respring }
Sem eles a tela não quebra: mostra "recurso ainda não ligado no app".

Idempotente. Uso: aplicar-idioma.py ALVO.js [--aplicar]
Sem --aplicar só simula. Com --aplicar grava e deixa ALVO.js.bak-idioma.
"""
import sys, os, shutil

alvo = sys.argv[1] if len(sys.argv) > 1 else ""
aplicar = "--aplicar" in sys.argv
if not alvo:
    print("uso: aplicar-idioma.py ALVO.js [--aplicar]")
    sys.exit(2)

s = open(alvo, encoding="utf8").read()
o = s

ERRO = ('pLangErro=pE=>{const pM=String(pE&&pE.message||pE);'
        'return /No handler registered|not registered/i.test(pM)'
        '?"recurso ainda não ligado no app (falta o IPC de idioma)":pM}')
ANC_ERRO = ",pValidProxy=pV=>!!pProxyX.parse(pV)"
if ERRO in s:
    print("T8a ja aplicado")
else:
    c = s.count(ANC_ERRO)
    if c != 1:
        print("T8a ERRO: ancora x%d (esperado 1) — rode antes o aplicar-proxy-tipo.py" % c)
        sys.exit(2)
    s = s.replace(ANC_ERRO, ANC_ERRO + "," + ERRO)
    print("T8a ok")

ANC_HOOK = '[pProxyMsg,pSetProxyMsg]=F.useState("")'
NOVOS = ',[pLang,pSetLang]=F.useState("pt-BR"),[pLangMsg,pSetLangMsg]=F.useState("")'
if "[pLang,pSetLang]=F.useState" in s:
    print("T8b ja aplicado")
else:
    c = s.count(ANC_HOOK)
    if c != 1:
        print("T8b ERRO: ancora do useState x%d (esperado 1)" % c)
        sys.exit(2)
    s = s.replace(ANC_HOOK, ANC_HOOK + NOVOS)
    print("T8b ok")

IDIOMAS = ('[["pt-BR","Português (Brasil)"],["en-US","Inglês (EUA)"],["en-GB","Inglês (Reino Unido)"],'
           '["es-ES","Espanhol (Espanha)"],["es-MX","Espanhol (México)"],["fr-FR","Francês"],'
           '["de-DE","Alemão"],["it-IT","Italiano"],["nl-NL","Holandês"],["ja-JP","Japonês"],'
           '["ko-KR","Coreano"],["zh-CN","Chinês (simplificado)"],["ru-RU","Russo"],["tr-TR","Turco"],'
           '["ar-SA","Árabe"],["hi-IN","Hindi"]]')

LE = ('pE=>pSetLangMsg(pLangErro(pE))')
BLOCO = (
 'b.jsxs("div",{children:['
 'b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",'
 'children:"Idioma do iPhone"}),'
 'b.jsxs("div",{className:"flex gap-2",children:['
 'b.jsx("select",{value:pLang,onChange:pE=>pSetLang(pE.target.value),title:"Idioma do iPhone",'
 'className:"flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs '
 'font-bold focus:outline-none focus:border-purple-400/50",children:' + IDIOMAS +
 '.map(pX=>b.jsx("option",{value:pX[0],className:"bg-[#0A121E] text-white",'
 'children:pX[1]+" — "+pX[0]},pX[0]))}),'
 'b.jsx("button",{onClick:()=>{if(!SI||!W)return;pSetLangMsg("lendo...");'
 'SI.invoke("spoofer:get-language",{deviceId:W}).then(pR=>{'
 'pR&&pR.success&&pR.language?(pSetLang(pR.language),pSetLangMsg("aparelho está em "+pR.language'
 '+(pR.locale?" / "+pR.locale:""))):pSetLangMsg("não consegui ler: "+((pR&&pR.error)||"sem resposta"))'
 '}).catch(' + LE + ')},'
 'className:"px-3 py-2.5 rounded-xl bg-white/[0.04] border border-purple-500/40 text-purple-200 '
 'text-[10px] font-black uppercase tracking-wider hover:bg-purple-500/20 transition-all",children:"Ler"}),'
 'b.jsx("button",{onClick:()=>{if(!SI||!W||!pLang)return;pSetLangMsg("aplicando...");'
 'SI.invoke("spoofer:set-language",{deviceId:W,language:pLang,locale:String(pLang).replace("-","_")})'
 '.then(pR=>{pR&&pR.success?pSetLangMsg("aplicado: "+(pR.language||pLang)'
 '+(pR.respring?" (a tela do iPhone reiniciou)":""))'
 ':pSetLangMsg("não aplicou: "+((pR&&pR.error)||"sem resposta"))}).catch(' + LE + ')},'
 'className:"px-3 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/40 text-purple-200 '
 'text-[10px] font-black uppercase tracking-wider hover:bg-purple-500/20 transition-all",children:"Aplicar"})'
 ']}),'
 'pLangMsg&&b.jsx("p",{className:"text-[9px] mt-1 font-mono text-white/50",children:pLangMsg})'
 ']}),'
)
ANC_JSX = 'children:pProxyMsg})]}),b.jsxs("button",{onClick:pIsIos?pSaveIos:el,'
NOVO_JSX = 'children:pProxyMsg})]}),' + BLOCO + 'b.jsxs("button",{onClick:pIsIos?pSaveIos:el,'
if 'children:"Idioma do iPhone"' in s:
    print("T8c ja aplicado")
else:
    c = s.count(ANC_JSX)
    if c != 1:
        print("T8c ERRO: ancora do bloco da proxy x%d (esperado 1) — rode antes o aplicar-proxy-tipo.py" % c)
        sys.exit(2)
    s = s.replace(ANC_JSX, NOVO_JSX)
    print("T8c ok")

if s == o:
    print("nada a fazer")
    sys.exit(0)
if aplicar:
    shutil.copy2(alvo, alvo + ".bak-idioma")
    open(alvo, "w", encoding="utf8").write(s)
    print("gravado (backup %s.bak-idioma)" % os.path.basename(alvo))
else:
    print("simulacao: nada gravado")
