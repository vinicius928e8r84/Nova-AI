#!/bin/bash
# Teste do helper v4 (nova-locale.sh) no Mac, sem aparelho.
#
# Usa um `novalanguage` FALSO e um `killall` FALSO num diretório temporário:
# nada é escrito em preferência de sistema, nada respinga, nada toca o iPhone.
# O que fica provado aqui é o contrato do helper: argumentos, backup, avisos,
# reverting e códigos de saída.
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
HELPER="$AQUI/../../conexao-usb/nova-locale.sh"
[ -f "$HELPER" ] || { echo "helper não encontrado: $HELPER"; exit 1; }

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/prefs"
SUBIO=0

# ── novalanguage falso: guarda o estado em arquivo, imita o formato lines ──
cat > "$T/novalanguage" <<'STUB'
#!/bin/bash
# estado: $STUB_STATE/<domínio>.lang e .locale ; chamadas em $STUB_ARGS
set -u
echo "$*" >> "$STUB_ARGS"
cmd=$1; shift
domain=global; locale=""; tag=""; clear=0
while [ $# -gt 0 ]; do
    case "$1" in
        --domain|-d) domain=$2; shift 2 ;;
        --locale|-l) locale=$2; shift 2 ;;
        --format|-f) shift 2 ;;
        --clear-apps) clear=1; shift ;;
        --no-clear-apps) shift ;;
        *) tag=$1; shift ;;
    esac
done
d="$STUB_STATE/$domain"
mkdir -p "$STUB_STATE"
cur=""; curloc=""
[ -f "$d.lang" ] && cur=$(cat "$d.lang")
[ -f "$d.locale" ] && curloc=$(cat "$d.locale")

if [ "$cmd" = "scan" ]; then
    echo "apps=${STUB_APPS:-}"
    echo "count=${STUB_APPS_COUNT:-0}"
    echo "ok=yes"
    exit 0
fi

case "$cmd" in
    write)
        case "$tag" in
            *" "*) echo "error=idioma inválido: $tag"; exit 64 ;;
        esac
        printf '%s' "$tag" > "$d.lang"
        [ "$locale" = "auto" ] && locale="${tag%%-*}_${tag##*-}"
        [ -n "$locale" ] && [ "$locale" != "-" ] && [ "$locale" != "keep" ] && printf '%s' "$locale" > "$d.locale"
        ;;
    clear)
        rm -f "$d.lang"
        if [ "$locale" = "-" ]; then rm -f "$d.locale"
        elif [ -n "$locale" ]; then printf '%s' "$locale" > "$d.locale"; fi
        ;;
    read) ;;
    *) echo "error=comando"; exit 64 ;;
esac

cur=""; curloc=""
[ -f "$d.lang" ] && cur=$(cat "$d.lang")
[ -f "$d.locale" ] && curloc=$(cat "$d.locale")
out_override=no; [ -n "$cur" ] && out_override=yes
conf=""
[ "$cmd" = "write" ] && { conf=no; [ "$cur" = "$tag" ] && conf=yes; }
if [ "$cmd" = "write" ] && [ "$clear" = "1" ] && [ -n "${STUB_CLEARED:-}" ]; then
    echo "clearedApps=$STUB_CLEARED"
    echo "clearedCount=${STUB_CLEARED_COUNT:-1}"
fi
[ "$cmd" = "write" ] && echo "confirmed=$conf"
echo "domain=$domain"
echo "language=$cur"
echo "locale=$curloc"
echo "ok=yes"
echo "override=$out_override"
[ "$cmd" = "write" ] && echo "synced=yes" && echo "requested=$tag"
[ "$domain" = "global" ] && echo "diskMatches=${STUB_DISK_MATCH:-no}"
exit 0
STUB
chmod +x "$T/novalanguage"

# ── killall falso: registra e não faz nada ──
cat > "$T/killall" <<'STUB'
#!/bin/bash
echo "killall $*" >> "$STUB_KILLLOG"
exit 0
STUB
chmod +x "$T/killall"
export STUB_STATE="$T/state" STUB_KILLLOG="$T/kill.log" STUB_ARGS="$T/args.log" STUB_APPS="com.a,com.b" STUB_APPS_COUNT=2 STUB_CLEARED="com.a:es-ES" STUB_CLEARED_COUNT=1
: > "$STUB_KILLLOG"
: > "$STUB_ARGS"

