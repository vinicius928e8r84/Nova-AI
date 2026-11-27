from delimitadores import fim_do_parentese

ABERTURA_DO_JSX = len('b.jsxs(') - 1
CARTAO = 'b.jsxs("div",{className:"bg-white/[0.02] border border-white/8 rounded-2xl p-5 space-y-3"'
COMO_FUNCIONA = 'b.jsxs("div",{className:"bg-white/[0.01] border border-white/5 rounded-2xl p-4 space-y-2"'

MARCAS_DAS_ANCORAS = {
    'item1': 'children:"Preparar módulo de câmera"',
    'item2': 'children:"Selecionar Vídeo de Câmera Falsa"',
    'como': 'children:"Como Funciona"',
}
PREFIXOS_DOS_CARTOES = (
    ('item1', CARTAO + ',children:[b.jsxs("div",{className:"flex items-center justify-between"'),
    ('item2', CARTAO + ',children:[b.jsxs("div",{className:"flex items-center gap-2"'),
    ('como', COMO_FUNCIONA),
)
VIRGULA_SOBRANDO_DEPOIS = {('[', ','), (',', ',')}


def achar_ancoras(texto):
    ancoras = {nome: texto.find(marca) for nome, marca in MARCAS_DAS_ANCORAS.items()}
    for nome, posicao in ancoras.items():
        if posicao < 0:
            raise ValueError('âncora não encontrada: ' + nome)
    return ancoras


def achar_cartao(texto, prefixo, ancora):
    posicao = 0
    while True:
        inicio = texto.find(prefixo, posicao)
        if inicio < 0:
            raise ValueError('cartão não encontrado: ' + prefixo[:60])
        fim = fim_do_parentese(texto, inicio + ABERTURA_DO_JSX)
        if inicio < ancora < fim:
            return inicio, fim
        posicao = inicio + 1


def apagar_cartao(texto, inicio, fim):
    texto = texto[:inicio] + texto[fim:]
    if inicio >= len(texto):
        return texto
    vizinhos = (texto[inicio - 1], texto[inicio])
    if vizinhos in VIRGULA_SOBRANDO_DEPOIS:
        return texto[:inicio] + texto[inicio + 1:]
    if vizinhos == (',', ']'):
        return texto[:inicio - 1] + texto[inicio:]
    return texto


def remover_cartoes(texto):
    ancoras = achar_ancoras(texto)
    trechos = [achar_cartao(texto, prefixo, ancoras[nome]) for nome, prefixo in PREFIXOS_DOS_CARTOES]
    for inicio, fim in sorted(trechos, reverse=True):
        texto = apagar_cartao(texto, inicio, fim)
    return texto
