#!/bin/bash
# Testes do "Salvar tudo / Restaurar celular" no Mac. Sem iPhone, sem app tocado.
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/Nova AI Mac.app/Contents/Resources/app"
falhas=0

echo "════ 1/3 identidade (salvar tudo, restaurar, registrar) ════"
node "$AQUI/teste-identidade.js" || falhas=$((falhas+1))

echo
echo "════ 2/3 regressão do idioma (módulo reusado) ════"
bash "$AQUI/../../idioma-iphone/teste/rodar.sh" > /tmp/idioma-regressao.log 2>&1
if grep -q "TUDO VERDE" /tmp/idioma-regressao.log; then
    echo "idioma: TUDO VERDE (detalhe em /tmp/idioma-regressao.log)"
else
    echo "FALHA: a suíte do idioma não passou"; tail -5 /tmp/idioma-regressao.log; falhas=$((falhas+1))
fi

echo
echo "════ 3/3 aplicador do IPC (só numa cópia) ════"
if [ ! -f "$APP/electron/main.js" ]; then
    echo "app não encontrado; pulando"
else
    T=$(mktemp -d); mkdir -p "$T/electron/services"; cp "$APP/electron/main.js" "$T/electron/main.js"
    antes=$(shasum -a 256 "$APP/electron/main.js" | cut -d' ' -f1)
    P="$AQUI/../aplicar-ipc-identidade.py"
    python3 "$P" --main "$T/electron/main.js" >/dev/null || { echo "FALHA: dry-run"; falhas=$((falhas+1)); }
    grep -q "identidade-ipc" "$T/electron/main.js" && { echo "FALHA: dry-run gravou"; falhas=$((falhas+1)); }
    python3 "$P" --main "$T/electron/main.js" --aplicar >/dev/null && { echo "FALHA: devia recusar --aplicar fora do app sem --services"; falhas=$((falhas+1)); }
    ls "$T/electron/services/identidade-ipc.js" >/dev/null 2>&1 && { echo "FALHA: copiou módulo sem --aplicar"; falhas=$((falhas+1)); }
    python3 "$P" --main "$T/electron/main.js" --services "$T/electron/services" --aplicar >/dev/null || { echo "FALHA: aplicar na cópia"; falhas=$((falhas+1)); }
    [ "$(grep -c "require('./services/identidade-ipc')" "$T/electron/main.js")" = "1" ] || { echo "FALHA: linha não entrou uma única vez"; falhas=$((falhas+1)); }
    node --check "$T/electron/main.js" || { echo "FALHA: main.js patchado inválido"; falhas=$((falhas+1)); }
    python3 "$P" --main "$T/electron/main.js" --services "$T/electron/services" --aplicar | grep -q "já aplicado" \
        || { echo "FALHA: 2a passada devia dizer já aplicado"; falhas=$((falhas+1)); }
    [ -f "$T/electron/services/idioma-ipc.js" ] || { echo "FALHA: não copiou idioma-ipc.js"; falhas=$((falhas+1)); }
    node --check "$T/electron/services/identidade-ipc.js" && node --check "$T/electron/services/idioma-ipc.js" \
        || { echo "FALHA: módulo copiado inválido"; falhas=$((falhas+1)); }
    ID_BRANCH=$(shasum -a 256 "$AQUI/../identidade-ipc.js" | cut -d' ' -f1)
    for m in identidade-ipc.js idioma-ipc.js; do
        alvo="$APP/electron/services/$m"
        [ -f "$alvo" ] || continue
        sha_app=$(shasum -a 256 "$alvo" | cut -d' ' -f1)
        if [ "$m" = "identidade-ipc.js" ] && [ "$sha_app" = "$ID_BRANCH" ]; then
            echo "FALHA: identidade-ipc.js desta branch está dentro do app"; falhas=$((falhas+1))
        else
            echo "AVISO: $m órfão no app (sha ${sha_app:0:12}…); main.js não o usa. Não removo sem OK."
        fi
    done
    depois=$(shasum -a 256 "$APP/electron/main.js" | cut -d' ' -f1)
    [ "$antes" = "$depois" ] && echo "app instalado intocado (sha ${depois:0:16}…)" || { echo "FALHA: o app mudou!"; falhas=$((falhas+1)); }
    rm -rf "$T"
fi

echo
if [ "$falhas" -eq 0 ]; then echo "TUDO VERDE: salvar-tudo/restaurar testados no Mac, sem aparelho"; else echo "$falhas BLOCO(S) COM FALHA"; fi
exit $([ "$falhas" -eq 0 ] && echo 0 || echo 1)
