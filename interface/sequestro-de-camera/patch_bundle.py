#!/usr/bin/env python3
import pathlib
import sys

from cartoes_do_bundle import remover_cartoes
from textos_do_sequestro import ANCORA_DO_ITEM3, DESCRICAO_DO_ITEM3, GRADE_DE_BOTOES, SUBSTITUICOES

APP = pathlib.Path('/Applications/Nova AI Mac.app/Contents/Resources/app/dist/assets/index-Dun7lr2S.js')
PROJ = pathlib.Path(__file__).resolve().parent


def substituir_uma_vez(texto, velho, novo):
    ocorrencias = texto.count(velho)
    if ocorrencias != 1:
        raise ValueError(f'substituição esperava 1 ocorrência, achei {ocorrencias}: {velho[:70]}')
    return texto.replace(velho, novo)


def inserir_descricao_do_item3(texto):
    ancora = texto.find(ANCORA_DO_ITEM3)
    if ancora < 0:
        raise ValueError('item 3 não encontrado')
    grade = texto.find(GRADE_DE_BOTOES, ancora)
    if grade < 0:
        raise ValueError('grade de botões do item 3 não encontrada')
    return texto[:grade] + DESCRICAO_DO_ITEM3 + texto[grade:]


def patchear(texto):
    texto = remover_cartoes(texto)
    texto = inserir_descricao_do_item3(texto)
    for velho, novo in SUBSTITUICOES:
        texto = substituir_uma_vez(texto, velho, novo)
    return texto


def principal():
    origem = pathlib.Path(sys.argv[1])
    texto = patchear(origem.read_text(encoding='utf-8'))
    APP.write_text(texto, encoding='utf-8')
    (PROJ / 'index-Dun7lr2S.patched.js').write_text(texto, encoding='utf-8')
    print('bundle patcheado:', APP)
    print('cópia do projeto:', PROJ / 'index-Dun7lr2S.patched.js')
    print('tamanho final:', len(texto))


if __name__ == '__main__':
    principal()
