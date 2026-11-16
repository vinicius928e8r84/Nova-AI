import ast
import json
import sys

fonte = sys.stdin.read()
try:
    arvore = ast.parse(fonte)
except SyntaxError:
    print("[]")
    sys.exit(0)

trechos = []
for no in ast.walk(arvore):
    if not isinstance(no, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
        continue
    corpo = getattr(no, "body", [])
    if corpo and isinstance(corpo[0], ast.Expr) and isinstance(getattr(corpo[0], "value", None), ast.Constant) and isinstance(corpo[0].value.value, str):
        trechos.append([corpo[0].lineno, corpo[0].end_lineno])
print(json.dumps(trechos))
