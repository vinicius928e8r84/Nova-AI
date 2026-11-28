#!/bin/bash
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
FONTES="${NOVALANGUAGE_FONTES:-$AQUI/../novalanguage}"
T="$(mktemp -d "${TMPDIR:-/tmp}/novalanguage-caracterizacao.XXXXXX")"
RELATORIO="$T/relatorio.txt"
PREFIXO=com.aquiles.novalanguage.carac
GLOBAL=$PREFIXO.global
APP=$PREFIXO.app
DOMINIOS="$GLOBAL $APP $PREFIXO.a $PREFIXO.b $PREFIXO.c $PREFIXO.d $PREFIXO.e $PREFIXO.f"

limpar_dominios() {
    for d in $DOMINIOS; do
        defaults delete "$d" >/dev/null 2>&1
        rm -f "$HOME/Library/Preferences/$d.plist"
    done
}
limpar() {
    limpar_dominios
    rm -rf "$T"
}
trap limpar EXIT

normalizar() {
    python3 -c 'import json, sys
for linha in sys.stdin:
    linha = linha.rstrip("\n")
    try:
        print(json.dumps(json.loads(linha), sort_keys=True, ensure_ascii=False))
    except ValueError:
        print(linha)'
}

cenas_diferentes() {
    python3 - "$1" "$2" <<'PYTHON'
import sys
def cenas(caminho):
    resultado = {}
    nome = None
    for linha in open(caminho, encoding="utf-8"):
        if linha.startswith("== "):
            nome = linha[3:].strip()
            resultado[nome] = ""
        elif nome is not None:
            resultado[nome] += linha
    return resultado
esperado, obtido = cenas(sys.argv[1]), cenas(sys.argv[2])
for nome in sorted(set(esperado) | set(obtido)):
    if esperado.get(nome) != obtido.get(nome):
        print("cena que difere: " + nome)
PYTHON
}

plist() {
    python3 - "$1" "$2" <<'PYTHON'
import json, plistlib, sys
with open(sys.argv[1], "wb") as arquivo:
    plistlib.dump(json.loads(sys.argv[2]), arquivo, fmt=plistlib.FMT_BINARY)
PYTHON
}

montar_preferencias() {
    local raiz=$1
    mkdir -p "$raiz/x/Preferences" "$raiz/y/prefs" "$raiz/z" "$raiz/c/AAAA/Library/Preferences" "$raiz/c/$PREFIXO.d/Library/Preferences" "$raiz/c/CCCC/Library/Preferences" "$raiz/c/DDDD/Library/Preferences" "$raiz/c/EEEE"
    plist "$raiz/x/Preferences/$PREFIXO.a.plist" '{"AppleLanguages": ["pt-BR"]}'
    plist "$raiz/x/Preferences/$PREFIXO.b.plist" '{"AppleLanguages": ["es-ES"]}'
    plist "$raiz/x/Preferences/sem.plist" '{"Outra": 1}'
    plist "$raiz/x/Preferences/.escondido.plist" '{"AppleLanguages": ["fr-FR"]}'
    echo texto > "$raiz/x/Preferences/nota.txt"
    plist "$raiz/y/prefs/$PREFIXO.e.plist" '{"AppleLanguages": ["de-DE"]}'
    plist "$raiz/z/$PREFIXO.f.plist" '{"AppleLanguages": "pt"}'
    plist "$raiz/c/AAAA/.com.apple.mobile_container_manager.metadata.plist" "{\"MCMMetadataIdentifier\": \"$PREFIXO.c\"}"
    plist "$raiz/c/AAAA/Library/Preferences/qualquer.plist" '{"AppleLanguages": ["it-IT"]}'
    plist "$raiz/c/$PREFIXO.d/Library/Preferences/p.plist" '{"AppleLanguages": ["ja-JP"]}'
    plist "$raiz/c/CCCC/.com.apple.mobile_container_manager.metadata.plist" '{"MCMMetadataIdentifier": "com.exemplo.semidioma"}'
    plist "$raiz/c/CCCC/Library/Preferences/p.plist" '{"Outra": 1}'
    plist "$raiz/c/DDDD/.com.apple.mobile_container_manager.metadata.plist" '{"MCMMetadataIdentifier": ""}'
    plist "$raiz/c/DDDD/Library/Preferences/p.plist" '{"AppleLanguages": ["ko-KR"]}'
}

