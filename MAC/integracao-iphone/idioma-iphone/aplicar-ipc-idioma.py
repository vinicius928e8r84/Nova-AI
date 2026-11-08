#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Instala o IPC de idioma no app Nova (main.js + módulo em electron/services).

Por padrão NÃO grava nada: mostra o que faria (dry-run). Só grava com --aplicar.
Antes de gravar, faz cópia de segurança do main.js (`.bak-idioma-ipc-<data>`).

O que ele faz, em duas partes:
  1. copia `idioma-ipc.js` para `<app>/Contents/Resources/app/electron/services/idioma-ipc.js`
  2. insere UMA linha no main.js, logo antes dos handlers `spoofer:*`, que registra
     os IPCs: spoofer:get-language, spoofer:apply-language (e alias set-language),
     spoofer:revert-language e spoofer:respring-iphone.

É idempotente: se a linha já existe, não duplica. Se o app for atualizado e o
main.js voltar ao original, basta rodar de novo.

Uso:
  python3 aplicar-ipc-idioma.py                    # dry-run no app instalado
  python3 aplicar-ipc-idioma.py --aplicar          # grava (com backup)
  python3 aplicar-ipc-idioma.py --main /caminho/main.js --services /caminho/services [--aplicar]
"""
import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
MODULO = os.path.join(AQUI, "idioma-ipc.js")
APP_PADRAO = "/Applications/Nova AI Mac.app/Contents/Resources/app"
ANCORA = "  ipcMain.handle('spoofer:get-models', async () => {"
LINHA = (
    "  // Idioma do aparelho: IPCs spoofer:{get,apply,revert}-language + respring.\n"
    "  try { require('./services/idioma-ipc').register(app, ipcMain); } "
    "catch (e) { console.error('[idioma] IPC nao registrado:', e && e.message); }\n"
)


def sha(caminho):
    with open(caminho, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--main", default=os.path.join(APP_PADRAO, "electron", "main.js"))
    ap.add_argument("--services", default=os.path.join(APP_PADRAO, "electron", "services"))
    ap.add_argument("--aplicar", action="store_true", help="grava de verdade (padrão: só simula)")
    a = ap.parse_args()

    if not os.path.isfile(a.main):
        print(f"ERRO: main.js não encontrado em {a.main}")
        return 2
    if not os.path.isfile(MODULO):
        print(f"ERRO: módulo não encontrado em {MODULO}")
        return 2

    original = open(a.main, encoding="utf-8", errors="surrogateescape").read()

    if "require('./services/idioma-ipc')" in original:
        print("já aplicado: o main.js já registra o idioma-ipc (nada a fazer)")
        return 0

    n = original.count(ANCORA)
    if n != 1:
        print(f"ERRO: a âncora aparece {n} vez(es) no main.js; esperava exatamente 1.")
        print(f"      âncora: {ANCORA.strip()}")
        return 3

    novo = original.replace(ANCORA, LINHA + ANCORA, 1)

    # valida a sintaxe antes de dizer que está ok (numa cópia, sem tocar no app)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                     encoding="utf-8", errors="surrogateescape") as tf:
        tf.write(novo)
        tmp = tf.name
    try:
        r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    finally:
        os.unlink(tmp)
    if r.returncode != 0:
        print("ERRO: o main.js resultante não passa no node --check:")
        print(r.stderr.strip()[:800])
        return 4

    print(f"main.js     : {a.main}  (sha {sha(a.main)})")
    print(f"módulo      : {MODULO}  ({os.path.getsize(MODULO)} B)")
    print(f"destino     : {os.path.join(a.services, 'idioma-ipc.js')}")
    print(f"linha nova  : {LINHA.splitlines()[1].strip()}")
    print(f"node --check: OK no arquivo resultante")

    if not a.aplicar:
        print("\nDRY-RUN: nada foi gravado. Rode com --aplicar para instalar no app.")
        return 0

    marca = time.strftime("%Y%m%d-%H%M%S")
    destino = os.path.join(a.services, "idioma-ipc.js")
    bak = f"{a.main}.bak-idioma-ipc-{marca}"
    shutil.copy2(a.main, bak)
    shutil.copy2(MODULO, destino)

    with open(a.main, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(novo)

    print(f"\nGRAVADO:")
    print(f"  backup : {bak}")
    print(f"  módulo : {destino}")
    print(f"  main.js: sha novo {sha(a.main)}")
    print("  Agora feche o Nova e abra de novo (⌘Q) para os IPCs existirem.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
