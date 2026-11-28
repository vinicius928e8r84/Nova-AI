#import "conexao_palco.h"
#import <Foundation/Foundation.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

static int fails = 0;

typedef struct { int fd; char req[4096]; size_t used; int kind; } Fake;

typedef struct {
    const char *se_conectou;
    const char *trecho_do_erro;
    const char *se_faltou_o_trecho;
} MensagensDeRecusa;

typedef struct {
    void *(*servidor)(void *);
    int kind;
    const char *scheme;
    const char *user;
    const char *pass;
    int porta_do_alvo;
    MensagensDeRecusa mensagens;
} CenaDeRecusa;

static void fail(const char *msg, const char *extra) {
    fails++;
    printf("FALHA: %s %s\n", msg, extra ?: "");
}

static int listen_local(int *port_out) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    a.sin_port = 0;
    if (bind(s, (struct sockaddr *)&a, sizeof(a)) < 0) return -1;
    if (listen(s, 4) < 0) return -1;
    socklen_t l = sizeof(a);
    getsockname(s, (struct sockaddr *)&a, &l);
    *port_out = ntohs(a.sin_port);
    return s;
}

static void ler_pedido_http(Fake *f, int c) {
    while (f->used < sizeof(f->req) - 1) {
        ssize_t n = recv(c, f->req + f->used, sizeof(f->req) - 1 - f->used, 0);
        if (n <= 0) break;
        f->used += (size_t)n;
        f->req[f->used] = 0;
        if (strstr(f->req, "\r\n\r\n")) break;
    }
}

static void ecoar(int c) {
    char b[256];
    for (;;) {
        ssize_t n = recv(c, b, sizeof(b), 0);
        if (n <= 0) break;
        if (send(c, b, (size_t)n, 0) <= 0) break;
    }
}

static void *http_server(void *arg) {
    Fake *f = arg;
    int c = accept(f->fd, NULL, NULL);
    if (c < 0) return NULL;
    ler_pedido_http(f, c);
    const char *resp = f->kind == 407
        ? "HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"
        : "HTTP/1.1 200 Connection Established\r\n\r\n";
    send(c, resp, strlen(resp), 0);
    if (f->kind == 0) ecoar(c);
    close(c);
    return NULL;
}

static int pedido_socks4_completo(const char *b, size_t used) {
    int zeros = 0;
    for (size_t i = 8; i < used; i++) if (b[i] == 0) zeros++;
    return used > 8 && zeros >= 2;
}

static size_t ler_pedido_socks4(int c, char *b, size_t capacidade) {
    size_t used = 0;
    while (used < capacidade - 1) {
        ssize_t n = recv(c, b + used, 1, 0);
        if (n <= 0) break;
        used += (size_t)n;
        b[used] = 0;
        if (pedido_socks4_completo(b, used)) break;
    }
    return used;
}

static void *socks4_server(void *arg) {
    Fake *f = arg;
    int c = accept(f->fd, NULL, NULL);
    if (c < 0) return NULL;
    char b[1024];
    size_t used = ler_pedido_socks4(c, b, sizeof(b));
    memcpy(f->req, b, used);
    f->used = used;
    unsigned char resp[8] = { 0x00, (unsigned char)(f->kind == 0 ? 0x5A : 0x5B), 0, 0, 0, 0, 0, 0 };
    send(c, resp, sizeof(resp), 0);
    char e[16];
    while (recv(c, e, sizeof(e), 0) > 0) { }
    close(c);
    return NULL;
}

static int starts(Fake *f, void *(*fn)(void *), NSString **payload) {
    pthread_t th;
    if (pthread_create(&th, NULL, fn, f) != 0) return -1;
    pthread_detach(th);
    (void)payload;
    return 0;
}

static int subir_proxy_falso(Fake *f, void *(*servidor)(void *)) {
    int port = 0;
    f->fd = listen_local(&port);
    starts(f, servidor, NULL);
    return port;
}

