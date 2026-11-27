class Substituicao:
    def __init__(self, velho, novo, rotulo, esperado=1):
        self.velho = velho
        self.novo = novo
        self.rotulo = rotulo
        self.esperado = esperado

    def mensagem_de_erro(self, ocorrencias):
        return f'[{self.rotulo}] esperava {self.esperado} ocorrência(s), achei {ocorrencias}: {self.velho[:90]!r}'

    def aplicar(self, texto):
        ocorrencias = texto.count(self.velho)
        if ocorrencias != self.esperado:
            raise SystemExit(self.mensagem_de_erro(ocorrencias))
        return texto.replace(self.velho, self.novo)


class SubstituicaoDeMensagemCurta(Substituicao):
    def mensagem_de_erro(self, ocorrencias):
        return f'[{self.rotulo}] esperava {self.esperado}, achei {ocorrencias}'


class Transformacao:
    def __init__(self, rotulo, funcao):
        self.rotulo = rotulo
        self.funcao = funcao

    def aplicar(self, texto):
        return self.funcao(texto)


def executar_passos(passos, texto):
    rotulos = []
    for passo in passos:
        texto = passo.aplicar(texto)
        rotulos.append(passo.rotulo)
    return texto, rotulos
