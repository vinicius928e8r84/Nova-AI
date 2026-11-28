#!/bin/bash
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
MODELO="${NOVAMODEL_FONTES:-$AQUI/..}"
T="$(mktemp -d "${TMPDIR:-/tmp}/novamodel-caracterizacao.XXXXXX")"
RELATORIO="$T/relatorio.txt"
trap 'rm -rf "$T"' EXIT

arquivos_do_alvo() {
    sed -n "s/^$1_FILES *= *//p" "$MODELO/Makefile"
}

preparar_fontes() {
    local destino=$1
    shift
    mkdir -p "$destino"
    cp "$MODELO"/*.h "$destino"/ 2>/dev/null
    for arquivo in "$@"; do
        sed -e "s#/var/tmp/nova-model-control.json#$T/controle.json#g" \
            -e "s#/var/jb/usr/share/novamodel/models.json#$T/models.json#g" \
            -e "s#/usr/lib/libMobileGestalt.dylib#$T/mg_falso.dylib#g" \
            -e 's/^%ctor {$/__attribute__((constructor)) static void ctor_de_teste(void) {/' \
            "$MODELO/$arquivo" > "$destino/${arquivo%.x}.m"
    done
}

compilar_tweak() {
    local saida=$1
    shift
    clang -fobjc-arc -Wno-unused-function -framework Foundation -I "$AQUI" "$@" -o "$saida" "$AQUI/ganchos_roteiro.m" "$T"/tweak/*.m
}

normalizar() {
    python3 -c 'import json, sys
for linha in sys.stdin:
    linha = linha.rstrip("\n").replace(sys.argv[1], "<tmp>")
    try:
        objeto = json.loads(linha)
    except ValueError:
        print(linha)
        continue
    if isinstance(objeto, dict) and "real" in objeto:
        real = objeto["real"]
        objeto["real"] = "<real>"
        if objeto.get("active") == real:
            objeto["active"] = "<real>"
    print(json.dumps(objeto, sort_keys=True, ensure_ascii=False))' "$T"
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

mostrar_controle() {
    if [ -e "$T/controle.json" ]; then
        echo "controle: modo $(stat -f %Lp "$T/controle.json")"
        cat "$T/controle.json"
        echo
    else
        echo "controle: ausente"
    fi
}

ferramenta() {
    "$T/ferramenta/novamodel" "$@"
}

preparar_fontes "$T/ferramenta-fontes" $(arquivos_do_alvo novamodel)
preparar_fontes "$T/tweak" $(arquivos_do_alvo NovaModel)
mkdir -p "$T/ferramenta" "$T/processo"
BANCO='{"version":1,"models":[{"productType":"iPhone14,5","name":"iPhone 13"},{"productType":"iPhone15,2","name":"iPhone 14 Pro"},{"productType":"iPhoneX,1"},{"productType":"iPhoneX,2","name":""},{"productType":"iPhoneX,3","name":5},7,{"productType":"iPhoneY,1","name":""},{"productType":"iPhoneY,1","name":"Segundo"}]}'

if ! clang -fobjc-arc -Wall -framework Foundation -o "$T/ferramenta/novamodel" "$T"/ferramenta-fontes/*.m 2> "$T/compilacao.txt" ||
   ! clang -dynamiclib -framework Foundation -o "$T/mg_falso.dylib" "$AQUI/mg_falso.m" 2>> "$T/compilacao.txt" ||
   ! compilar_tweak "$T/ganchos" 2>> "$T/compilacao.txt" ||
   ! compilar_tweak "$T/ganchos-sem-modelname" -DUIDEVICE_SEM_MODELNAME 2>> "$T/compilacao.txt" ||
   ! compilar_tweak "$T/ganchos-sem-uidevice" -DSEM_UIDEVICE 2>> "$T/compilacao.txt"; then
    cat "$T/compilacao.txt"
    echo "FALHA: não compilou"
    exit 1
fi
cp "$T/ganchos" "$T/processo/novamodel"
: > "$RELATORIO"

cena sem-argumentos ferramenta
cena comando-desconhecido ferramenta foo
cena set-sem-tipo ferramenta set
cena status-sem-controle ferramenta status
cena set-sem-banco ferramenta set iPhone14,5
printf '%s' "$BANCO" > "$T/models.json"
cena set-tipo-inexistente ferramenta set iPhone99,9
cena set-tipo-vazio ferramenta set ""
cena set-tipo-que-nao-e-utf8 ferramenta set $'\xff'
cena set-modelo-sem-nome ferramenta set iPhoneX,1
cena set-modelo-com-nome-vazio ferramenta set iPhoneX,2
cena set-modelo-com-nome-que-nao-e-texto ferramenta set iPhoneX,3
cena set-modelo-com-nome-no-segundo-registro ferramenta set iPhoneY,1
cena clear-sem-controle ferramenta clear
cena set-com-banco-bom ferramenta set iPhone14,5
cena controle-depois-do-set mostrar_controle
cena status-habilitado ferramenta status
cena set-com-argumento-sobrando ferramenta set iPhone15,2 sobrando
cena controle-depois-do-segundo-set mostrar_controle
cena clear-com-controle ferramenta clear
cena controle-depois-do-clear mostrar_controle
cena status-depois-do-clear ferramenta status
cena clear-com-argumento-sobrando ferramenta clear sobrando
cena status-com-argumento-sobrando ferramenta status sobrando
printf '%s' '{"enabled":false,"productType":"iPhone14,5"}' > "$T/controle.json"
cena status-desabilitado ferramenta status
printf '%s' '{"enabled":true,"productType":""}' > "$T/controle.json"
cena status-habilitado-sem-tipo ferramenta status
printf '%s' '{"enabled":true}' > "$T/controle.json"
cena status-habilitado-sem-chave-do-tipo ferramenta status
printf '%s' '{"enabled":true,"productType":"iPhone16,1"}' > "$T/controle.json"
cena status-habilitado-so-com-o-tipo ferramenta status
printf '%s' 'isto não é JSON' > "$T/controle.json"
cena status-com-controle-quebrado ferramenta status
printf '%s' '[1,2]' > "$T/controle.json"
cena status-com-controle-que-e-lista ferramenta status
rm -f "$T/controle.json"
mkdir "$T/controle.json"
cena set-sem-poder-gravar ferramenta set iPhone14,5
rmdir "$T/controle.json"
printf '%s' 'não é JSON' > "$T/models.json"
cena set-com-banco-quebrado ferramenta set iPhone14,5
printf '%s' '[1,2]' > "$T/models.json"
cena set-com-banco-que-e-lista ferramenta set iPhone14,5
printf '%s' '{"models":"x"}' > "$T/models.json"
cena set-com-modelos-que-nao-e-lista ferramenta set iPhone14,5
printf '%s' '{"models":[]}' > "$T/models.json"
cena set-com-lista-de-modelos-vazia ferramenta set iPhone14,5
rm -f "$T/models.json" "$T/controle.json"

cena ganchos-instalados env NOVAMODEL_CONTROLE="$T/controle.json" NOVAMODEL_MG_FALSO="$T/mg_falso.dylib" "$T/ganchos" instalacao
cena ganchos-instalados-sem-modelname env NOVAMODEL_CONTROLE="$T/controle.json" NOVAMODEL_MG_FALSO="$T/mg_falso.dylib" "$T/ganchos-sem-modelname" instalacao
cena ganchos-instalados-sem-uidevice env NOVAMODEL_CONTROLE="$T/controle.json" NOVAMODEL_MG_FALSO="$T/mg_falso.dylib" "$T/ganchos-sem-uidevice" instalacao
cena ganchos-instalados-no-processo-novamodel env NOVAMODEL_CONTROLE="$T/controle.json" NOVAMODEL_MG_FALSO="$T/mg_falso.dylib" "$T/processo/novamodel" instalacao
cena roteiro-dos-ganchos env NOVAMODEL_CONTROLE="$T/controle.json" NOVAMODEL_MG_FALSO="$T/mg_falso.dylib" "$T/ganchos"

if [ "${1:-}" = "--gravar" ]; then
    cp "$RELATORIO" "$AQUI/caracterizacao.esperado.txt"
    echo "gravado: $AQUI/caracterizacao.esperado.txt"
    exit 0
fi

if diff "$AQUI/caracterizacao.esperado.txt" "$RELATORIO"; then
    echo "NOVAMODEL: A CARACTERIZAÇÃO BATE COM O GRAVADO ($(grep -c '^== ' "$RELATORIO") cenas)"
else
    echo "NOVAMODEL: A CARACTERIZAÇÃO DIFERE DO GRAVADO"
    exit 1
fi
