#import "roteiro_palco.h"
#include <string.h>

#define SAUDACAO_SEM_LOGIN "\x05\x01\x00"
#define SAUDACAO_COM_LOGIN "\x05\x01\x02"
#define ACEITA_SEM_LOGIN "\x05\x00"
#define EXIGE_LOGIN "\x05\x02"
#define LOGIN "\x01\x03" "usr" "\x02" "pw"
#define LOGIN_ACEITO "\x01\x00"
#define LOGIN_RECUSADO "\x01\x01"
#define PEDIDO_IPV4 "\x05\x01\x00\x01\xCB\x00\x71\x07\x01\xBB"
#define PEDIDO_NOME "\x05\x01\x00\x03\x10" "alvo.exemplo.com" "\x00\x50"
#define PEDIDO_IPV6 "\x05\x01\x00\x04\x20\x01\x0d\xb8" "\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00" "\x01" "\x01\xBB"
#define CONCEDIDO_IPV4 "\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00"
#define CONCEDIDO_NOME "\x05\x00\x00\x03\x03" "abc" "\x00\x00"
#define CONCEDIDO_IPV6 "\x05\x00\x00\x04" "\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00" "\x00\x00"
#define RECUSADO_IPV4 "\x05\x05\x00\x01\x00\x00\x00\x00\x00\x00"

static char usuario_longo[257];
static char host_longo[257];

#define PEDIDO_BASICO(usuario_, senha_, host_, porta_) \
    { "socks5", "127.0.0.1", 0, usuario_, senha_, host_, porta_ }

