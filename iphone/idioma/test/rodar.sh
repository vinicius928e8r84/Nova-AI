#!/bin/bash
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
falhas=0

echo "════ 1/4 novalanguage (binário) ════"
bash "$AQUI/teste-novalanguage.sh" || falhas=$((falhas+1))

echo
echo "════ 2/4 helper v4 (nova-locale.sh) ════"
bash "$AQUI/teste-helper.sh" || falhas=$((falhas+1))

echo
echo "════ 3/4 IPC spoofer:*language ════"
node "$AQUI/teste-ipc.js" || falhas=$((falhas+1))

echo
echo "════ 4/4 novalanguage (caracterização do corte) ════"
bash "$AQUI/caracterizacao.sh" || falhas=$((falhas+1))

echo
if [ "$falhas" -eq 0 ]; then echo "TUDO VERDE: idioma (backend) testado no Mac, sem aparelho"; else echo "$falhas BLOCO(S) COM FALHA"; fi
exit $([ "$falhas" -eq 0 ] && echo 0 || echo 1)
