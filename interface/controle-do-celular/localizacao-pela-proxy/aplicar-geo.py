#!/usr/bin/env python3
import pathlib
import sys

from passos_da_localizacao import PASSOS
from passos_de_patch import executar_passos
from sintaxe_do_bundle import conferir_com_o_node


def conferir_sintaxe_final(texto):
    resultado = conferir_com_o_node(texto, 'bundle.mjs')
    if resultado.returncode != 0:
        detalhe = resultado.stderr.split('SyntaxError')[-1][:300]
        raise SystemExit(f'quebrou em [final]: SyntaxError{detalhe}')


def principal(argumentos):
    if len(argumentos) != 3:
        print('uso: aplicar-geo.py <origem.js> <saida.js>')
        sys.exit(2)
    origem = pathlib.Path(argumentos[1])
    saida = pathlib.Path(argumentos[2])
    original = origem.read_text(encoding='utf-8')
    texto, rotulos = executar_passos(PASSOS, original)
    conferir_sintaxe_final(texto)
    saida.write_text(texto, encoding='utf-8')
    tamanho_da_origem_depois_de_gravar = len(origem.read_text(encoding='utf-8'))
    print(f'ok: {len(rotulos)} passos, {len(texto)} bytes (origem {tamanho_da_origem_depois_de_gravar})')
    for rotulo in rotulos:
        print('  -', rotulo)


if __name__ == '__main__':
    principal(sys.argv)
