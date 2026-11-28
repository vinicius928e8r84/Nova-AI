#!/bin/sh
set -e
D="$(cd "$(dirname "$0")" && pwd)"
T="${TMPDIR:-/tmp}/novaproxy-testes"
mkdir -p "$T"

clang -fobjc-arc -framework Foundation -o "$T/parse_test" \
    "$D/parse_test.m" "$D/../ProxyConfig.m"
"$T/parse_test"

clang -fobjc-arc -framework Foundation -o "$T/upstream_test" \
    "$D/upstream_test.m" "$D/conexao_palco.m" "$D/../Upstream.m" "$D/../Socks5.m"
"$T/upstream_test"

clang -fobjc-arc -framework Foundation -o "$T/socks5_test" \
    "$D/socks5_test.m" "$D/roteiro_palco.m" "$D/conexao_palco.m" "$D/../Upstream.m" "$D/../Socks5.m"
"$T/socks5_test"

clang -fobjc-arc -framework Foundation -o "$T/upstream_roteiros_test" \
    "$D/upstream_roteiros_test.m" "$D/roteiro_palco.m" "$D/conexao_palco.m" "$D/../Upstream.m" "$D/../Socks5.m"
"$T/upstream_roteiros_test"

clang -fobjc-arc -framework Foundation -o "$T/forwarder_test" \
    "$D/forwarder_test.m" "$D/roteiro_palco.m" "$D/conexao_palco.m" "$D/../Upstream.m" "$D/../Socks5.m" \
    "$D/../Forwarder.m" "$D/../ProxyConfig.m"
"$T/forwarder_test"

sh "$D/caracterizacao.sh"
