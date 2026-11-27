import os
import subprocess
from pathlib import Path

from python_portatil.mach_o import CODESIGN, HOMEBREW, INSTALL_NAME_TOOL, dependencias


def e_biblioteca_ou_python(destino):
    return destino.suffix == '.dylib' or destino.name == 'Python'


def trocas_de_dependencia(origem, destino, mapeamento):
    trocas = []
    for dependencia in dependencias(origem):
        if dependencia.startswith(HOMEBREW):
            copia = mapeamento[Path(dependencia).resolve()]
            trocas += ['-change', dependencia, '@loader_path/' + os.path.relpath(copia, destino.parent)]
    return trocas


def argumentos_do_install_name_tool(origem, destino, mapeamento):
    argumentos = [INSTALL_NAME_TOOL]
    if e_biblioteca_ou_python(destino):
        argumentos += ['-id', '@loader_path/' + destino.name]
    return argumentos + trocas_de_dependencia(origem, destino, mapeamento)


def reescrever_e_assinar(origem, destino, mapeamento):
    argumentos = argumentos_do_install_name_tool(origem, destino, mapeamento)
    if len(argumentos) > 1:
        subprocess.run(argumentos + [str(destino)], check=True, capture_output=True)
    subprocess.run([CODESIGN, '--force', '--sign', '-', str(destino)], check=True, capture_output=True)


def reescrever_todos(fecho):
    manifesto = []
    for origem, destino in fecho.fila:
        reescrever_e_assinar(origem, destino, fecho.mapeamento)
        manifesto.append({'file': str(destino.relative_to(fecho.raiz)), 'source': str(origem)})
    return manifesto
