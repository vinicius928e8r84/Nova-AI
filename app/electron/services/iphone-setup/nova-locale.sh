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
HELPER_VERSION=4

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
KILLALL=${KILLALL:-/var/jb/usr/bin/killall}
SBRELOAD=${SBRELOAD:-/var/jb/usr/bin/sbreload}

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
        # Link simbólico fica de fora: `: >` seguiria o link e zeraria o arquivo de outro dono.
        [ -f "$f" ] && [ ! -L "$f" ] || continue
        # 2>/dev/null ANTES do <: se o redirecionamento falhar, a mensagem também some.
        size=$(wc -c 2>/dev/null < "$f")
        size=${size//[!0-9]/}
        if [ "${size:-0}" -gt "$MAXLOG" ]; then
            : > "$f"
        fi
    done
}

# Logs pequenos primeiro: uma falha em laço não pode crescer nem antes da checagem abaixo.
trim_logs

# Sem estes comandos o laço não atende nada. Não escreva "pronto v<n>" nesse caso: o
# Conectar e o app leriam um serviço saudável que não existe. Avise no status, registre
# uma linha e saia com 78; o launchd (KeepAlive) só religa depois de 10 s.
missing=""
for c in sleep sed head grep cp mv ln chown chmod rm; do
    command -v "$c" >/dev/null 2>&1 || missing="$missing $c"
done
if [ -n "$missing" ]; then
    printf '{"ok":false,"message":"helper sem comandos:%s"}\n' "$missing" > "$STATUS"
    echo "nova-locale v$HELPER_VERSION: faltam comandos:$missing (PATH=$PATH)" >&2
    exit 78
fi

# ─────────────────────── idioma: subcomandos de linha ───────────────────────
# Nada aqui usa root: o store de preferências aceita escrita como `mobile` (foi
# medido pelo time), e o respring é `kill -9` no SpringBoard, que roda como
# mobile. O binário novalanguage fala com o cfprefsd; o .plist NUNCA é editado
# à mão, porque a autoridade é o cache do cfprefsd e a edição se perde.
NOVALANGUAGE=${NOVALANGUAGE:-/var/jb/usr/bin/novalanguage}
LANGBACKUP_DIR=${LANGBACKUP_DIR:-/var/mobile/Library/Preferences}

usage_language() {
    cat >&2 <<'USO'
uso:
  nova-locale language get    [--domain global|<bundle-id>]
  nova-locale language apps                      (quais apps têm idioma próprio)
  nova-locale language set    <tag> [--domain global|<bundle-id>] [--locale <xx_YY>|auto|keep]
                              [--no-clear-apps] [--respring]
  nova-locale language revert [--domain global|<bundle-id>] [--respring]
  nova-locale respring

No domínio global (o padrão) ele é "aparelho inteiro": grava o idioma no store,
deriva o AppleLocale do próprio código (pt-BR -> pt_BR) e limpa o idioma próprio
dos apps que tinham um, senão esses apps continuariam no idioma deles.
todas aceitam --format json (padrão) ou --format lines
USO
}

# campo <texto> <chave>  → valor daquela chave no formato lines
campo() {
    printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -1
}

backup_file() {
    local d
    d=$(printf '%s' "$1" | sed 's/[^A-Za-z0-9._-]/_/g')
    printf '%s/com.aquiles.novalocale.idioma.%s.orig' "$LANGBACKUP_DIR" "$d"
}

