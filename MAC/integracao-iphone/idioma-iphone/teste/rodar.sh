#!/bin/bash
# Roda TODOS os testes do idioma no Mac. Não toca no iPhone nem no app instalado:
#  - novalanguage  : compila o main.m do .deb e faz ida-e-volta num domínio descartável
#  - helper v3     : subcomandos language/respring com binário e killall FALSOS
#  - IPC           : createHandlers com exec falso (nada de ssh)
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
falhas=0

echo "════ 1/3 novalanguage (binário) ════"
bash "$AQUI/teste-novalanguage.sh" || falhas=$((falhas+1))

echo
echo "════ 2/3 helper v4 (nova-locale.sh) ════"
bash "$AQUI/teste-helper.sh" || falhas=$((falhas+1))

echo
echo "════ 3/3 IPC spoofer:*language ════"
node "$AQUI/teste-ipc.js" || falhas=$((falhas+1))

echo
if [ "$falhas" -eq 0 ]; then echo "TUDO VERDE: idioma (backend) testado no Mac, sem aparelho"; else echo "$falhas BLOCO(S) COM FALHA"; fi
exit $([ "$falhas" -eq 0 ] && echo 0 || echo 1)
