#!/var/jb/bin/bash
# nova-locale — aplica fuso horário e idioma pedidos pelo Nova AI.
# Roda como root (launchd). Lê /var/tmp/nova-locale.cmd e responde em
# /var/tmp/nova-locale-status.json. Nunca executa nada do arquivo de comando:
# lê apenas as chaves action, tz e plist, e valida cada uma.
# O launchd roda com PATH mínimo (só /usr/bin:/bin:/usr/sbin:/sbin). Sem isto,
# comandos como `sleep` não existem e o daemon gira em erro (idioma UNDEFINED).
export PATH=/var/jb/usr/bin:/var/jb/bin:/usr/bin:/bin:/usr/sbin:/sbin

# Versão do helper. Ao subir, o serviço grava "pronto v<versão>" no status; o
# Conectar lê isso depois de reiniciar o serviço e só então diz "atualizado".
# Sem a versão nova no status, o processo antigo ainda está rodando o texto velho
# (o bash mantém aberto o arquivo que já tinha carregado). Suba o número a cada
# mudança de comportamento deste script.
HELPER_VERSION=2

CMD=/var/tmp/nova-locale.cmd
PROC=/var/tmp/nova-locale.proc
STATUS=/var/tmp/nova-locale-status.json
LOG=/var/tmp/nova-locale.log
# stdout/stderr do serviço (StandardOutPath/StandardErrorPath do plist). O launchd
# só anexa e nunca gira esses arquivos: um erro em laço chegou a 571 MB em 19 h.
ERRLOG=/var/tmp/nova-locale.err
OUTLOG=/var/tmp/nova-locale.out
MAXLOG=1048576
STATE=/var/mobile/.nova-locale-state
PREF=/var/mobile/Library/Preferences/.GlobalPreferences.plist
ORIG=/var/mobile/nova-globalprefs-original.plist
TZLINK=/var/db/timezone/localtime
ZONES=/var/db/timezone/zoneinfo
KILLALL=/var/jb/usr/bin/killall
SBRELOAD=/var/jb/usr/bin/sbreload

status() {
    printf '{"ok":%s,"message":"%s"}\n' "$1" "$2" > "$STATUS"
    chmod 644 "$STATUS" 2>/dev/null
    printf '%s %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "$2" >> "$LOG"
}

respring() {
    [ -x "$SBRELOAD" ] && "$SBRELOAD" >/dev/null 2>&1 && return 0
    [ -x "$KILLALL" ] && "$KILLALL" -9 SpringBoard >/dev/null 2>&1
    return 0
}

# Mantém os logs pequenos: zera o que passar de 1 MB (o arquivo continua existindo
# e o launchd segue anexando nele). Roda ao subir e a cada ~10 minutos.
trim_logs() {
    local f size
    for f in "$ERRLOG" "$OUTLOG" "$LOG"; do
        [ -f "$f" ] || continue
        # 2>/dev/null ANTES do <: se o redirecionamento falhar, a mensagem também some.
        size=$(wc -c 2>/dev/null < "$f")
        size=${size//[!0-9]/}
        if [ "${size:-0}" -gt "$MAXLOG" ]; then
            : > "$f"
        fi
    done
}

# Guarda o estado original na primeira execução (fuso + prefs).
if [ ! -f "$STATE" ]; then
    orig_tz=$(readlink "$TZLINK" 2>/dev/null | sed -n 's#.*/zoneinfo/##p')
    {
        echo "tz=$orig_tz"
        echo "orig=$ORIG"
    } > "$STATE"
    chmod 600 "$STATE"
    cp -p "$PREF" "$ORIG" 2>/dev/null
fi

trim_logs
status true "pronto v$HELPER_VERSION"

ticks=0
while true; do
    if [ -f "$CMD" ]; then
        mv -f "$CMD" "$PROC" 2>/dev/null
        if [ -f "$PROC" ]; then
            action=$(sed -n 's/^action=//p' "$PROC" | head -1)
            tz=$(sed -n 's/^tz=//p' "$PROC" | head -1)
            plist=$(sed -n 's/^plist=//p' "$PROC" | head -1)
            case "$action" in
                apply)
                    ok=1
                    msg=""
                    if [ -n "$tz" ]; then
                        case "$tz" in
                            *[!A-Za-z0-9_/+-]*) ok=0; msg="fuso invalido" ;;
                            *)
                                if [ -f "$ZONES/$tz" ]; then
                                    ln -sfn "$ZONES/$tz" "$TZLINK" || { ok=0; msg="falha ao trocar fuso"; }
                                else
                                    ok=0; msg="fuso inexistente"
                                fi
                                ;;
                        esac
                    fi
                    if [ "$ok" -eq 1 ] && [ -n "$plist" ]; then
                        case "$plist" in
                            /var/tmp/*) ;;
                            *) ok=0; msg="caminho de plist invalido" ;;
                        esac
                        if [ "$ok" -eq 1 ]; then
                            if head -c 40 "$plist" 2>/dev/null | grep -q '<?xml'; then
                                # cfprefsd roda como root: mata antes de trocar para nao sobrescrever
                                [ -x "$KILLALL" ] && "$KILLALL" -9 cfprefsd >/dev/null 2>&1
                                cp "$plist" "$PREF.tmp" && chown mobile:mobile "$PREF.tmp" && chmod 600 "$PREF.tmp" \
                                    && mv -f "$PREF.tmp" "$PREF" || { ok=0; msg="falha ao gravar prefs"; }
                            else
                                ok=0; msg="plist invalido"
                            fi
                        fi
                    fi
                    if [ "$ok" -eq 1 ]; then
                        respring
                        status true "aplicado ${tz:+fuso=$tz }${plist:+idioma=ok}"
                    else
                        status false "$msg"
                    fi
                    ;;
                revert)
                    orig_tz=$(sed -n 's/^tz=//p' "$STATE" | head -1)
                    [ -n "$orig_tz" ] && [ -f "$ZONES/$orig_tz" ] && ln -sfn "$ZONES/$orig_tz" "$TZLINK"
                    if [ -f "$ORIG" ]; then
                        [ -x "$KILLALL" ] && "$KILLALL" -9 cfprefsd >/dev/null 2>&1
                        cp "$ORIG" "$PREF.tmp" && chown mobile:mobile "$PREF.tmp" && chmod 600 "$PREF.tmp" && mv -f "$PREF.tmp" "$PREF"
                    fi
                    respring
                    status true "revertido tz=${orig_tz:-?}"
                    ;;
                ping)
                    status true "pronto v$HELPER_VERSION"
                    ;;
                *)
                    status false "acao desconhecida"
                    ;;
            esac
            rm -f "$PROC"
        fi
    fi
    # Sem `sleep` o laço giraria sem pausa e encheria o log (foi o que o PATH mínimo
    # do launchd causou: ~118 linhas por segundo). Aqui o serviço encerra: o launchd só
    # reinicia depois de 10 s, então o erro vira ~1 linha a cada 10 s e o trim_logs
    # (ao subir) mantém o arquivo abaixo de 1 MB.
    sleep 1 || {
        echo "nova-locale: sleep indisponivel (PATH=$PATH); encerrando" >&2
        exit 1
    }
    ticks=$((ticks + 1))
    if [ $((ticks % 600)) -eq 0 ]; then
        trim_logs
    fi
done
