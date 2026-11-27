import shutil
from pathlib import Path

from python_portatil.mach_o import e_mach_o

VERSAO = '3.15'
RECURSOS = Path('/Applications/Nova AI Mac.app/Contents/Resources')
FRAMEWORK_DO_HOMEBREW = Path('/opt/homebrew/Cellar/python@3.15/3.15.2/Frameworks/Python.framework/Versions')
PORTAUDIO = Path('/opt/homebrew/opt/portaudio/lib/libportaudio.2.dylib')


class LayoutDoRuntime:
    def __init__(self):
        self.raiz = RECURSOS / 'python-runtime-portable'
        self.origem = FRAMEWORK_DO_HOMEBREW / VERSAO
        self.destino = self.raiz / 'Python.framework/Versions' / VERSAO
        self.pacotes = self.destino / 'lib' / ('python' + VERSAO) / 'site-packages'
        self.pacotes_do_app = RECURSOS / 'python-env/lib' / ('python' + VERSAO) / 'site-packages'


def copiar_frameworks(layout):
    shutil.copytree(layout.origem, layout.destino, symlinks=True, ignore=shutil.ignore_patterns('site-packages', 'Headers', '__pycache__'))
    shutil.copytree(layout.pacotes_do_app, layout.pacotes, symlinks=True, ignore=shutil.ignore_patterns('__pycache__'))


def e_arquivo_comum(caminho):
    return caminho.is_file() and not caminho.is_symlink()


def e_binario_a_reescrever(copia):
    return e_arquivo_comum(copia) and e_mach_o(copia)


def origem_do_binario(layout, copia):
    if copia.is_relative_to(layout.pacotes):
        return layout.pacotes_do_app / copia.relative_to(layout.pacotes)
    return layout.origem / copia.relative_to(layout.destino)


def registrar_binarios_copiados(layout, fecho):
    for copia in layout.destino.rglob('*'):
        if e_binario_a_reescrever(copia):
            fecho.registrar(origem_do_binario(layout, copia).resolve(), copia)
