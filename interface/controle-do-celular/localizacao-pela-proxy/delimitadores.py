ASPAS = '"\'`'
ABERTURAS = '([{'
FECHAMENTOS = ')]}'
SALDO_DO_DELIMITADOR = {**{abre: 1 for abre in ABERTURAS}, **{fecha: -1 for fecha in FECHAMENTOS}}


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


def fim_do_delimitador(texto, abertura):
    varredura = VarreduraDeCodigo()
    profundidade = 0
    for posicao in range(abertura, len(texto)):
        caractere = texto[posicao]
        if not varredura.e_codigo(caractere):
            continue
        profundidade += SALDO_DO_DELIMITADOR.get(caractere, 0)
        if caractere in FECHAMENTOS and profundidade == 0:
            return posicao
    raise SystemExit('delimitador não fechou')
