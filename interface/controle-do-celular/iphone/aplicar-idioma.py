#!/usr/bin/env python3
import sys, os, shutil

alvo = sys.argv[1] if len(sys.argv) > 1 else ""
aplicar = "--aplicar" in sys.argv
if not alvo:
    print("uso: aplicar-idioma.py ALVO.js [--aplicar]")
    sys.exit(2)

s = open(alvo, encoding="utf8").read()
o = s

IDIOMAS = ("pIdiomas=["
           '["pt-BR","Português (Brasil)","pt_BR"],'
           '["pt-PT","Português (Portugal)","pt_PT"],'
           '["en-US","Inglês (EUA)","en_US"],'
           '["en-GB","Inglês (Reino Unido)","en_GB"],'
           '["en-AU","Inglês (Austrália)","en_AU"],'
           '["es-ES","Espanhol (Espanha)","es_ES"],'
           '["es-419","Espanhol (América Latina)","es_419"],'
           '["fr-FR","Francês (França)","fr_FR"],'
           '["fr-CA","Francês (Canadá)","fr_CA"],'
           '["de-DE","Alemão","de_DE"],'
           '["it-IT","Italiano","it_IT"],'
           '["nl-NL","Holandês","nl_NL"],'
           '["pl-PL","Polonês","pl_PL"],'
           '["ru-RU","Russo","ru_RU"],'
           '["sv-SE","Sueco","sv_SE"],'
           '["tr-TR","Turco","tr_TR"],'
           '["ar-SA","Árabe","ar_SA"],'
           '["hi-IN","Hindi","hi_IN"],'
           '["ja-JP","Japonês","ja_JP"],'
           '["ko-KR","Coreano","ko_KR"],'
           '["zh-Hans","Chinês (simplificado)","zh_CN"],'
           '["zh-Hant","Chinês (tradicional)","zh_TW"]'
           ']')
ERRO = ('pLangErro=pE=>{const pM=String(pE&&pE.message||pE);'
        'return /No handler registered|not registered/i.test(pM)'
        '?"recurso ainda não ligado no app (falta o IPC de idioma)":pM}')
ANC_ERRO = ",pValidProxy=pV=>!!pProxyX.parse(pV)"
NOVO_TAIL = ANC_ERRO + "," + ERRO + "," + IDIOMAS

if "pIdiomas=[" in s:
    print("T8a ja aplicado")
else:
    c = s.count(ANC_ERRO)
    if c != 1:
        print("T8a ERRO: ancora x%d (esperado 1) — rode antes o aplicar-proxy-tipo.py" % c)
        sys.exit(2)
    antigo = ('pLangErro=pE=>{const pM=String(pE&&pE.message||pE);'
              'return /No handler registered|not registered/i.test(pM)'
              '?"recurso ainda não ligado no app (falta o IPC de idioma)":pM}')
    if ANC_ERRO + "," + antigo in s:
        s = s.replace(ANC_ERRO + "," + antigo, NOVO_TAIL)
        print("T8a ok (versao anterior substituida)")
    else:
        s = s.replace(ANC_ERRO, NOVO_TAIL)
        print("T8a ok")

ANC_HOOK = '[pProxyMsg,pSetProxyMsg]=F.useState("")'
NOVOS = (',[pLang,pSetLang]=F.useState("pt-BR"),'
         '[pLangMsg,pSetLangMsg]=F.useState(""),'
         '[pLangConfirm,pSetLangConfirm]=F.useState(!1)')
if "[pLangConfirm,pSetLangConfirm]=F.useState" in s:
    print("T8b ja aplicado")
else:
    c = s.count(ANC_HOOK)
    if c != 1:
        print("T8b ERRO: ancora do useState x%d (esperado 1)" % c)
        sys.exit(2)
    if "[pLang,pSetLang]=F.useState" in s:
        velho = (',[pLang,pSetLang]=F.useState("pt-BR"),'
                 '[pLangMsg,pSetLangMsg]=F.useState("")')
        s = s.replace(velho, velho + ',[pLangConfirm,pSetLangConfirm]=F.useState(!1)')
        print("T8b ok (versao anterior completada)")
    else:
        s = s.replace(ANC_HOOK, ANC_HOOK + NOVOS)
        print("T8b ok")

