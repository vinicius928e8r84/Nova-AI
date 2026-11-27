#!/usr/bin/env python3
from python_portatil.arquivos_do_runtime import escrever_arquivos_finais, reescrever_sounddevice
from python_portatil.fecho_de_bibliotecas import FechoDeBibliotecas
from python_portatil.layout_do_runtime import PORTAUDIO, LayoutDoRuntime, copiar_frameworks, registrar_binarios_copiados
from python_portatil.reescrita import reescrever_todos


def principal():
    layout = LayoutDoRuntime()
    if layout.destino.exists():
        raise RuntimeError('Runtime já existe; não sobrescrevendo a compilação anterior.')
    copiar_frameworks(layout)
    fecho = FechoDeBibliotecas(layout.raiz)
    registrar_binarios_copiados(layout, fecho)
    (layout.raiz / 'lib').mkdir(exist_ok=True)
    fecho.adicionar(PORTAUDIO)
    fecho.percorrer_dependencias()
    manifesto = reescrever_todos(fecho)
    reescrever_sounddevice(layout)
    escrever_arquivos_finais(layout, manifesto)
    print('Python portátil criado:', len(fecho.fila), 'arquivos Mach-O')


if __name__ == '__main__':
    principal()
