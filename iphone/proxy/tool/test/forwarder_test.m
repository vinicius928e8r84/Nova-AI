#import "roteiro_palco.h"
#import "../ProxyConfig.h"
#import "../Forwarder.h"
#include <pthread.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define SAUDACAO "\x05\x01\x00"
#define ACEITA_SEM_LOGIN "\x05\x00"
#define PEDIDO_NOME_443 "\x05\x01\x00\x03\x10" "alvo.exemplo.com" "\x01\xBB"
#define PEDIDO_NOME_80 "\x05\x01\x00\x03\x10" "alvo.exemplo.com" "\x00\x50"
#define PEDIDO_NOME_8080 "\x05\x01\x00\x03\x10" "alvo.exemplo.com" "\x1F\x90"
#define CONCEDIDO "\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00"
#define RECUSADO "\x05\x05\x00\x01\x00\x00\x00\x00\x00\x00"
#define CONECTADO "HTTP/1.1 200 Connection Established\r\n\r\n"
#define MAL_FORMADO "HTTP/1.1 400 Bad Request\r\n\r\n"
#define BAD_GATEWAY "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"

#define ABRE_443 {{ TAMANHO(SAUDACAO), BYTES(ACEITA_SEM_LOGIN) }, { TAMANHO(PEDIDO_NOME_443), BYTES(CONCEDIDO) }}
#define ABRE_80 {{ TAMANHO(SAUDACAO), BYTES(ACEITA_SEM_LOGIN) }, { TAMANHO(PEDIDO_NOME_80), BYTES(CONCEDIDO) }}
#define ABRE_8080 {{ TAMANHO(SAUDACAO), BYTES(ACEITA_SEM_LOGIN) }, { TAMANHO(PEDIDO_NOME_8080), BYTES(CONCEDIDO) }}

typedef struct {
    const char *nome;
    const char *envia;
    size_t envia_tamanho;
    const char *resposta;
    size_t resposta_tamanho;
    const char *depois;
    size_t depois_tamanho;
    Passo passos[2];
    size_t quantidade;
    const char *upstream_recebe;
    size_t upstream_recebe_tamanho;
    const char *upstream_eco;
    size_t upstream_eco_tamanho;
} CenaDeEncaminhamento;

#define GET_ABSOLUTO "GET http://alvo.exemplo.com/caminho?q=1 HTTP/1.1\r\nHost: alvo.exemplo.com\r\nX-A: 1\r\n\r\n"
#define GET_REESCRITO "GET /caminho?q=1 HTTP/1.1\r\nHost: alvo.exemplo.com\r\nX-A: 1\r\n\r\n"
#define GET_NA_PORTA "GET http://alvo.exemplo.com:8080/ HTTP/1.1\r\nHost: x\r\n\r\n"
#define GET_NA_PORTA_REESCRITO "GET / HTTP/1.1\r\nHost: x\r\n\r\n"

static const CenaDeEncaminhamento cenas[] = {
    { "connect com porta e tráfego nos dois sentidos",
      BYTES("CONNECT alvo.exemplo.com:443 HTTP/1.1\r\nHost: alvo.exemplo.com:443\r\n\r\n"),
      BYTES(CONECTADO), BYTES("ping"), ABRE_443, 2,
      BYTES(SAUDACAO PEDIDO_NOME_443), BYTES("ping") },
    { "connect sem porta usa a 443",
      BYTES("CONNECT alvo.exemplo.com HTTP/1.1\r\n\r\n"),
      BYTES(CONECTADO), BYTES("pong"), ABRE_443, 2,
      BYTES(SAUDACAO PEDIDO_NOME_443), BYTES("pong") },
    { "connect com bytes colados no cabeçalho vão ao upstream",
      BYTES("CONNECT alvo.exemplo.com:443 HTTP/1.1\r\n\r\noi"),
      BYTES(CONECTADO "oi"), NULL, 0, ABRE_443, 2,
      BYTES(SAUDACAO PEDIDO_NOME_443), BYTES("oi") },
    { "get absoluto vai sem o endereço e na porta 80",
      BYTES(GET_ABSOLUTO),
      BYTES(GET_REESCRITO), NULL, 0, ABRE_80, 2,
      BYTES(SAUDACAO PEDIDO_NOME_80), BYTES(GET_REESCRITO) },
    { "get absoluto com porta",
      BYTES(GET_NA_PORTA),
      BYTES(GET_NA_PORTA_REESCRITO), NULL, 0, ABRE_8080, 2,
      BYTES(SAUDACAO PEDIDO_NOME_8080), BYTES(GET_NA_PORTA_REESCRITO) },
    { "get sem endereço completo é recusado",
      BYTES("GET /so-caminho HTTP/1.1\r\nHost: x\r\n\r\n"),
      BYTES(MAL_FORMADO), NULL, 0, {{0}}, 0, NULL, 0, NULL, 0 },
    { "get sem barra depois do host é recusado",
      BYTES("GET http://alvo.exemplo.com HTTP/1.1\r\n\r\n"),
      BYTES(MAL_FORMADO), NULL, 0, {{0}}, 0, NULL, 0, NULL, 0 },
    { "get com porta inválida é recusado",
      BYTES("GET http://alvo.exemplo.com:0/ HTTP/1.1\r\n\r\n"),
      BYTES(MAL_FORMADO), NULL, 0, {{0}}, 0, NULL, 0, NULL, 0 },
    { "linha de pedido mal formada",
      BYTES("LIXO\r\n\r\n"),
      BYTES(MAL_FORMADO), NULL, 0, {{0}}, 0, NULL, 0, NULL, 0 },
    { "connect com porta inválida",
      BYTES("CONNECT alvo.exemplo.com:99999 HTTP/1.1\r\n\r\n"),
      BYTES(MAL_FORMADO), NULL, 0, {{0}}, 0, NULL, 0, NULL, 0 },
    { "o upstream recusa",
      BYTES("CONNECT alvo.exemplo.com:443 HTTP/1.1\r\n\r\n"),
      BYTES(BAD_GATEWAY), NULL, 0,
      {{ TAMANHO(SAUDACAO), BYTES(ACEITA_SEM_LOGIN) }, { TAMANHO(PEDIDO_NOME_443), BYTES(RECUSADO) }}, 2,
      BYTES(SAUDACAO PEDIDO_NOME_443), NULL, 0 },
};