BTN_LER = ('b.jsx("button",{onClick:()=>{if(!SI||!W)return;pSetLangMsg("lendo...");'
           'SI.invoke("spoofer:get-language",{deviceId:W}).then(pR=>{'
           'if(pR&&pR.success&&pR.language){pSetLang(pR.language);'
           'pSetLangMsg("aparelho está em "+pR.language+(pR.locale?" / "+pR.locale:"")'
           '+(pR.override&&pR.override!=="global"?" (exceção em "+pR.override+")":"")'
           '+(pR.diskMatches===!1?" · atenção: o disco está atrás do aparelho":""))}'
           'else{pSetLangMsg("não consegui ler: "+((pR&&pR.error)||"sem resposta"))}})'
           '.catch(pE=>pSetLangMsg(pLangErro(pE)))},'
           'className:"px-3 py-2.5 rounded-xl bg-white/[0.04] border border-purple-500/40 '
           'text-purple-200 text-[10px] font-black uppercase tracking-wider '
           'hover:bg-purple-500/20 transition-all",children:"Ler"})')
BTN_APLICAR = ('b.jsx("button",{onClick:()=>{if(!SI||!W||!pLang)return;'
               'pSetLangMsg(""),pSetLangConfirm(!0)},'
               'className:"px-3 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/40 '
               'text-purple-200 text-[10px] font-black uppercase tracking-wider '
               'hover:bg-purple-500/20 transition-all",children:"Aplicar"})')
BTN_REVERTER = ('b.jsx("button",{onClick:()=>{if(!SI||!W)return;pSetLangMsg("revertendo...");'
                'SI.invoke("spoofer:revert-language",{deviceId:W,confirmGlobal:!0}).then(pR=>{'
                'pR&&pR.success?pSetLangMsg("revertido para "+(pR.language||"o valor anterior"))'
                ':pSetLangMsg("não reverteu: "+((pR&&pR.error)||"sem resposta"))})'
                '.catch(pE=>pSetLangMsg(pLangErro(pE)))},'
                'className:"px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/15 '
                'text-white/60 text-[10px] font-black uppercase tracking-wider '
                'hover:border-white/30 transition-all",children:"Reverter"})')
CONFIRMA = ('pLangConfirm&&b.jsxs("div",{className:"mt-2 p-3 rounded-xl bg-amber-500/10 '
            'border border-amber-500/30 flex flex-col gap-2",children:['
            'b.jsxs("p",{className:"text-[9.5px] font-bold text-amber-200 leading-relaxed",children:['
            '"Vai mudar o ",b.jsx("b",{children:"aparelho inteiro"})," e todos os apps, em ",'
            'b.jsx("b",{children:pLang}),". Os sites passam a receber esse idioma (Accept-Language) '
            'e a interface só muda com respring — o CAM LIVE cai e você reconecta."]}),'
            'b.jsxs("div",{className:"flex gap-2",children:['
            'b.jsx("button",{onClick:()=>{const pLc=((pIdiomas.find(pX=>pX[0]===pLang)||[])[2])'
            '||String(pLang).replace("-","_");pSetLangMsg("aplicando em todo o aparelho...");'
            'SI.invoke("spoofer:apply-language",{deviceId:W,language:pLang,locale:pLc,'
            'confirmGlobal:!0}).then(pR=>{pSetLangConfirm(!1);'
            'pR&&pR.precisaConfirmar?pSetLangMsg("o app pediu confirmação de novo — nada foi aplicado")'
            ':pR&&pR.success?pSetLangMsg("aplicado: "+(pR.language||pLang)+(pR.locale?" / "+pR.locale:"")'
            '+(pR.respring?" · interface atualizada (o CAM LIVE precisa reconectar)":""))'
            ':pSetLangMsg("não aplicou: "+((pR&&pR.error)||"sem resposta"))})'
            '.catch(pE=>{pSetLangConfirm(!1);pSetLangMsg(pLangErro(pE))})},'
            'className:"flex-1 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 '
            'text-amber-100 text-[10px] font-black uppercase tracking-wider",children:"Confirmar"}),'
            'b.jsx("button",{onClick:()=>{pSetLangConfirm(!1),pSetLangMsg("cancelado")},'
            'className:"px-3 py-2 rounded-lg bg-white/[0.04] border border-white/15 text-white/60 '
            'text-[10px] font-black uppercase tracking-wider",children:"Cancelar"})'
            ']})]}),')
