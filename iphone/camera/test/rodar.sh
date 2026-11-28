#!/bin/sh
set -e
D="$(cd "$(dirname "$0")" && pwd)"
P="$D/.."
T="$(mktemp -d "${TMPDIR:-/tmp}/ponte-testes.XXXXXX")"
trap 'rm -rf "$T"' EXIT
QUADROS="-framework Foundation -framework CoreMedia -framework CoreVideo -framework CoreGraphics -framework CoreImage -framework ImageIO -framework QuartzCore"

if [ -f "$P/Tweak.x" ]; then
    sed 's/^%ctor {$/__attribute__((constructor)) static void iniciarPonte(void) {/' "$P/Tweak.x" > "$T/Ponte_inteira.m"
    cp "$P/Pipeline.h" "$T/Pipeline.h"
    FONTES="$T/Ponte_inteira.m"
    DEFINE="-DPONTE_INTEIRA"
    LIGAR=""
else
    FONTES="$P/Runtime.m $P/Controle.m $P/Estado.m $P/Quadros.m $P/Grafo.m $P/CicloDoGrafo.m $P/Foto.m $P/Audio.m $P/Saidas.m $P/Ganchos.m"
    DEFINE=""
    LIGAR="$FONTES"
fi

for otimizacao in -O0 -O2; do
    clang -dynamiclib -fobjc-arc -Wno-unused-function -Werror "$otimizacao" -undefined dynamic_lookup \
        -I "$D/falso" -I "$P" -I "$T" $QUADROS -o "$T/ponte$otimizacao.dylib" $FONTES
    echo "compilou sem aviso com $otimizacao"
done

clang -fobjc-arc -Wno-unused-function $DEFINE -I "$D/falso" -I "$P" -I "$T" $QUADROS -o "$T/ponte_test" "$D/ponte_test.m" $LIGAR
"$T/ponte_test"
