ASPAS = '"\'`'
SALDO_DO_PARENTESE = {'(': 1, ')': -1}


class VarreduraDeCodigo:
    def __init__(self):
        self.aspa = None
        self.escapado = False

    def e_codigo(self, caractere):
        if self.aspa:
            self.avancar_dentro_do_texto(caractere)
            return False
        if caractere in ASPAS:
            self.aspa = caractere
            return False
        return True

    def avancar_dentro_do_texto(self, caractere):
        if self.escapado:
            self.escapado = False
        elif caractere == '\\':
            self.escapado = True
        elif caractere == self.aspa:
            self.aspa = None


def fim_do_parentese(texto, abertura):
    varredura = VarreduraDeCodigo()
    profundidade = 0
    for posicao in range(abertura, len(texto)):
        caractere = texto[posicao]
        if not varredura.e_codigo(caractere):
            continue
        profundidade += SALDO_DO_PARENTESE.get(caractere, 0)
        if caractere == ')' and profundidade == 0:
            return posicao + 1
    raise ValueError('parêntese sem fechamento')
