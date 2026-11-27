import hashlib
import shutil
from pathlib import Path

from python_portatil.mach_o import HOMEBREW, PREFIXOS_DO_SISTEMA, dependencias


def impressao_do_arquivo(caminho):
    return hashlib.sha256(caminho.read_bytes()).digest()


def e_dependencia_inesperada(dependencia, origem):
    return not dependencia.startswith(PREFIXOS_DO_SISTEMA) and Path(dependencia).resolve() != origem


class FechoDeBibliotecas:
    def __init__(self, raiz):
        self.raiz = raiz
        self.mapeamento = {}
        self.fila = []

    def registrar(self, origem, destino):
        self.mapeamento[origem] = destino
        self.fila.append((origem, destino))

    def adicionar(self, origem):
        origem = origem.resolve()
        if origem in self.mapeamento:
            return self.mapeamento[origem]
        destino = self.raiz / 'lib' / origem.name
        if destino in self.mapeamento.values():
            return self.reaproveitar(origem, destino)
        shutil.copy2(origem, destino)
        self.registrar(origem, destino)
        return destino

    def reaproveitar(self, origem, destino):
        anterior = next(candidata for candidata, copia in self.mapeamento.items() if copia == destino)
        if impressao_do_arquivo(anterior) != impressao_do_arquivo(origem):
            raise RuntimeError('Library collision: ' + str(origem))
        self.mapeamento[origem] = destino
        return destino

    def seguir(self, dependencia, origem):
        if dependencia.startswith(HOMEBREW):
            self.adicionar(Path(dependencia))
        elif e_dependencia_inesperada(dependencia, origem):
            raise RuntimeError('Unexpected dependency: ' + dependencia)

    def percorrer_dependencias(self):
        proximo = 0
        while proximo < len(self.fila):
            origem, _ = self.fila[proximo]
            proximo += 1
            for dependencia in dependencias(origem):
                self.seguir(dependencia, origem)
