#!/usr/bin/env python3
"""Campo da proxy do Nova (iPhone): seletor de tipo + leitura de qualquer formato.

O que faz no bundle do app:
  T1) troca o pValidProxy "burro" por pProxyX (leitor que extrai host/porta/usuario/senha
      de qualquer ordem) mantendo pValidProxy como atalho;
  T2/T3/T4) Salvar/Salvar identidade/abrir a aba passam a normalizar pelo leitor;
  T5) mensagem de erro diz o que faltou, em vez de "Formato inválido";
  T6) seletor de tipo (SOCKS5/SOCKS5H/HTTP/HTTPS/SOCKS4) + linha com o que foi lido;
  T7) tira "idioma undefined" do status (hunk do aplicar-proxy-formato.py).

Idempotente. Uso: aplicar-proxy-tipo.py ALVO.js [--aplicar]
Sem --aplicar so simula. Com --aplicar grava e deixa ALVO.js.bak-proxy-tipo.
"""
import sys, os, re, shutil

aqui = os.path.dirname(os.path.abspath(__file__))
js_path = os.path.join(aqui, "proxy-parse.js")

alvo = sys.argv[1] if len(sys.argv) > 1 else ""
aplicar = "--aplicar" in sys.argv
if not alvo:
    print("uso: aplicar-proxy-tipo.py ALVO.js [--aplicar]")
    sys.exit(2)

js = open(js_path, encoding="utf8").read()
# vira o corpo de uma IIFE que devolve os helpers
linhas = [l for l in js.splitlines() if not l.startswith("if (typeof module")]
corpo = "\n".join(linhas).replace("var PV_EXPORTS =", "return ", 1)
corpo = corpo.rstrip()
assert corpo.endswith("};"), "proxy-parse.js sem bloco PV_EXPORTS"
suite = "pProxyX=(()=>{\n" + corpo + "\n})(),pValidProxy=pV=>!!pProxyX.parse(pV)"

s = open(alvo, encoding="utf8").read()
o = s

if "pProxyX=" in s:
    print("T1 ja aplicado")
else:
    m = re.search(r'pValidProxy=pV=>\{.*?pCh<="9"\)\}', s, re.S)
    if not m:
        print("T1 ERRO: nao achei a definicao do pValidProxy")
        sys.exit(2)
    s = s[:m.start()] + suite + s[m.end():]
    print("T1 ok")

hunks = [
    ("T2", "pSaveProxy=async()=>{const pV=pProxy.trim();",
           "pSaveProxy=async()=>{const pV=pProxyX.norm(pProxy);pV!==pProxy.trim()&&pSetProxy(pV);", 1),
    ("T3", "pSaveIos=async()=>{if(!W)return;const pV=pProxy.trim();",
           "pSaveIos=async()=>{if(!W)return;const pV=pProxyX.norm(pProxy);pV!==pProxy.trim()&&pSetProxy(pV);", 1),
    ("T4", '||(pProxy||"").trim();pP&&pGeoApply(pP)',
           '||pProxyX.norm(pProxy);pP&&pGeoApply(pP)', 1),
    ("T5", 'pSetProxyMsg("Formato inválido. Use socks5://host:porta:usuario:senha.")',
           'pSetProxyMsg("Não achei host e porta nessa proxy. Cole como host:porta@usuario:senha, '
           'usuario:senha@host:porta ou host:porta:usuario:senha.")', 2),
]
for nome, velho, novo, esperado in hunks:
    if novo in s:
        print(nome, "ja aplicado")
        continue
    c = s.count(velho)
    if c < 1 or c > esperado:
        print(nome, "ERRO: ancora x%d (esperado 1..%d)" % (c, esperado))
        sys.exit(2)
    s = s.replace(velho, novo)
    print(nome, "ok (%d)" % c)

# formato antigo ja aplicado? entao as tres chamadas usam pNormProxy -> troca pelo leitor novo
if "pNormProxy(pProxy)" in s and "pProxyX.norm(pProxy)" not in s:
    s = s.replace("pNormProxy(pProxy)", "pProxyX.norm(pProxy)")
    print("T2/T3/T4 variante pNormProxy: ok")

