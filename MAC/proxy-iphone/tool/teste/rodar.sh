#!/bin/sh
# Compila o parser no Mac (sem tocar no iPhone) e roda os casos.
set -e
D="$(cd "$(dirname "$0")" && pwd)"
clang -fobjc-arc -framework Foundation -o "${TMPDIR:-/tmp}/novaproxy_parse_test" "$D/parse_test.m" "$D/../ProxyConfig.m"
"${TMPDIR:-/tmp}/novaproxy_parse_test"
