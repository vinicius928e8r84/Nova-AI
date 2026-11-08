#!/bin/bash
# Teste do helper v3 (nova-locale.sh) no Mac, sem aparelho.
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
# estado: $STUB_STATE/<domínio>.lang e .locale
set -u
cmd=$1; shift
domain=global; locale=""; tag=""
while [ $# -gt 0 ]; do
    case "$1" in
        --domain|-d) domain=$2; shift 2 ;;
        --locale|-l) locale=$2; shift 2 ;;
        --format|-f) shift 2 ;;
        *) tag=$1; shift ;;
    esac
done
d="$STUB_STATE/$domain"
mkdir -p "$STUB_STATE"
cur=""; curloc=""
[ -f "$d.lang" ] && cur=$(cat "$d.lang")
[ -f "$d.locale" ] && curloc=$(cat "$d.locale")
[ "$cmd" = "read" ] || [ "$cmd" = "write" ] || [ "$cmd" = "clear" ] || { echo "error=comando"; exit 64; }
case "$cmd" in
    write)
        case "$tag" in
            *" "*) echo "error=idioma inválido: $tag"; exit 64 ;;
        esac
        printf '%s' "$tag" > "$d.lang"
        [ -n "$locale" ] && [ "$locale" != "-" ] && printf '%s' "$locale" > "$d.locale"
        ;;
    clear)
        rm -f "$d.lang"
        if [ "$locale" = "-" ]; then rm -f "$d.locale"
        elif [ -n "$locale" ]; then printf '%s' "$locale" > "$d.locale"; fi
        ;;
esac
cur=""; curloc=""
[ -f "$d.lang" ] && cur=$(cat "$d.lang")
[ -f "$d.locale" ] && curloc=$(cat "$d.locale")
out_override=no; [ -n "$cur" ] && out_override=yes
conf=""
[ "$cmd" = "write" ] && { conf=no; [ "$cur" = "$tag" ] && conf=yes; }
disk=no
case "$domain" in global) disk=${STUB_DISK_MATCH:-no} ;; esac
[ "$cmd" = "write" ] && echo "confirmed=$conf"
echo "domain=$domain"
echo "language=$cur"
echo "locale=$curloc"
echo "ok=yes"
echo "override=$out_override"
[ "$cmd" = "write" ] && echo "synced=yes" && echo "requested=$tag"
[ "$domain" = "global" ] && echo "diskMatches=$disk"
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
export STUB_STATE="$T/state" STUB_KILLLOG="$T/kill.log"
: > "$STUB_KILLLOG"

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

echo
if [ "$fails" -eq 0 ]; then echo "HELPER v3: TODOS OS TESTES PASSARAM"; else echo "$fails FALHA(S) NO HELPER"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
