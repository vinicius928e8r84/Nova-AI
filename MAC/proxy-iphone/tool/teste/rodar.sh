#!/bin/sh
set -e
D="$(cd "$(dirname "$0")" && pwd)"
T="${TMPDIR:-/tmp}/novaproxy-testes"
mkdir -p "$T"

clang -fobjc-arc -framework Foundation -o "$T/parse_test" \
    "$D/parse_test.m" "$D/../ProxyConfig.m"
"$T/parse_test"

clang -fobjc-arc -framework Foundation -o "$T/upstream_test" \
    "$D/upstream_test.m" "$D/../Upstream.m" "$D/../Socks5.m"
"$T/upstream_test"