nl() {
    env NOVALANGUAGE_GLOBAL_DOMAIN="$GLOBAL" NOVALANGUAGE_PREFS_DIRS="$PREFS" "$T/novalanguage" "$@"
}

cena() {
    local nome=$1
    shift
    local saida codigo
    saida=$("$@" 2>&1)
    codigo=$?
    {
        echo "== $nome"
        echo "saiu com $codigo"
        printf '%s\n' "$saida" | normalizar
    } >> "$RELATORIO"
}

if ! clang -fobjc-arc -Wall -framework Foundation -o "$T/novalanguage" "$FONTES"/*.m 2> "$T/compilacao.txt"; then
    cat "$T/compilacao.txt"
    echo "FALHA: não compilou"
    exit 1
fi

limpar_dominios
montar_preferencias "$T/fake"
PREFS="$T/fake/x/Preferences:$T/fake/y/prefs:$T/fake/z:$T/fake/c:$T/fake/inexistente"
LONGO=$(printf 'a%.0s' $(seq 1 121))
MUITO_LONGO=$(printf 'a%.0s' $(seq 1 122))
TAG_LONGA=$(printf 'a%.0s' $(seq 1 36))
: > "$RELATORIO"

cena sem-argumentos nl
cena comando-desconhecido nl foo
cena comando-em-maiuscula nl READ --domain $APP
cena opcao-desconhecida nl read --xyz
cena dominio-sem-valor nl read --domain
cena dominio-curto-sem-valor nl read -d
cena locale-sem-valor nl read --locale
cena locale-curto-sem-valor nl read -l
cena formato-sem-valor nl read --format
cena formato-curto-sem-valor nl read -f
cena formato-invalido nl read -f xml
cena erro-depois-do-formato-lines nl read -f lines --xyz
cena erro-depois-do-formato-json nl read -f json --xyz
cena formato-text nl read -f text --domain $APP
cena formato-em-maiuscula nl read -f LINES --domain $APP
cena formato-lines-e-depois-json nl read -f lines -f json --domain $APP
cena formato-json nl read --format json --domain $APP
cena dominio-com-barras nl read --domain ../../etc/passwd
cena dominio-de-dois-caracteres nl read -d ab
cena dominio-com-hifen-no-inicio nl read -d -abc
cena dominio-de-121-caracteres nl read -d "$LONGO"
cena dominio-de-122-caracteres nl read -d "$MUITO_LONGO"
cena dominio-vazio-vira-global nl read --domain ""
cena comando-desconhecido-com-dominio-invalido nl foo --domain ..
cena scan-com-dominio-invalido nl scan --domain ..
cena read-global nl read
cena read-global-em-lines nl read -f lines
cena read-system nl read -d system
cena read-aparelho nl read -d aparelho
cena read-app-vazio nl read -d $APP
cena read-app-vazio-em-lines nl read -d $APP -f lines
cena write-sem-idioma nl write -d $APP
cena write-idioma-com-espaco nl write "pt BR" -d $APP
cena write-idioma-de-uma-letra nl write p -d $APP
cena write-idioma-de-36-letras nl write "$TAG_LONGA" -d $APP
cena write-idioma-com-simbolo nl write pt_BR -d $APP
cena write-locale-invalido nl write pt-BR --locale "pt BR" -d $APP
cena write-locale-de-uma-letra nl write pt-BR --locale p -d $APP
cena write-app nl write pt-BR -d $APP
cena write-app-em-lines nl write pt-BR -d $APP -f lines
cena read-app-depois-do-write nl read -d $APP
cena write-com-locale nl write en-US --locale en_US -d $APP
cena write-com-locale-automatico nl write pt-BR --locale auto -d $APP
cena write-com-locale-automatico-em-lines nl write pt-BR -l auto -d $APP -f lines
cena write-com-locale-automatico-de-tres-partes nl write zh-Hans-CN --locale auto -d $APP
cena write-com-locale-automatico-sem-regiao nl write pt --locale auto -d $APP
cena write-com-locale-menos nl write fr-FR --locale - -d $APP
cena write-com-argumento-sobrando nl write es-ES sobrando -d $APP
cena write-com-opcao-antes-do-idioma nl write -d $APP -l es_ES es-ES
cena write-global nl write pt-BR
cena read-global-depois-do-write nl read
cena clear-sem-locale nl clear -d $APP
cena clear-app-ja-limpo-em-lines nl clear -d $APP -f lines
cena write-para-limpar-o-locale nl write pt-BR --locale pt_BR -d $APP
cena clear-com-locale-menos nl clear --locale - -d $APP
cena write-para-restaurar-o-locale nl write pt-BR --locale pt_BR -d $APP
cena clear-com-locale-novo nl clear --locale en_US -d $APP
cena clear-com-locale-invalido nl clear --locale "pt BR" -d $APP
cena read-depois-do-clear-com-locale-invalido nl read -d $APP
cena clear-global nl clear
cena clear-global-com-locale-menos nl clear -l -
cena scan-sem-pasta-configurada env -u NOVALANGUAGE_PREFS_DIRS NOVALANGUAGE_GLOBAL_DOMAIN="$GLOBAL" "$T/novalanguage" scan
cena scan-com-pasta-vazia-na-variavel env NOVALANGUAGE_PREFS_DIRS= NOVALANGUAGE_GLOBAL_DOMAIN="$GLOBAL" "$T/novalanguage" scan
cena scan nl scan
cena scan-em-lines nl scan -f lines
cena scan-de-um-comando-em-maiuscula nl SCAN

rm -rf "$T/fake/c/DDDD"
for dominio in a b c d e f; do
    nl write pt-BR -d $PREFIXO.$dominio > /dev/null
done
nl write es-ES -d $PREFIXO.b > /dev/null
cena scan-depois-de-gravar-nos-apps nl scan
cena write-global-limpando-os-apps nl write en-US --clear-apps --locale auto
cena read-do-app-limpo nl read -d $PREFIXO.a
cena read-do-app-limpo-na-pasta-de-container nl read -d $PREFIXO.c
for dominio in a b c d e f; do
    nl write pt-BR -d $PREFIXO.$dominio > /dev/null
done
cena write-global-sem-limpar-os-apps nl write en-US --no-clear-apps
cena read-do-app-mantido nl read -d $PREFIXO.a
cena write-global-com-as-duas-opcoes nl write en-US --clear-apps --no-clear-apps
cena read-do-app-mantido-com-as-duas-opcoes nl read -d $PREFIXO.b
cena write-global-limpando-os-apps-em-lines nl write pt-BR --clear-apps -f lines
cena write-de-app-com-clear-apps nl write en-US --clear-apps -d $PREFIXO.a
cena write-global-sem-nenhuma-opcao-de-apps nl write pt-BR
cena clear-global-no-fim nl clear

if [ "${1:-}" = "--gravar" ]; then
    cp "$RELATORIO" "$AQUI/caracterizacao.esperado.txt"
    echo "gravado: $AQUI/caracterizacao.esperado.txt"
    exit 0
fi

if diff "$AQUI/caracterizacao.esperado.txt" "$RELATORIO"; then
    echo "NOVALANGUAGE: A CARACTERIZAÇÃO BATE COM O GRAVADO ($(grep -c '^== ' "$RELATORIO") cenas)"
else
    echo "NOVALANGUAGE: A CARACTERIZAÇÃO DIFERE DO GRAVADO"
    cenas_diferentes "$AQUI/caracterizacao.esperado.txt" "$RELATORIO"
    exit 1
fi