cmd_language() {
    local sub=${1:-}
    [ $# -gt 0 ] && shift
    local domain=global tag="" locale="" quer_respring=0 out before
    local no_clear=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --domain|-d) domain=${2:-}; shift 2 ;;
            --locale|-l) locale=${2:-}; shift 2 ;;
            --respring)  quer_respring=1; shift ;;
            --no-clear-apps) no_clear=1; shift ;;
            --clear-apps) no_clear=0; shift ;;
            --format|-f) local fmt=${2:-lines}; shift 2
                         [ "$fmt" = json ] && FMT=json || FMT=lines ;;
            -*) echo "error=opção desconhecida: $1"; exit 2 ;;
            *)  tag=$1; shift ;;
        esac
    done
    [ "$domain" = "system" ] || [ "$domain" = "aparelho" ] && domain=global
    [ -x "$NOVALANGUAGE" ] || {
        echo "error=novalanguage não instalado em $NOVALANGUAGE (pacote com.aquiles.novalanguage)"
        exit 3
    }

    case "$sub" in
        get)
            out=$("$NOVALANGUAGE" read --domain "$domain" --format lines)
            echo "$out"
            if [ "$domain" = "global" ]; then
                local napps
                napps=$(campo "$("$NOVALANGUAGE" scan --format lines)" count)
                # Um app com idioma próprio IGNORA o global: sem isto, "aparelho
                # inteiro" não vale para todos os apps.
                echo "apps_com_idioma_proprio=${napps:-0}"
            fi
            ;;
        apps)
            out=$("$NOVALANGUAGE" scan --format lines)
            echo "$out"
            ;;
        set)
            [ -n "$tag" ] || { echo "error=falta o idioma (ex.: pt-BR)"; usage_language; exit 2; }
            # Guarda uma CÓPIA do que estava valendo antes do primeiro set deste
            # domínio, para `revert` ter para onde voltar. Nunca sobrescreve.
            before=$("$NOVALANGUAGE" read --domain "$domain" --format lines)
            local bf orig_lang orig_loc
            bf=$(backup_file "$domain")
            orig_lang=$(campo "$before" language)
            orig_loc=$(campo "$before" locale)
            if [ ! -f "$bf" ]; then
                {
                    printf 'lang=%s\n' "${orig_lang:-none}"
                    printf 'locale=%s\n' "${orig_loc:-none}"
                    printf 'at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
                } > "$bf" 2>/dev/null && chmod 600 "$bf" 2>/dev/null \
                    || echo "warn=não consegui gravar o backup em $bf (revert não vai ter para onde voltar)"
            fi
            # Domínio global = aparelho inteiro: deriva o AppleLocale do idioma
            # (senão fica texto em pt com data/número em padrão americano) e, por
            # padrão, limpa o idioma próprio dos apps.
            local locarg="" extra=""
            if [ -n "$locale" ]; then
                locarg=$locale
            elif [ "$domain" = "global" ]; then
                locarg=auto
            fi
            [ "$locale" = "keep" ] && locarg=""
            if [ "$domain" = "global" ] && [ "$no_clear" -eq 0 ]; then
                extra="--clear-apps"
            fi
            out=$("$NOVALANGUAGE" write "$tag" --domain "$domain" ${locarg:+--locale "$locarg"} $extra --format lines)
            local rc=$?
            echo "$out"
            [ "$domain" = "global" ] && \
                echo "warn=idioma global muda o Accept-Language que os sites recebem (com IP dos EUA fica incoerente)"
            local limpos
            limpos=$(campo "$out" clearedApps)
            if [ -n "$limpos" ]; then
                printf 'apps=%s\n' "$limpos" >> "$bf" 2>/dev/null
                echo "apps_limpos=$(campo "$out" clearedCount)"
                echo "warn=$(( $(campo "$out" clearedCount) )) app(s) tinham idioma próprio e foram ajustados para seguir o aparelho inteiro"
            fi
            [ "$domain" = "global" ] && echo "escopo=aparelho" || echo "escopo=app"
            local dml
            dml=$(campo "$out" diskMatches)
            [ "$domain" = "global" ] && [ "$dml" = "no" ] && \
                echo "warn=o arquivo em disco ainda está diferente do store: um desligamento limpo volta ao idioma do disco"
            local conf
            conf=$(campo "$out" confirmed)
            if [ "$conf" != "yes" ]; then
                echo "error=o aparelho não confirmou a escrita no store"
                exit 4
            fi
            if [ "$quer_respring" -eq 1 ]; then
                respring
                echo "respring=ok"
                echo "warn=respring derruba o CAM LIVE; reconecte a câmera depois"
            else
                echo "warn=a interface só muda com respring (o CAM LIVE cai); rode: nova-locale respring"
            fi
            [ "$rc" -eq 0 ] || exit 4
            ;;
        revert)
            local bf bl blo lo
            bf=$(backup_file "$domain")
            if [ ! -f "$bf" ]; then
                echo "error=sem backup de idioma para $domain (nada foi aplicado por este helper)"
                exit 5
            fi
            bl=$(sed -n 's/^lang=//p' "$bf" | head -1)
            blo=$(sed -n 's/^locale=//p' "$bf" | head -1)
            lo=$blo
            [ "${blo:-none}" = "none" ] && lo="-"
            if [ "${bl:-none}" = "none" ]; then
                out=$("$NOVALANGUAGE" clear --domain "$domain" --locale "$lo" --format lines)
            else
                out=$("$NOVALANGUAGE" write "$bl" --domain "$domain" --locale "$lo" --format lines)
            fi
            echo "$out"
            echo "revertido_de_backup=$bf"
            # Devolve o idioma próprio de cada app que este helper limpou.
            local apps_line par d l n=0
            apps_line=$(sed -n 's/^apps=//p' "$bf" | head -1)
            if [ -n "$apps_line" ]; then
                for par in $(printf '%s' "$apps_line" | tr ',' ' '); do
                    d=${par%%:*}
                    l=${par#*:}
                    [ -n "$d" ] && [ -n "$l" ] && [ "$d" != "$par" ] || continue
                    "$NOVALANGUAGE" write "$l" --domain "$d" --format lines >/dev/null 2>&1 && n=$((n + 1))
                done
                echo "apps_restaurados=$n"
            fi
            if [ "$quer_respring" -eq 1 ]; then
                respring
                echo "respring=ok"
                echo "warn=respring derruba o CAM LIVE; reconecte a câmera depois"
            else
                echo "warn=a interface só muda com respring (o CAM LIVE cai); rode: nova-locale respring"
            fi
            ;;
        *)
            usage_language
            exit 2
            ;;
    esac
}

cmd_respring() {
    respring
    echo "respring=ok"
    echo "warn=respring derruba o CAM LIVE; reconecte a câmera depois"
}

# Subcomando tem prioridade sobre o daemon: quem chama `nova-locale language set`
# não quer um laço rodando. Sem argumento, o comportamento continua o de antes.
if [ $# -gt 0 ]; then
    case "$1" in
        language) shift; cmd_language "$@" ;;
        respring) cmd_respring ;;
        *) echo "error=subcomando desconhecido: $1"; usage_language; exit 2 ;;
    esac
    exit $?
fi

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
                        # Só dentro de /var/tmp, sem ".." e sem link simbólico: o helper é root e o
                        # arquivo de comando é gravável por qualquer processo.
                        case "$plist" in
                            *..*) ok=0; msg="caminho de plist invalido" ;;
                            /var/tmp/*) ;;
                            *) ok=0; msg="caminho de plist invalido" ;;
                        esac
                        if [ "$ok" -eq 1 ] && [ -L "$plist" ]; then ok=0; msg="caminho de plist invalido"; fi
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
