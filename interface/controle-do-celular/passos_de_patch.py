import os

from sintaxe_do_bundle import conferir_com_o_node


class Substituicao:
    confere_sintaxe = True

    def __init__(self, velho, novo, rotulo, esperado=1):
        self.velho = velho
        self.novo = novo
        self.rotulo = rotulo
        self.esperado = esperado

    def aplicar(self, texto):
        ocorrencias = texto.count(self.velho)
        if ocorrencias != self.esperado:
            raise SystemExit(f'[{self.rotulo}] esperava {self.esperado} ocorrência(s), achei {ocorrencias}: {self.velho[:90]!r}')
        return texto.replace(self.velho, self.novo)


class Transformacao:
    confere_sintaxe = False

    def __init__(self, rotulo, funcao):
        self.rotulo = rotulo
        self.funcao = funcao

    def aplicar(self, texto):
        return self.funcao(texto)


def conferir_passo(texto, rotulo):
    resultado = conferir_com_o_node(texto, 'b.mjs')
    if resultado.returncode != 0:
        detalhe = resultado.stderr.split('SyntaxError')[-1][:200]
        raise SystemExit(f'quebrou em [{rotulo}]: SyntaxError{detalhe}')


def executar_passos(passos, texto):
    rotulos = []
    conferir_a_cada_passo = bool(os.environ.get('CHECK_EACH'))
    for passo in passos:
        texto = passo.aplicar(texto)
        rotulos.append(passo.rotulo)
        if passo.confere_sintaxe and conferir_a_cada_passo:
            conferir_passo(texto, passo.rotulo)
    return texto, rotulos
