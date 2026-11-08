#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Instala o "Salvar tudo" e o "Restaurar celular" no app Nova (main.js + módulos).

Por padrão NÃO grava nada (dry-run). Só grava com --aplicar, com backup datado.

O que faz:
  1. copia `identidade-ipc.js` (e `idioma-ipc.js`, que ele usa para o idioma)
     para `<electron>/services/`
  2. insere UMA linha no main.js registrando os handlers:
       spoofer:salvar-tudo, spoofer:restaurar-celular (alias revert-all),
       spoofer:registrar-modelo, spoofer:listar-modelos-registrados,
       spoofer:remover-modelo-registrado, spoofer:aplicar-modelo-registrado,
       spoofer:coords-da-proxy, spoofer:validar-coordenadas

Correção de um defeito do aplicador anterior: se você apontar --main para uma
CÓPIA, o destino dos módulos passa a ser `<pasta-da-cópia>/services` — nunca o
app instalado. E `--aplicar` numa cópia sem `--services` explícito é recusado,
para não gravar arquivo no app sem querer.

Uso:
  python3 aplicar-ipc-identidade.py                 # dry-run no app instalado
  python3 aplicar-ipc-identidade.py --aplicar       # grava (com backup)
  python3 aplicar-ipc-identidade.py --main <cópia>/main.js [--services <cópia>/services] [--aplicar]
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
APP_PADRAO = "/Applications/Nova AI Mac.app/Contents/Resources/app"
MAIN_PADRAO = os.path.join(APP_PADRAO, "electron", "main.js")

MODULOS = [
    os.path.join(AQUI, "identidade-ipc.js"),
    os.path.join(AQUI, "..", "idioma-iphone", "idioma-ipc.js"),
]
ANCORA = "  ipcMain.handle('spoofer:get-models', async () => {"
MARCA = "require('./services/identidade-ipc')"
LINHA = (
    "  // Identidade simulada: um único Salvar empurra modelo, proxy, GPS e idioma.\n"
    "  try { require('./services/identidade-ipc').register(app, ipcMain); } "
    "catch (e) { console.error('[identidade] IPC nao registrado:', e && e.message); }\n"
)


def sha(caminho):
    with open(caminho, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--main", default=MAIN_PADRAO)
    ap.add_argument("--services", default=None, help="pasta services de destino (padrão: a do --main)")
    ap.add_argument("--aplicar", action="store_true")
    a = ap.parse_args()

    main_path = os.path.abspath(a.main)
    copia = os.path.dirname(main_path) != os.path.join(APP_PADRAO, "electron")
    services = a.services or os.path.join(os.path.dirname(main_path), "services")

    if not os.path.isfile(main_path):
        print(f"ERRO: main.js não encontrado em {main_path}")
        return 2
    presentes = [m for m in MODULOS if os.path.isfile(m)]
    if not any(m.endswith("identidade-ipc.js") for m in presentes):
        print("ERRO: identidade-ipc.js não encontrado ao lado do script")
        return 2

    if a.aplicar and copia and not a.services:
        print("ERRO: --main aponta para fora do app; passe --services explícito para não gravar no app instalado.")
        print("      (se o objetivo É o app, rode sem --main)")
        return 5

    try:
        original = open(main_path, encoding="utf-8", errors="surrogateescape").read()
    except OSError as e:
        print(f"ERRO ao ler {main_path}: {e}")
        return 2

    if MARCA in original:
        print("já aplicado: o main.js já registra o identidade-ipc (nada a fazer)")
        return 0

    n = original.count(ANCORA)
    if n != 1:
        print(f"ERRO: a âncora aparece {n} vez(es) no main.js; esperava exatamente 1.")
        print(f"      âncora: {ANCORA.strip()}")
        return 3

    novo = original.replace(ANCORA, LINHA + ANCORA, 1)

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

    print(f"main.js  : {main_path}  (sha {sha(main_path)})")
    print(f"services : {services}")
    for m in presentes:
        print(f"módulo   : {os.path.basename(m)}  ({os.path.getsize(m)} B)")
    if not any(os.path.basename(m) == "idioma-ipc.js" for m in presentes):
        print("AVISO    : idioma-ipc.js ausente — o idioma do aparelho não vai funcionar (modelo/proxy/GPS seguem).")
    print(f"linha    : {LINHA.splitlines()[1].strip()}")
    print("node --check: OK no arquivo resultante")

    if not a.aplicar:
        print("\nDRY-RUN: nada foi gravado. Rode com --aplicar para instalar no app.")
        return 0

    marca = time.strftime("%Y%m%d-%H%M%S")
    bak = f"{main_path}.bak-identidade-ipc-{marca}"
    shutil.copy2(main_path, bak)
    os.makedirs(services, exist_ok=True)
    copiados = []
    for m in presentes:
        destino = os.path.join(services, os.path.basename(m))
        shutil.copy2(m, destino)
        copiados.append(destino)
    with open(main_path, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(novo)

    print("\nGRAVADO:")
    print(f"  backup : {bak}")
    for c in copiados:
        print(f"  módulo : {c}")
    print(f"  main.js: sha novo {sha(main_path)}")
    print("  Feche o Nova e abra de novo (⌘Q) para os IPCs existirem.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
