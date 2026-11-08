#!/bin/bash
# Teste do binário novalanguage no Mac (o mesmo main.m que vai no .deb).
# Usa um domínio de teste descartável (com.aquiles.novalanguage.teste) para não
# encostar no domínio global nem nas preferências reais. Ocorre só no Mac.
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
FONTE="$AQUI/../novalanguage/main.m"
BIN="${TMPDIR:-/tmp}/novalanguage-mac"
D=com.aquiles.novalanguage.teste
PLIST="$HOME/Library/Preferences/$D.plist"

fails=0
ok() { if eval "$2"; then :; else fails=$((fails+1)); echo "FALHA [$1]"; fi; }

clang -fobjc-arc -framework Foundation -Wall -o "$BIN" "$FONTE" 2>/tmp/nl-build.log || {
    echo "FALHA: não compilou"; cat /tmp/nl-build.log; exit 1; }
echo "compilou: $BIN"

limpar() { rm -f "$PLIST"; }
trap limpar EXIT
limpar

saida=$("$BIN" read --domain "$D" --format lines)
ok "read-vazio" 'printf "%s" "$saida" | grep -q "^override=no$"'

saida=$("$BIN" write pt-BR --domain "$D" --format lines); rc=$?
ok "write-confirma" 'printf "%s" "$saida" | grep -q "^confirmed=yes$" && [ $rc -eq 0 ]'
ok "write-language" 'printf "%s" "$saida" | grep -q "^language=pt-BR$"'

saida=$("$BIN" read --domain "$D" --format lines)
ok "read-depois" 'printf "%s" "$saida" | grep -q "^language=pt-BR$" && printf "%s" "$saida" | grep -q "^override=yes$"'

saida=$("$BIN" write en-US --locale en_US --domain "$D" --format lines)
ok "write-locale" 'printf "%s" "$saida" | grep -q "^locale=en_US$"'
ok "write-troca" 'printf "%s" "$saida" | grep -q "^language=en-US$"'

saida=$("$BIN" write "pt BR" --domain "$D" --format lines); rc=$?
ok "tag-invalido" 'printf "%s" "$saida" | grep -q "^error=" && [ $rc -ne 0 ]'

saida=$("$BIN" read --domain "../../etc/passwd" --format lines); rc=$?
ok "dominio-invalido" '[ $rc -ne 0 ]'

saida=$("$BIN" write pt-BR --domain "$D" >/dev/null; "$BIN" clear --locale - --domain "$D" --format lines)
ok "clear-idioma" 'printf "%s" "$saida" | grep -q "^override=no$"'
ok "clear-locale" 'printf "%s" "$saida" | grep -q "^locale=$"'

saida=$("$BIN" clear --locale en_US --domain "$D" --format lines)
ok "clear-restaura-locale" 'printf "%s" "$saida" | grep -q "^locale=en_US$"'

saida=$("$BIN" read --domain "$D")
ok "json-valido" 'printf "%s" "$saida" | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const j=JSON.parse(s);process.exit(j.ok===true?0:1)})"'

saida=$("$BIN" comando-que-nao-existe 2>&1); rc=$?
ok "comando-desconhecido" '[ $rc -ne 0 ]'

echo
if [ "$fails" -eq 0 ]; then echo "NOVALANGUAGE: TODOS OS TESTES PASSARAM"; else echo "$fails FALHA(S) NO NOVALANGUAGE"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