fails=0
roda() {   # roda <nome> <esperado-no-stdout|-> <args...>
    local nome=$1 esperado=$2; shift 2
    saida=$(NOVALANGUAGE="$T/novalanguage" KILLALL="$T/killall" SBRELOAD="$T/nao-existe" \
            LANGBACKUP_DIR="$T/prefs" bash "$HELPER" "$@" 2>&1)
    rc=$?
    if [ "$esperado" != "-" ] && ! printf '%s' "$saida" | grep -qF "$esperado"; then
        fails=$((fails+1))
        echo "FALHA [$nome]: esperava '$esperado'"
        printf '%s\n' "$saida" | sed 's/^/    /'
    fi
    printf '%s' "$saida"
}
espera_falta() {  # espera_falta <nome> <texto-que-não-pode-aparecer>
    if printf '%s' "$saida" | grep -qF "$2"; then
        fails=$((fails+1)); echo "FALHA [$1]: não devia conter '$2'"
    fi
}

echo "1) language get sem nada aplicado"
saida=$(roda get "language=" language get)
espera_falta get "override=yes"

echo "2) language set pt-BR (global) — tem de avisar Accept-Language, disco e respring"
saida=$(roda set "language=pt-BR" language set pt-BR)
printf '%s' "$saida" | grep -qF "warn=idioma global muda o Accept-Language" || { fails=$((fails+1)); echo "FALHA [set]: faltou aviso do Accept-Language"; }
printf '%s' "$saida" | grep -qF "warn=a interface só muda com respring" || { fails=$((fails+1)); echo "FALHA [set]: faltou aviso do respring"; }
printf '%s' "$saida" | grep -qF "warn=o arquivo em disco ainda está diferente" || { fails=$((fails+1)); echo "FALHA [set]: faltou aviso do disco"; }
[ -f "$T/prefs/com.aquiles.novalocale.idioma.global.orig" ] || { fails=$((fails+1)); echo "FALHA [set]: não criou backup"; }
[ -s "$T/kill.log" ] && { fails=$((fails+1)); echo "FALHA [set]: respingou sem --respring"; }

echo "3) language get confirma pt-BR"
saida=$(roda get2 "language=pt-BR" language get)

echo "4) set com --respring chama o respring e avisa do CAM LIVE"
saida=$(roda set3 "respring=ok" language set pt-BR --respring)
grep -q "killall -9 SpringBoard" "$T/kill.log" || { fails=$((fails+1)); echo "FALHA [set3]: não chamou o respring"; }
printf '%s' "$saida" | grep -qF "warn=respring derruba o CAM LIVE" || { fails=$((fails+1)); echo "FALHA [set3]: faltou aviso do CAM LIVE"; }

echo "5) idioma por app (bundle) não avisa Accept-Language"
saida=$(roda setapp "language=en-US" language set en-US --domain com.apple.Preferences)
espera_falta setapp "warn=idioma global muda"

echo "6) revert do app volta a 'sem override'"
saida=$(roda revapp "revertido_de_backup=" language revert --domain com.apple.Preferences)
printf '%s' "$saida" | grep -qF "override=no" || { fails=$((fails+1)); echo "FALHA [revapp]: devia voltar a sem override"; }

echo "7) revert do global volta para o valor original (nenhum) e limpa"
saida=$(roda revglobal "revertido_de_backup=" language revert)
printf '%s' "$saida" | grep -qF "override=no" || { fails=$((fails+1)); echo "FALHA [revglobal]: devia ficar sem override"; }

