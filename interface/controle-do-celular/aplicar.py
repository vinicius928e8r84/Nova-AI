#!/usr/bin/env python3
import pathlib
import sys

from passos_da_conexao import PASSOS_DA_CONEXAO
from passos_da_identidade import PASSOS_DA_IDENTIDADE
from passos_de_patch import executar_passos
from passos_do_estado import PASSOS_DO_ESTADO
from sintaxe_do_bundle import conferir_com_o_node

MARCAS_ESPERADAS = ('function III({onClose:I})', 'DISPOSITIVOS REAIS CONECTADOS', 'Suíte de Hardware')
PASSOS = PASSOS_DO_ESTADO + PASSOS_DA_CONEXAO + PASSOS_DA_IDENTIDADE


def conferir_marcas(texto):
    for marca in MARCAS_ESPERADAS:
        if marca not in texto:
            raise SystemExit('bundle inesperado, falta: ' + marca)


def conferir_sintaxe_final(texto):
    resultado = conferir_com_o_node(texto, 'bundle.mjs')
    if resultado.returncode != 0:
        print(resultado.stderr)
        raise SystemExit('sintaxe inválida — nada foi gravado')


def principal(argumentos):
    if len(argumentos) != 3:
        print('uso: aplicar.py <origem.js> <saida.js>')
        sys.exit(2)
    origem = pathlib.Path(argumentos[1])
    saida = pathlib.Path(argumentos[2])
    original = origem.read_text(encoding='utf-8')
    conferir_marcas(original)
    texto, rotulos = executar_passos(PASSOS, original)
    conferir_sintaxe_final(texto)
    saida.write_text(texto, encoding='utf-8')
    print(f'ok: {origem.name} → {saida.name}  ({len(original)} → {len(texto)} bytes, {len(texto) - len(original):+d})')
    for rotulo in rotulos:
        print('  ·', rotulo)


if __name__ == '__main__':
    principal(sys.argv)
