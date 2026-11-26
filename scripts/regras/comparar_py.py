import ast
import io
import json
import sys
import tokenize

COM_CORPO = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)


def eh_docstring(no):
    if not isinstance(no, ast.Expr):
        return False
    valor = no.value
    return isinstance(valor, ast.Constant) and isinstance(valor.value, str)


def tem_docstring(no):
    return isinstance(no, COM_CORPO) and bool(no.body) and eh_docstring(no.body[0])


def sem_docstrings(arvore):
    for no in filter(tem_docstring, ast.walk(arvore)):
        no.body = no.body[1:]
    return arvore


def comentarios_de(texto):
    leitor = tokenize.generate_tokens(io.StringIO(texto).readline)
    return [t.string for t in leitor if t.type == tokenize.COMMENT]


def ler(texto):
    texto = texto.replace("\r\n", "\n")
    arvore = ast.parse(texto)
    docstrings = sum(1 for no in ast.walk(arvore) if tem_docstring(no))
    return {
        "comentarios": comentarios_de(texto),
        "docstrings": docstrings,
        "arvore": ast.dump(sem_docstrings(arvore)),
        "usaDoc": "__doc__" in texto,
    }


def comparar(antes, depois):
    antes, depois = ler(antes), ler(depois)
    igual = antes["arvore"] == depois["arvore"]
    return {
        "ok": igual,
        "motivo": None if igual else "o código mudou",
        "comentariosAntes": antes["comentarios"],
        "comentariosDepois": depois["comentarios"],
        "docstringsRemovidas": antes["docstrings"] - depois["docstrings"],
        "usaDoc": antes["usaDoc"] or depois["usaDoc"],
    }


entrada = json.loads(sys.stdin.buffer.read().decode("utf-8"))
try:
    resultado = comparar(entrada["antes"], entrada["depois"])
except (SyntaxError, tokenize.TokenError, ValueError) as erro:
    resultado = {"ok": False, "motivo": "não foi possível ler: %s" % erro}
print(json.dumps(resultado))
