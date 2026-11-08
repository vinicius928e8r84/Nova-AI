#!/bin/bash
# Roda TODOS os testes do idioma no Mac. Não toca no iPhone nem no app instalado:
#  - novalanguage  : compila o main.m do .deb e faz ida-e-volta num domínio descartável
#  - helper v3     : subcomandos language/respring com binário e killall FALSOS
#  - IPC           : createHandlers com exec falso (nada de ssh)
#  - aplicador     : aplica numa CÓPIA do main.js do app e confere a idempotência
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/Nova AI Mac.app/Contents/Resources/app"
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
echo "════ 4/4 aplicador do IPC (só numa cópia) ════"
if [ ! -f "$APP/electron/main.js" ]; then
    echo "app não encontrado; pulando (nada quebrado)"
else
    T=$(mktemp -d)
    mkdir -p "$T/electron/services"
    cp "$APP/electron/main.js" "$T/electron/main.js"
    antes=$(shasum -a 256 "$APP/electron/main.js" | cut -d' ' -f1)
    python3 "$AQUI/../aplicar-ipc-idioma.py" --main "$T/electron/main.js" --services "$T/electron/services" >/dev/null || falhas=$((falhas+1))
    grep -q "idade do aparelho\|idioma-ipc" "$T/electron/main.js" && { echo "FALHA: dry-run gravou alguma coisa"; falhas=$((falhas+1)); }
    python3 "$AQUI/../aplicar-ipc-idioma.py" --main "$T/electron/main.js" --services "$T/electron/services" --aplicar >/dev/null || falhas=$((falhas+1))
    [ "$(grep -c "require('./services/idioma-ipc')" "$T/electron/main.js")" = "1" ] || { echo "FALHA: linha do require não entrou uma única vez"; falhas=$((falhas+1)); }
    node --check "$T/electron/main.js" || { echo "FALHA: main.js patchado não passa no node --check"; falhas=$((falhas+1)); }
    python3 "$AQUI/../aplicar-ipc-idioma.py" --main "$T/electron/main.js" --services "$T/electron/services" --aplicar | grep -q "já aplicado" \
        || { echo "FALHA: segunda passada devia dizer 'já aplicado'"; falhas=$((falhas+1)); }
    depois=$(shasum -a 256 "$APP/electron/main.js" | cut -d' ' -f1)
    [ "$antes" = "$depois" ] && echo "app instalado intocado (sha ${depois:0:16}…) " \
        || { echo "FALHA: o main.js do app mudou!"; falhas=$((falhas+1)); }
    MOD_BRANCH=$(shasum -a 256 "$AQUI/../idioma-ipc.js" | cut -d' ' -f1)
    if [ -f "$APP/electron/services/idioma-ipc.js" ]; then
        MOD_APP=$(shasum -a 256 "$APP/electron/services/idioma-ipc.js" | cut -d' ' -f1)
        if [ "$MOD_BRANCH" = "$MOD_APP" ]; then
            echo "FALHA: este módulo da branch está copiado dentro do app"; falhas=$((falhas+1))
        else
            echo "AVISO: existe um idioma-ipc.js ÓRFÃO no app (sha ${MOD_APP:0:12}…, não é o desta branch,"
            echo "       e o main.js não o usa). Não removo sem OK — é arquivo do app."
        fi
    fi
    rm -rf "$T"
fi

echo
if [ "$falhas" -eq 0 ]; then echo "TUDO VERDE: idioma (backend) testado no Mac, sem aparelho"; else echo "$falhas BLOCO(S) COM FALHA"; fi
exit $([ "$falhas" -eq 0 ] && echo 0 || echo 1)