static void conferir_pedido_http(Fake *f) {
    if (!strstr(f->req, "CONNECT alvo.exemplo.com:443 HTTP/1.1\r\n")) fail("CONNECT errado no fio", f->req);
    NSString *creds = @"usr:pa:ss";
    NSString *b64 = [[creds dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0];
    NSString *want = [NSString stringWithFormat:@"Proxy-Authorization: Basic %@", b64];
    if (!strstr(f->req, want.UTF8String)) fail("Basic auth errado no fio", f->req);
}

static void conferir_tunel_http(int fd) {
    const char *ping = "PING";
    send(fd, ping, 4, 0);
    char echo[8] = {0};
    ssize_t n = recv(fd, echo, 4, 0);
    if (n != 4 || memcmp(echo, ping, 4) != 0) fail("o túnel HTTP não passou dados", NULL);
}

static void conferir_cabecalho_socks4a(const unsigned char *r) {
    static const unsigned char nome_remoto[4] = { 0, 0, 0, 1 };
    if (r[0] != 0x04 || r[1] != 0x01) fail("cabeçalho SOCKS4 errado", NULL);
    if (!(r[2] == 0x00 && r[3] == 0x50)) fail("porta SOCKS4 errada no fio", NULL);
    if (memcmp(r + 4, nome_remoto, sizeof(nome_remoto)) != 0) fail("SOCKS4a devia mandar 0.0.0.1", NULL);
}

static void conferir_pedido_socks4a(Fake *f) {
    if (f->used < 10) { fail("pedido SOCKS4a curto", NULL); return; }
    conferir_cabecalho_socks4a((unsigned char *)f->req);
    if (strcmp(f->req + 8, "usr") != 0) fail("usuário SOCKS4 errado", f->req + 8);
    if (strcmp(f->req + 12, "alvo.exemplo.com") != 0) fail("host SOCKS4a não foi enviado", f->req + 12);
}

static int cena_http_conecta(void) {
    Fake f = {0};
    int port = 0;
    f.fd = listen_local(&port);
    if (f.fd < 0) { fail("não subi o proxy falso", NULL); return 1; }
    starts(&f, http_server, NULL);
    char err[512];
    err[0] = 0;
    int fd = conectar_upstream_pelo_palco(&(PedidoDeConexao){"http", "127.0.0.1", port, "usr", "pa:ss", "alvo.exemplo.com", 443}, err, sizeof(err));
    if (fd < 0) fail("http_connect devia abrir", err);
    else {
        conferir_pedido_http(&f);
        conferir_tunel_http(fd);
        close(fd);
    }
    close(f.fd);
    return 0;
}

static void cena_socks4a_conecta(void) {
    Fake f = {0};
    int port = subir_proxy_falso(&f, socks4_server);
    char err[512];
    err[0] = 0;
    int fd = conectar_upstream_pelo_palco(&(PedidoDeConexao){"socks4a", "127.0.0.1", port, "usr", "", "alvo.exemplo.com", 80}, err, sizeof(err));
    if (fd < 0) fail("socks4a devia abrir", err);
    else {
        conferir_pedido_socks4a(&f);
        close(fd);
    }
    close(f.fd);
}

static void cena_de_recusa(CenaDeRecusa c) {
    Fake f = {0};
    f.kind = c.kind;
    int port = subir_proxy_falso(&f, c.servidor);
    char err[512];
    err[0] = 0;
    int fd = conectar_upstream_pelo_palco(&(PedidoDeConexao){c.scheme, "127.0.0.1", port, c.user, c.pass, "alvo.exemplo.com", c.porta_do_alvo}, err, sizeof(err));
    if (fd >= 0) { fail(c.mensagens.se_conectou, NULL); close(fd); }
    else if (!strstr(err, c.mensagens.trecho_do_erro)) fail(c.mensagens.se_faltou_o_trecho, err);
    close(f.fd);
}

static void cena_https_recusado(void) {
    char err[512];
    err[0] = 0;
    int fd = conectar_upstream_pelo_palco(&(PedidoDeConexao){"https", "127.0.0.1", 1, "u", "p", "alvo", 443}, err, sizeof(err));
    if (fd >= 0) { fail("https devia ser recusado nesta versão", NULL); close(fd); }
    else if (!strstr(err, "https")) fail("o erro devia falar de https", err);
}

int main(void) { @autoreleasepool {
    if (cena_http_conecta() != 0) return 1;
    cena_de_recusa((CenaDeRecusa){http_server, 407, "http", "usr", "x", 443,
        {"407 devia falhar", "407", "o erro devia citar o 407"}});
    cena_socks4a_conecta();
    cena_de_recusa((CenaDeRecusa){socks4_server, 1, "socks4a", "usr", "", 80,
        {"recusa do SOCKS4 devia falhar", "recusou", "o erro devia dizer que recusou"}});
    cena_https_recusado();

    printf(fails ? "%d FALHA(S)\n" : "UPSTREAM: TODOS OS TESTES PASSARAM\n", fails);
    return fails ? 1 : 0;
} }
