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

PREFS_FAKE="${TMPDIR:-/tmp}/nl-prefs-fake"
limpar() {
    rm -f "$PLIST"
    # o CFPreferences cria arquivo de 42 B ao sincronizar domínio vazio; apaga os do teste
    rm -f "$HOME/Library/Preferences/com.teste.a.plist" "$HOME/Library/Preferences/com.teste.b.plist" \
          "$HOME/Library/Preferences/com.aquiles.novalanguage.teste.global.plist"
    rm -rf "$PREFS_FAKE"
}
trap limpar EXIT
limpar
# Estado limpo pelo STORE (apagar o arquivo não basta: a autoridade é o cfprefsd).
"$BIN" clear --domain "$D" >/dev/null 2>&1 || true
"$BIN" clear --domain com.teste.a >/dev/null 2>&1 || true
"$BIN" clear --domain com.teste.b >/dev/null 2>&1 || true

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

# ── aparelho inteiro: scan, limpar idioma próprio dos apps, locale derivado ──
mkdir -p "$PREFS_FAKE"
python3 - "$PREFS_FAKE" <<'FIX'
import plistlib, sys, os
d = sys.argv[1]
plistlib.dump({"AppleLanguages": ["pt-BR"]}, open(os.path.join(d, "com.teste.a.plist"), "wb"), fmt=plistlib.FMT_BINARY)
plistlib.dump({"AppleLanguages": ["es-ES"]}, open(os.path.join(d, "com.teste.b.plist"), "wb"), fmt=plistlib.FMT_BINARY)
plistlib.dump({"Outra": 1}, open(os.path.join(d, "com.teste.sem.plist"), "wb"), fmt=plistlib.FMT_BINARY)
FIX
export NOVALANGUAGE_GLOBAL_DOMAIN=com.aquiles.novalanguage.teste.global NOVALANGUAGE_PREFS_DIRS="$PREFS_FAKE"

saida=$("$BIN" scan --format lines)
ok "scan-conta" 'printf "%s" "$saida" | grep -q "^count=2$"'
ok "scan-lista" 'printf "%s" "$saida" | grep -q "com.teste.a" && printf "%s" "$saida" | grep -q "com.teste.b"'
ok "scan-ignora-sem-idioma" '! printf "%s" "$saida" | grep -q "com.teste.sem"'

# valores antes de limpar, para o 'antes' sair certo
"$BIN" write pt-BR --domain com.teste.a >/dev/null
"$BIN" write es-ES --domain com.teste.b >/dev/null

saida=$("$BIN" write en-US --clear-apps --locale auto --format lines)
ok "clear-conta" 'printf "%s" "$saida" | grep -q "^clearedCount=2$"'
ok "clear-guarda-antes" 'printf "%s" "$saida" | grep -q "com.teste.a:pt-BR"'
ok "locale-auto" 'printf "%s" "$saida" | grep -q "^locale=en_US$" && printf "%s" "$saida" | grep -q "^localeAuto=yes$"'
ok "global-confirmado" 'printf "%s" "$saida" | grep -q "^confirmed=yes$"'
ok "override-do-apps-limpo" 'saida2=$("$BIN" read --domain com.teste.a --format lines); printf "%s" "$saida2" | grep -q "^override=no$"'

# sem --clear-apps, o app continua com o idioma dele
"$BIN" write pt-BR --domain com.teste.a >/dev/null
"$BIN" write en-US --no-clear-apps >/dev/null
saida=$("$BIN" read --domain com.teste.a --format lines)
ok "no-clear-respeita" 'printf "%s" "$saida" | grep -q "^override=yes$"'

# locale auto sem região no tag não inventa locale
saida=$("$BIN" write pt --locale auto --domain "$D" --format lines)
ok "auto-sem-regiao" 'printf "%s" "$saida" | grep -q "^confirmed=yes$"'

"$BIN" clear --domain "$D" >/dev/null 2>&1 || true
"$BIN" clear --domain com.teste.a >/dev/null 2>&1 || true
"$BIN" clear --domain com.teste.b >/dev/null 2>&1 || true

echo
if [ "$fails" -eq 0 ]; then echo "NOVALANGUAGE: TODOS OS TESTES PASSARAM"; else echo "$fails FALHA(S) NO NOVALANGUAGE"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