static int porta_local;
static int porta_do_upstream;
static NSString *registro;

static void *servir(void *arg) {
    (void)arg;
    ProxyConfig *config = [ProxyConfig new];
    config.scheme = @"socks5";
    config.host = @"127.0.0.1";
    config.port = porta_do_upstream;
    config.user = @"";
    config.pass = @"";
    config.localPort = porta_local;
    run_forwarder(config);
    return NULL;
}

static int tentar_cliente(void) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    a.sin_port = htons((uint16_t)porta_local);
    struct timeval limite = { .tv_sec = 5 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &limite, sizeof(limite));
    if (connect(fd, (struct sockaddr *)&a, sizeof(a)) == 0) return fd;
    close(fd);
    return -1;
}

static int abrir_cliente(void) {
    for (int i = 0; i < 100; i++) {
        int fd = tentar_cliente();
        if (fd >= 0) return fd;
        usleep(50000);
    }
    return -1;
}

static BOOL receber_igual(int fd, const char *esperado, size_t tamanho) {
    char lido[512] = {0};
    return recv(fd, lido, tamanho, MSG_WAITALL) == (ssize_t)tamanho && memcmp(lido, esperado, tamanho) == 0;
}

static BOOL conversar(const CenaDeEncaminhamento *cena, int fd) {
    send(fd, cena->envia, cena->envia_tamanho, 0);
    if (!receber_igual(fd, cena->resposta, cena->resposta_tamanho)) return NO;
    if (!cena->depois_tamanho) return YES;
    send(fd, cena->depois, cena->depois_tamanho, 0);
    return receber_igual(fd, cena->depois, cena->depois_tamanho);
}

static int conferir_upstream(const CenaDeEncaminhamento *cena, const Roteiro *roteiro) {
    if (!esperar_roteiro_concluido()) { printf("FALHA: %s: o upstream de mentira não terminou\n", cena->nome); return 1; }
    BOOL pedido = recebido_igual(roteiro, cena->upstream_recebe, cena->upstream_recebe_tamanho);
    BOOL trafego = !cena->upstream_eco || eco_igual(roteiro, cena->upstream_eco, cena->upstream_eco_tamanho);
    if (pedido && trafego) return 0;
    printf("FALHA: %s: o que o upstream recebeu é outro\n", cena->nome);
    return 1;
}

static int executar_cena(const CenaDeEncaminhamento *cena) {
    Roteiro roteiro = { .passos = cena->passos, .quantidade = cena->quantidade, .ecoar = YES };
    if (cena->quantidade) usar_roteiro(&roteiro);
    int fd = abrir_cliente();
    int falhas = conversar(cena, fd) ? 0 : 1;
    if (falhas) printf("FALHA: %s: a resposta do forwarder é outra\n", cena->nome);
    close(fd);
    return falhas + (cena->quantidade ? conferir_upstream(cena, &roteiro) : 0);
}

static int conferir_registro(void) {
    NSString *texto = [NSString stringWithContentsOfFile:registro encoding:NSUTF8StringEncoding error:nil];
    BOOL escuta = [texto containsString:@"[novaproxy] escutando 127.0.0.1:"] && [texto containsString:@"(auth=nao)"];
    BOOL recusa = [texto containsString:@"[novaproxy] alvo.exemplo.com:443 falhou: proxy recusou a conexão (código 5)\n"];
    if (escuta && recusa) return 0;
    printf("FALHA: o registro do forwarder é outro:\n%s\n", texto.UTF8String);
    return 1;
}

int main(void) { @autoreleasepool {
    registro = [NSTemporaryDirectory() stringByAppendingPathComponent:
                [NSString stringWithFormat:@"forwarder-%d.log", getpid()]];
    freopen(registro.fileSystemRepresentation, "w", stderr);
    setvbuf(stderr, NULL, _IONBF, 0);
    porta_do_upstream = porta_do_servidor_de_roteiro();
    porta_local = porta_livre();
    pthread_t th;
    pthread_create(&th, NULL, servir, NULL);
    pthread_detach(th);
    int falhas = 0;
    for (size_t i = 0; i < sizeof(cenas) / sizeof(cenas[0]); i++) falhas += executar_cena(&cenas[i]);
    falhas += conferir_registro();
    [[NSFileManager defaultManager] removeItemAtPath:registro error:nil];
    printf(falhas ? "%d FALHA(S)\n" : "FORWARDER: TODOS OS TESTES PASSARAM\n", falhas);
    return falhas ? 1 : 0;
} }
