#!/usr/bin/env python3
"""Botão do cartão iPhone: "Conectar" -> "Abrir controle" depois de conectado.

O renderer é um bundle já compilado (index-Dun7lr2S.js). Este script troca apenas
dois trechos do painel PHONE CONTROL:

1. cria `PI(id)`, que pede ao main para abrir o controle do iPhone já preparado;
2. no cartão com `streaming`, iPhone mostra "Abrir controle" (ciano) e chama PI;
   Android continua com "Parar transmissão" e Wc.

Uso:
    python3 aplicar-botao-iphone.py                      # aplica no app instalado
    python3 aplicar-botao-iphone.py entrada.js saida.js   # aplica em uma cópia
"""
import shutil
import subprocess
import sys
import tempfile
import os

DEFAULT = '/Applications/Nova AI Mac.app/Contents/Resources/app/dist/assets/index-Dun7lr2S.js'
MARKER = 'physical-mobile:ios-console-open'

OLD_ANCHOR = 'catch(gI){console.error("[PhysicalMobilePanel] Stream start error:",gI)}},Wc='
NEW_ANCHOR = ('catch(gI){console.error("[PhysicalMobilePanel] Stream start error:",gI)}},'
              'PI=async eI=>{if(SI)try{await SI.invoke("physical-mobile:ios-console-open",eI)}'
              'catch(gI){console.error("[PhysicalMobilePanel] iOS console error:",gI)}},Wc=')

OLD_BRANCH = ('eI.streaming?b.jsxs("button",{onClick:gI=>{gI.stopPropagation(),Wc(eI.id)},'
              'className:"flex-1 py-2 bg-red-500/20 border border-red-500/40 text-red-400 '
              'text-[10px] font-black tracking-widest uppercase rounded-xl hover:bg-red-500/30 '
              'transition-all flex items-center justify-center gap-1",'
              'children:[b.jsx(mW,{size:10,fill:"currentColor"})," Parar transmissão"]})')

IOS = '(eI.ios||String(eI.id).startsWith("ios-"))'
NEW_BRANCH = ('eI.streaming?b.jsxs("button",{onClick:gI=>{gI.stopPropagation(),' + IOS + '?PI(eI.id):Wc(eI.id)},'
              'className:"flex-1 py-2 "+(' + IOS + '?'
              '"bg-j-cyan text-black hover:bg-j-cyan/80 shadow-[0_0_15px_rgba(0,229,255,0.15)]":'
              '"bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30")+'
              '" text-[10px] font-black tracking-widest uppercase rounded-xl transition-all '
              'flex items-center justify-center gap-1",'
              'children:[b.jsx(bY,{size:10,fill:"currentColor"}),'
              '(' + IOS + '?" Abrir controle":" Parar transmissão")]})')


def syntax_ok(path):
    """O bundle é um módulo ESM; o node só aceita .mjs fora de um package type=module."""
    with tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8') as tmp:
        shutil.copyfileobj(open(path, encoding='utf-8'), tmp)
        tmp_path = tmp.name
    try:
        result = subprocess.run(['node', '--check', tmp_path], capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stderr.strip())
        return result.returncode == 0
    finally:
        os.unlink(tmp_path)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    code = open(src, encoding='utf-8').read()

    if MARKER in code:
        print('Já aplicado em', src)
        return 0
    for name, anchor in (('âncora PI', OLD_ANCHOR), ('trecho do botão', OLD_BRANCH)):
        if code.count(anchor) != 1:
            print('Esperava 1 ocorrência de', name, '- encontrei', code.count(anchor))
            return 1

    patched = code.replace(OLD_ANCHOR, NEW_ANCHOR, 1).replace(OLD_BRANCH, NEW_BRANCH, 1)
    open(dst, 'w', encoding='utf-8').write(patched)
    if not syntax_ok(dst):
        print('Sintaxe inválida em', dst)
        return 1
    print('Aplicado:', dst)
    return 0


if __name__ == '__main__':
    sys.exit(main())
