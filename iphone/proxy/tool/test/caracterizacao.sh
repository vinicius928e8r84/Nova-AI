#!/bin/sh
set -e
D="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/novaproxy-caracterizacao.XXXXXX")"
trap 'rm -rf "$T"' EXIT
RELATORIO="$T/relatorio.txt"

executar() {
    if "$@" > "$T/saida.txt" 2>&1; then codigo=0; else codigo=$?; fi
    echo "saiu com $codigo" >> "$RELATORIO"
    tr -d '\r' < "$T/saida.txt" | cat -v >> "$RELATORIO"
}

caracterizar_parser() {
    clang -fobjc-arc -framework Foundation -o "$T/parse_test" \
        "$D/parse_test.m" "$D/parse_palco.m" "$D/../ProxyConfig.m"
    echo "== parser sem quebra" >> "$RELATORIO"
    executar env NOVA_CASOS="$T/casos.txt" "$T/parse_test"
    total=$(wc -l < "$T/casos.txt" | tr -d ' ')
    i=0
    while [ "$i" -lt "$total" ]; do
        echo "== parser caso $i quebrado: $(sed -n "$((i + 1))p" "$T/casos.txt")" >> "$RELATORIO"
        executar env NOVA_CASO_QUEBRADO=$i "$T/parse_test"
        i=$((i + 1))
    done
}

quebrar_upstream() {
    cp "$D/../Upstream.m" "$D/../Upstream.h" "$D/../Socks5.h" "$T/"
    DE="$2" PARA="$3" perl -0pi -e 'die "trecho ausente ou repetido: $ENV{DE}\n" unless (() = /\Q$ENV{DE}\E/g) == 1; s/\Q$ENV{DE}\E/$ENV{PARA}/' "$T/Upstream.m"
    clang -fobjc-arc -w -framework Foundation -o "$T/upstream_test" \
        "$D/upstream_test.m" "$D/conexao_palco.m" "$T/Upstream.m" "$D/../Socks5.m"
    echo "== upstream quebra $1" >> "$RELATORIO"
    executar "$T/upstream_test"
}

caracterizar_upstream() {
    clang -fobjc-arc -framework Foundation -o "$T/upstream_test" \
        "$D/upstream_test.m" "$D/conexao_palco.m" "$D/../Upstream.m" "$D/../Socks5.m"
    echo "== upstream sem quebra" >> "$RELATORIO"
    executar "$T/upstream_test"
    quebrar_upstream http-nao-abre 'if (!strstr(status, " 200")) {' 'if (!strstr(status, " 999")) {'
    quebrar_upstream http-recusa-passa 'if (!strstr(status, " 200")) {' 'if (0) {'
    quebrar_upstream http-recusa-sem-codigo '"proxy HTTP recusou o CONNECT: %s", status' '"proxy HTTP recusou o CONNECT"'
    quebrar_upstream http-connect-errado '@"CONNECT %s:%d HTTP/1.1\r\n"' '@"CONNEKT %s:%d HTTP/1.1\r\n"'
    quebrar_upstream http-auth-errada 'Proxy-Authorization: Basic ' 'Proxy-Authorization: Bearer '
    quebrar_upstream http-tunel-fechado 'char *eol = strstr(resp, "\r\n");' 'close(fd); char *eol = strstr(resp, "\r\n");'
    quebrar_upstream socks4a-nao-abre 'if (resp[1] != 0x5A)' 'if (resp[1] != 0x5C)'
    quebrar_upstream socks4-cabecalho 'req[n++] = 0x04;' 'req[n++] = 0x05;'
    quebrar_upstream socks4-porta 'req[n++] = (unsigned char)(target_port & 0xFF);' 'req[n++] = (unsigned char)((target_port + 1) & 0xFF);'
    quebrar_upstream socks4a-endereco 'req[n++] = 0; req[n++] = 0; req[n++] = 0; req[n++] = 1;' 'req[n++] = 0; req[n++] = 0; req[n++] = 0; req[n++] = 2;'
    quebrar_upstream socks4-usuario 'memcpy(req + n, u, ul); n += ul;' 'memcpy(req + n, "uXr", ul); n += ul;'
    quebrar_upstream socks4a-host 'memcpy(req + n, target_host, hl); n += hl;' 'memcpy(req + n, "alvo.exemplo.cox", hl); n += hl;'
    quebrar_upstream socks4-recusa-passa 'if (resp[1] != 0x5A) {' 'if (resp[1] != 0x5A && resp[1] != 0x5B) {'
    quebrar_upstream socks4-recusa-sem-texto 'proxy SOCKS4 recusou o destino' 'proxy SOCKS4 negou o destino'
    quebrar_upstream https-aceito 'if (strcmp(sch, "https") == 0) {' 'if (strcmp(sch, "https") == 0) { return 0;'
    quebrar_upstream https-sem-texto 'esquema https (TLS' 'esquema TLS (TLS'
}

caracterizar_roteiro() {
    nome=$1
    shift
    clang -fobjc-arc -framework Foundation -o "$T/$nome" "$D/$nome.m" "$D/roteiro_palco.m" "$D/conexao_palco.m" \
        "$D/../Upstream.m" "$D/../Socks5.m" "$@"
    echo "== $nome sem quebra" >> "$RELATORIO"
    executar "$T/$nome"
}

: > "$RELATORIO"
caracterizar_parser
caracterizar_upstream
caracterizar_roteiro socks5_test
caracterizar_roteiro upstream_roteiros_test
caracterizar_roteiro forwarder_test "$D/../Forwarder.m" "$D/../ProxyConfig.m"

if [ "${1:-}" = "--gravar" ]; then
    cp "$RELATORIO" "$D/caracterizacao.esperado.txt"
    echo "CARACTERIZAÇÃO: gravada"
elif diff -u "$D/caracterizacao.esperado.txt" "$RELATORIO"; then
    echo "CARACTERIZAÇÃO: TODAS AS CENAS IGUAIS"
else
    echo "CARACTERIZAÇÃO: DIFERENÇA ACIMA"
    exit 1
fi