BLOCO = (
 'b.jsxs("div",{children:['
 'b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",'
 'children:"Idioma do aparelho"}),'
 'b.jsx("p",{className:"text-[9px] text-white/35 mb-1.5",'
 'children:"Vale para o aparelho inteiro e todos os apps — como a proxy e o GPS."}),'
 'b.jsxs("div",{className:"flex gap-2",children:['
 'b.jsx("select",{value:pLang,onChange:pE=>{pSetLang(pE.target.value),pSetLangConfirm(!1)},'
 'title:"Idioma do aparelho",'
 'className:"flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-white '
 'text-xs font-bold focus:outline-none focus:border-purple-400/50",'
 'children:pIdiomas.map(pX=>b.jsx("option",{value:pX[0],className:"bg-[#0A121E] text-white",'
 'children:pX[1]+" — "+pX[0]},pX[0]))}),'
 + BTN_LER + ',' + BTN_APLICAR + ',' + BTN_REVERTER +
 ']}),'
 + CONFIRMA +
 'b.jsx("p",{className:"text-[9px] mt-1 font-mono text-white/50",children:pLangMsg'
 '||"Reverter volta ao valor de antes deste campo (hoje pt-BR). Para inglês: escolha Inglês (EUA) e Aplicar."}),'
 ']}),'
)
ANC_JSX = 'children:pProxyMsg})]}),b.jsxs("button",{onClick:pIsIos?pSaveIos:el,'
NOVO_JSX = 'children:pProxyMsg})]}),' + BLOCO + 'b.jsxs("button",{onClick:pIsIos?pSaveIos:el,'
FIM_BOTAO = 'b.jsxs("button",{onClick:pIsIos?pSaveIos:el,'

marca = -1
for tag in ('children:"Idioma do aparelho"', 'children:"Idioma do iPhone"'):
    pos = s.find(tag)
    if pos > 0:
        marca = pos
        break

if marca < 0:
    c = s.count(ANC_JSX)
    if c != 1:
        print("T8c ERRO: ancora do bloco da proxy x%d (esperado 1)" % c)
        sys.exit(2)
    s = s.replace(ANC_JSX, NOVO_JSX)
    print("T8c ok")
else:
    inicio = s.rfind('b.jsxs("div",{children:[b.jsx("label"', 0, marca)
    fim = s.find(FIM_BOTAO, marca)
    if inicio < 0 or fim < inicio:
        print("T8c ERRO: nao consegui delimitar o bloco de idioma existente")
        sys.exit(2)
    if s[inicio:inicio + len(BLOCO)] == BLOCO:
        print("T8c ja aplicado")
    else:
        s = s[:inicio] + BLOCO + s[fim:]
        print("T8c ok (bloco anterior substituido)")

if s == o:
    print("nada a fazer")
    sys.exit(0)
if aplicar:
    shutil.copy2(alvo, alvo + ".bak-idioma")
    open(alvo, "w", encoding="utf8").write(s)
    print("gravado (backup %s.bak-idioma)" % os.path.basename(alvo))
else:
    print("simulacao: nada gravado")