static const CenaDeRoteiro cenas[] = {
    { "ipv4 sem login", PEDIDO_BASICO(NULL, NULL, "203.0.113.7", 443),
      {{ TAMANHO(SAUDACAO_SEM_LOGIN), BYTES(ACEITA_SEM_LOGIN) },
       { TAMANHO(PEDIDO_IPV4), BYTES(CONCEDIDO_IPV4) }}, 2, NULL,
      BYTES(SAUDACAO_SEM_LOGIN PEDIDO_IPV4) },
    { "nome do alvo com resposta de nome", PEDIDO_BASICO("", "", "alvo.exemplo.com", 80),
      {{ TAMANHO(SAUDACAO_SEM_LOGIN), BYTES(ACEITA_SEM_LOGIN) },
       { TAMANHO(PEDIDO_NOME), BYTES(CONCEDIDO_NOME) }}, 2, NULL,
      BYTES(SAUDACAO_SEM_LOGIN PEDIDO_NOME) },
    { "ipv6 com resposta de ipv6", PEDIDO_BASICO("", "", "2001:db8::1", 443),
      {{ TAMANHO(SAUDACAO_SEM_LOGIN), BYTES(ACEITA_SEM_LOGIN) },
       { TAMANHO(PEDIDO_IPV6), BYTES(CONCEDIDO_IPV6) }}, 2, NULL,
      BYTES(SAUDACAO_SEM_LOGIN PEDIDO_IPV6) },
    { "com login aceito", PEDIDO_BASICO("usr", "pw", "203.0.113.7", 443),
      {{ TAMANHO(SAUDACAO_COM_LOGIN), BYTES(EXIGE_LOGIN) },
       { TAMANHO(LOGIN), BYTES(LOGIN_ACEITO) },
       { TAMANHO(PEDIDO_IPV4), BYTES(CONCEDIDO_IPV4) }}, 3, NULL,
      BYTES(SAUDACAO_COM_LOGIN LOGIN PEDIDO_IPV4) },
    { "login recusado", PEDIDO_BASICO("usr", "pw", "203.0.113.7", 443),
      {{ TAMANHO(SAUDACAO_COM_LOGIN), BYTES(EXIGE_LOGIN) },
       { TAMANHO(LOGIN), BYTES(LOGIN_RECUSADO) }}, 2, "autenticação recusada pelo proxy",
      BYTES(SAUDACAO_COM_LOGIN LOGIN) },
    { "o proxy exige login e não há login", PEDIDO_BASICO("", "", "203.0.113.7", 443),
      {{ TAMANHO(SAUDACAO_SEM_LOGIN), BYTES(EXIGE_LOGIN) }}, 1, "proxy exige autenticação",
      BYTES(SAUDACAO_SEM_LOGIN) },
    { "método não aceito", PEDIDO_BASICO("", "", "203.0.113.7", 443),
      {{ TAMANHO(SAUDACAO_SEM_LOGIN), BYTES("\x05\xFF") }}, 1, "método SOCKS5 não aceito (0xff)",
      BYTES(SAUDACAO_SEM_LOGIN) },
    { "saudação de outra versão", PEDIDO_BASICO("", "", "203.0.113.7", 443),
      {{ TAMANHO(SAUDACAO_SEM_LOGIN), BYTES("\x04\x00") }}, 1, "resposta inválida do SOCKS5",
      BYTES(SAUDACAO_SEM_LOGIN) },
    { "o proxy recusa o destino", PEDIDO_BASICO("", "", "203.0.113.7", 443),
      {{ TAMANHO(SAUDACAO_SEM_LOGIN), BYTES(ACEITA_SEM_LOGIN) },
       { TAMANHO(PEDIDO_IPV4), BYTES(RECUSADO_IPV4) }}, 2, "proxy recusou a conexão (código 5)",
      BYTES(SAUDACAO_SEM_LOGIN PEDIDO_IPV4) },
    { "resposta do pedido de outra versão", PEDIDO_BASICO("", "", "203.0.113.7", 443),
      {{ TAMANHO(SAUDACAO_SEM_LOGIN), BYTES(ACEITA_SEM_LOGIN) },
       { TAMANHO(PEDIDO_IPV4), BYTES("\x04\x00\x00\x01") }}, 2, "sem resposta do SOCKS5",
      BYTES(SAUDACAO_SEM_LOGIN PEDIDO_IPV4) },
    { "resposta cortada no meio do endereço", PEDIDO_BASICO("", "", "203.0.113.7", 443),
      {{ TAMANHO(SAUDACAO_SEM_LOGIN), BYTES(ACEITA_SEM_LOGIN) },
       { TAMANHO(PEDIDO_IPV4), BYTES("\x05\x00\x00\x03") }}, 2, "",
      BYTES(SAUDACAO_SEM_LOGIN PEDIDO_IPV4) },
    { "login longo demais", PEDIDO_BASICO(usuario_longo, "pw", "203.0.113.7", 443),
      {{ TAMANHO(SAUDACAO_COM_LOGIN), BYTES(EXIGE_LOGIN) }}, 1, "credenciais longas demais",
      BYTES(SAUDACAO_COM_LOGIN) },
    { "nome do alvo longo demais", PEDIDO_BASICO("", "", host_longo, 443),
      {{ TAMANHO(SAUDACAO_SEM_LOGIN), BYTES(ACEITA_SEM_LOGIN) }}, 1, "host longo demais",
      BYTES(SAUDACAO_SEM_LOGIN) },
    { "proxy fora do ar", { "socks5", "127.0.0.1", 1, "", "", "203.0.113.7", 443 },
      {{0}}, 0, "não consegui conectar no proxy 127.0.0.1:1", NULL, 0 },
};

int main(void) { @autoreleasepool {
    memset(usuario_longo, 'a', sizeof(usuario_longo) - 1);
    memset(host_longo, 'h', sizeof(host_longo) - 1);
    int falhas = executar_cenas(cenas, sizeof(cenas) / sizeof(cenas[0]), conectar_socks5_pelo_palco);
    printf(falhas ? "%d FALHA(S)\n" : "SOCKS5: TODOS OS TESTES PASSARAM\n", falhas);
    return falhas ? 1 : 0;
} }