SEL = ('b.jsx("select",{value:pProxyX.schemeOf(pProxy),onChange:pE=>pSetProxy(pProxyX.withScheme('
       'pE.target.value,pProxy)),title:"Tipo da proxy",className:"bg-white/[0.03] border border-white/10 '
       'rounded-xl px-2 py-2.5 text-white text-[10px] font-black uppercase tracking-wider focus:outline-none '
       'focus:border-purple-400/50",children:[["socks5","SOCKS5"],["socks5h","SOCKS5H"],["http","HTTP"],'
       '["https","HTTPS"],["socks4","SOCKS4"]].map(pX=>b.jsx("option",{value:pX[0],'
       'className:"bg-[#0A121E] text-white",children:pX[1]},pX[0]))}),')

ANCORA_INPUT = 'b.jsxs("div",{className:"flex gap-2",children:[b.jsx("input",{type:"text",value:pProxy,'
if SEL in s:
    print("T6a ja aplicado")
else:
    c = s.count(ANCORA_INPUT)
    if c != 1:
        print("T6a ERRO: ancora do input x%d (esperado 1)" % c)
        sys.exit(2)
    s = s.replace(ANCORA_INPUT, 'b.jsxs("div",{className:"flex gap-2",children:[' + SEL + 'b.jsx("input",{type:"text",value:pProxy,')
    print("T6a ok")

INFO = ('b.jsx("p",{className:"text-[9px] mt-1 font-mono "+(pProxyX.parse(pProxy)&&(pProxyX.schemeOf(pProxy)'
        '==="socks5"||pProxyX.schemeOf(pProxy)==="socks5h")?"text-white/40":"text-amber-400"),children:(()=>{'
        'const pO=pProxyX.parse(pProxy);'
        'if(!pO)return "cole a proxy em qualquer formato: host:porta@usuario:senha, usuario:senha@host:porta '
        'ou host:porta:usuario:senha";'
        'const pSc=pProxyX.schemeOf(pProxy);'
        'return (pO.scheme||"socks5")+" · "+pO.host+":"+pO.port+" · "+(pO.user?"usuário "+pO.user:"sem usuário")'
        '+" · "+(pO.pass?"senha "+String(pO.pass).length+" caracteres":"sem senha")'
        '+((pSc==="socks5"||pSc==="socks5h")?"":" — o aparelho hoje só aplica socks5/socks5h")})()}),')
ANCORA_MSG = ',children:"Salvar"})]}),pProxyMsg&&b.jsx("p",{'
if INFO in s:
    print("T6b ja aplicado")
else:
    c = s.count(ANCORA_MSG)
    if c != 1:
        print("T6b ERRO: ancora do botao Salvar x%d (esperado 1)" % c)
        sys.exit(2)
    s = s.replace(ANCORA_MSG, ',children:"Salvar"})]}),' + INFO + 'pProxyMsg&&b.jsx("p",{')
    print("T6b ok")

IDIOMA_VELHO = '` · idioma ${pL.language} · fuso ${pL.timezone||pG.timezone||"—"}`'
IDIOMA_NOVO = '`${pL.language?` · idioma ${pL.language}`:""} · fuso ${pL.timezone||pG.timezone||"—"}`'
if IDIOMA_NOVO in s:
    print("T7 ja aplicado")
else:
    c = s.count(IDIOMA_VELHO)
    if c != 1:
        print("T7 ERRO: ancora do idioma x%d (esperado 1)" % c)
        sys.exit(2)
    s = s.replace(IDIOMA_VELHO, IDIOMA_NOVO)
    print("T7 ok")

if s == o:
    print("nada a fazer")
    sys.exit(0)
if aplicar:
    shutil.copy2(alvo, alvo + ".bak-proxy-tipo")
    open(alvo, "w", encoding="utf8").write(s)
    print("gravado (backup %s.bak-proxy-tipo)" % os.path.basename(alvo))
else:
    print("simulacao: nada gravado")