echo "8) revert sem backup é erro claro"
rm -f "$T/prefs"/*
saida=$(roda revnada "error=sem backup de idioma" language revert --domain com.apple.Safari)

echo "9) tag inválido não grava"
saida=$(roda tagruim "error=idioma inválido" language set "pt BR")
[ -f "$T/state/global.lang" ] && { fails=$((fails+1)); echo "FALHA [tagruim]: gravou mesmo com tag inválido"; }

echo "10) set sem tag dá erro de uso"
saida=$(roda semtag "error=falta o idioma" language set)

echo "11) subcomando desconhecido"
saida=$(roda subruim "error=subcomando desconhecido" idioma)

echo "12) sem o binário novalanguage o erro é explícito"
saida=$(NOVALANGUAGE="$T/nao-existe" LANGBACKUP_DIR="$T/prefs" bash "$HELPER" language get 2>&1)
printf '%s' "$saida" | grep -qF "error=novalanguage não instalado" || { fails=$((fails+1)); echo "FALHA: sem aviso do binário ausente"; }

echo "13) sem argumentos continua sendo o daemon (não imprime subcomando)"
timeout=1; ( NOVALANGUAGE="$T/novalanguage" bash -c "timeout 2 bash '$HELPER'" >"$T/daemon.out" 2>&1 ); true
grep -q "error=subcomando desconhecido" "$T/daemon.out" && { fails=$((fails+1)); echo "FALHA: sem argumento não pode cair no uso de subcomando"; }

echo "14) respring sozinho avisa do CAM LIVE"
saida=$(NOVALANGUAGE="$T/novalanguage" KILLALL="$T/killall" SBRELOAD="$T/nao-existe" bash "$HELPER" respring 2>&1)
printf '%s' "$saida" | grep -qF "respring=ok" || { fails=$((fails+1)); echo "FALHA: respring não respondeu ok"; }
printf '%s' "$saida" | grep -qF "warn=respring derruba o CAM LIVE" || { fails=$((fails+1)); echo "FALHA: respring sem aviso do CAM LIVE"; }

echo "15) language apps lista quem tem idioma próprio"
saida=$(roda apps "count=2" language apps --domain global)
printf '%s' "$saida" | grep -qF "apps=com.a,com.b" || { fails=$((fails+1)); echo "FALHA [apps]: não listou os apps"; }

echo "16) get informa quantos apps ignoram o global"
saida=$(roda getapps "apps_com_idioma_proprio=2" language get)
printf '%s' "$saida" | grep -qF "language=" || { fails=$((fails+1)); echo "FALHA [getapps]: não leu o idioma"; }

echo "17) set global limpa apps e deriva o locale (aparelho inteiro)"
: > "$STUB_ARGS"
saida=$(NOVALANGUAGE="$T/novalanguage" KILLALL="$T/killall" SBRELOAD="$T/nao-existe" LANGBACKUP_DIR="$T/prefs" bash "$HELPER" language set pt-BR 2>&1)
printf '%s' "$saida" | grep -qF "escopo=aparelho" || { fails=$((fails+1)); echo "FALHA [17]: faltou escopo=aparelho"; }
printf '%s' "$saida" | grep -qF "apps_limpos=1" || { fails=$((fails+1)); echo "FALHA [17]: não reportou apps limpos"; }
printf '%s' "$saida" | grep -qF "app(s) tinham idioma próprio" || { fails=$((fails+1)); echo "FALHA [17]: faltou aviso dos apps"; }
grep -q -- "--clear-apps" "$STUB_ARGS" || { fails=$((fails+1)); echo "FALHA [17]: não pediu --clear-apps"; }
grep -q -- "--locale auto" "$STUB_ARGS" || { fails=$((fails+1)); echo "FALHA [17]: não derivou o locale"; }
grep -q "^apps=com.a:es-ES$" "$T/prefs/com.aquiles.novalocale.idioma.global.orig" 2>/dev/null     || { fails=$((fails+1)); echo "FALHA [17]: não guardou os apps no backup"; }

echo "18) --no-clear-apps respeita a escolha"
: > "$STUB_ARGS"
saida=$(NOVALANGUAGE="$T/novalanguage" KILLALL="$T/killall" SBRELOAD="$T/nao-existe" LANGBACKUP_DIR="$T/prefs2" bash "$HELPER" language set pt-BR --no-clear-apps 2>&1)
if grep -q -- "--clear-apps" "$STUB_ARGS"; then fails=$((fails+1)); echo "FALHA [18]: pediu --clear-apps mesmo com --no-clear-apps"; fi

echo "19) revert devolve cada app ao idioma que tinha"
: > "$STUB_ARGS"
saida=$(NOVALANGUAGE="$T/novalanguage" KILLALL="$T/killall" SBRELOAD="$T/nao-existe" LANGBACKUP_DIR="$T/prefs" bash "$HELPER" language revert 2>&1)
printf '%s' "$saida" | grep -qF "apps_restaurados=1" || { fails=$((fails+1)); echo "FALHA [19]: não restaurou o app"; }
grep -q "write es-ES --domain com.a" "$STUB_ARGS" || { fails=$((fails+1)); echo "FALHA [19]: não devolveu es-ES ao com.a"; }

echo "20) set por app não mexe em escopo nem em apps"
: > "$STUB_ARGS"
saida=$(NOVALANGUAGE="$T/novalanguage" KILLALL="$T/killall" SBRELOAD="$T/nao-existe" LANGBACKUP_DIR="$T/prefs" bash "$HELPER" language set en-US --domain com.apple.Preferences 2>&1)
printf '%s' "$saida" | grep -qF "escopo=app" || { fails=$((fails+1)); echo "FALHA [20]: faltou escopo=app"; }
if grep -q -- "--clear-apps" "$STUB_ARGS"; then fails=$((fails+1)); echo "FALHA [20]: limpou apps num set por app"; fi

echo
if [ "$fails" -eq 0 ]; then echo "HELPER v4: TODOS OS TESTES PASSARAM"; else echo "$fails FALHA(S) NO HELPER"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
