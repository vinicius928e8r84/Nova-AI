#import "roteiro_palco.h"
#include <string.h>

#define CONNECT_80 "CONNECT alvo.exemplo.com:80 HTTP/1.1\r\nHost: alvo.exemplo.com:80\r\n" \
                   "Proxy-Connection: keep-alive\r\nUser-Agent: novaproxy/0.2\r\n\r\n"
#define SOCKS4_LOCAL "\x04\x01\x00\x50\x7F\x00\x00\x01" "usr" "\x00"
#define SOCKS4_LITERAL "\x04\x01\x01\xBB\xCB\x00\x71\x07" "\x00"
#define CONCEDIDO_SOCKS4 "\x00\x5A\x00\x00\x00\x00\x00\x00"

static char resposta_enorme[9000];

#define PEDIDO_UPSTREAM(esquema_, usuario_, host_, porta_) \
    { esquema_, "127.0.0.1", 0, usuario_, "", host_, porta_ }

static const CenaDeRoteiro cenas[] = {
    { "http sem login conecta", PEDIDO_UPSTREAM("http", "", "alvo.exemplo.com", 80),
      {{ TAMANHO(CONNECT_80), BYTES("HTTP/1.1 200 OK\r\n\r\n") }}, 1, NULL,
      BYTES(CONNECT_80) },
    { "http sem resposta", PEDIDO_UPSTREAM("http", "", "alvo.exemplo.com", 80),
      {{ TAMANHO(CONNECT_80), NULL, 0 }}, 1, "o proxy não respondeu ao CONNECT",
      BYTES(CONNECT_80) },
    { "http com resposta sem fim", PEDIDO_UPSTREAM("http", "", "alvo.exemplo.com", 80),
      {{ TAMANHO(CONNECT_80), resposta_enorme, sizeof(resposta_enorme) }}, 1,
      "resposta do proxy HTTP incompleta", BYTES(CONNECT_80) },
    { "socks4 resolve o nome no aparelho", PEDIDO_UPSTREAM("socks4", "usr", "localhost", 80),
      {{ TAMANHO(SOCKS4_LOCAL), BYTES(CONCEDIDO_SOCKS4) }}, 1, NULL,
      BYTES(SOCKS4_LOCAL) },
    { "socks4 com ip e sem usuário", { "socks4", "127.0.0.1", 0, NULL, "", "203.0.113.7", 443 },
      {{ TAMANHO(SOCKS4_LITERAL), BYTES(CONCEDIDO_SOCKS4) }}, 1, NULL,
      BYTES(SOCKS4_LITERAL) },
    { "socks4 fala com um proxy socks5", PEDIDO_UPSTREAM("socks4", "", "203.0.113.7", 443),
      {{ TAMANHO(SOCKS4_LITERAL), BYTES("\x05\x00\x00\x00\x00\x00\x00\x00") }}, 1,
      "esse proxy fala SOCKS5, não SOCKS4", BYTES(SOCKS4_LITERAL) },
    { "socks4 fala com um proxy de texto", PEDIDO_UPSTREAM("socks4", "", "203.0.113.7", 443),
      {{ TAMANHO(SOCKS4_LITERAL), BYTES("HTTP/1.0") }}, 1,
      "o proxy não é SOCKS4 (respondeu \"HTTP/1.0\")", BYTES(SOCKS4_LITERAL) },
    { "socks4 recebe um byte estranho", PEDIDO_UPSTREAM("socks4", "", "203.0.113.7", 443),
      {{ TAMANHO(SOCKS4_LITERAL), BYTES("\x01\x5A\x00\x00\x00\x00\x00\x00") }}, 1,
      "resposta SOCKS4 inesperada (0x01)", BYTES(SOCKS4_LITERAL) },
    { "socks4 sem resposta", PEDIDO_UPSTREAM("socks4", "", "203.0.113.7", 443),
      {{ TAMANHO(SOCKS4_LITERAL), NULL, 0 }}, 1, "proxy SOCKS4 não respondeu",
      BYTES(SOCKS4_LITERAL) },
    { "esquema vazio cai no socks5", PEDIDO_UPSTREAM("", "", "203.0.113.7", 443),
      {{ 3, BYTES("\x05\xFF") }}, 1, "método SOCKS5 não aceito (0xff)", BYTES("\x05\x01\x00") },
    { "socks5h vai para o socks5", PEDIDO_UPSTREAM("socks5h", "", "203.0.113.7", 443),
      {{ 3, BYTES("\x04\x00") }}, 1, "resposta inválida do SOCKS5", BYTES("\x05\x01\x00") },
    { "esquema desconhecido", { "ftp", "127.0.0.1", 1, "", "", "alvo", 21 },
      {{0}}, 0, "esquema desconhecido: ftp", NULL, 0 },
    { "http fora do ar", { "http", "127.0.0.1", 1, "", "", "alvo", 80 },
      {{0}}, 0, "não conectei em 127.0.0.1:1: ", NULL, 0 },
    { "socks4 fora do ar", { "socks4", "127.0.0.1", 1, "", "", "203.0.113.7", 80 },
      {{0}}, 0, "não conectei em 127.0.0.1:1: ", NULL, 0 },
};

int main(void) { @autoreleasepool {
    memset(resposta_enorme, 'x', sizeof(resposta_enorme));
    int falhas = executar_cenas(cenas, sizeof(cenas) / sizeof(cenas[0]), conectar_upstream_pelo_palco);
    printf(falhas ? "%d FALHA(S)\n" : "UPSTREAM ROTEIROS: TODOS OS TESTES PASSARAM\n", falhas);
    return falhas ? 1 : 0;
} }
