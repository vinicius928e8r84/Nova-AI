import json

from python_portatil.layout_do_runtime import VERSAO
from python_portatil.textos_do_runtime import FIND_LIBRARY_DO_PORTAUDIO, LINHA_DO_FIND_LIBRARY, RUN_PYTHON


def reescrever_sounddevice(layout):
    arquivo = layout.pacotes / 'sounddevice.py'
    texto = arquivo.read_text()
    arquivo.write_text(texto.replace(LINHA_DO_FIND_LIBRARY, FIND_LIBRARY_DO_PORTAUDIO))


def links_do_framework(layout):
    framework = layout.raiz / 'Python.framework'
    return [
        (framework / 'Versions/Current', VERSAO),
        (framework / 'Python', 'Versions/Current/Python'),
        (framework / 'Resources', 'Versions/Current/Resources'),
    ]


def criar_links(layout):
    for link, alvo in links_do_framework(layout):
        if not (link.exists() or link.is_symlink()):
            link.symlink_to(alvo)


def escrever_arquivos_finais(layout, manifesto):
    (layout.raiz / 'manifest.json').write_text(json.dumps(manifesto, indent=2) + '\n')
    run_python = layout.raiz / 'run-python'
    run_python.write_text(RUN_PYTHON)
    run_python.chmod(0o755)
    criar_links(layout)
