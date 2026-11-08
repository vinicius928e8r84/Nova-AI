// Teste do upstream_connect no Mac, contra proxies falsos locais (nada sai para a internet).
// Verifica o que realmente vai no fio: CONNECT do HTTP (com Basic auth), SOCKS4a,
// recusa do proxy e o caso https não suportado.   ./teste/rodar.sh
#import "../Upstream.h"
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

static void *http_server(void *arg) {
    Fake *f = arg;
    int c = accept(f->fd, NULL, NULL);
    if (c < 0) return NULL;
    while (f->used < sizeof(f->req) - 1) {
        ssize_t n = recv(c, f->req + f->used, sizeof(f->req) - 1 - f->used, 0);
        if (n <= 0) break;
        f->used += (size_t)n;
        f->req[f->used] = 0;
        if (strstr(f->req, "\r\n\r\n")) break;
    }
    const char *resp = f->kind == 407
        ? "HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"
        : "HTTP/1.1 200 Connection Established\r\n\r\n";
    send(c, resp, strlen(resp), 0);
    if (f->kind == 0) {                 // 200: faz eco do que chegar
        char b[256];
        for (;;) {
            ssize_t n = recv(c, b, sizeof(b), 0);
            if (n <= 0) break;
            if (send(c, b, (size_t)n, 0) <= 0) break;
        }
    }
    close(c);
    return NULL;
}

static void *socks4_server(void *arg) {
    Fake *f = arg;
    int c = accept(f->fd, NULL, NULL);
    if (c < 0) return NULL;
    char b[1024];
    size_t used = 0;
    while (used < sizeof(b) - 1) {          // 8 bytes + usuário + host, cada um com NUL
        ssize_t n = recv(c, b + used, 1, 0);
        if (n <= 0) break;
        used += (size_t)n;
        b[used] = 0;
        int zeros = 0;
        for (size_t i = 8; i < used; i++) if (b[i] == 0) zeros++;
        if (used > 8 && zeros >= 2) break;
    }
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

int main(void) { @autoreleasepool {
    char err[512];

    // ---- HTTP CONNECT com autenticação
    {
        Fake f = {0};
        int port = 0;
        f.fd = listen_local(&port);
        if (f.fd < 0) { fail("não subi o proxy falso", NULL); return 1; }
        starts(&f, http_server, NULL);
        err[0] = 0;
        int fd = upstream_connect("http", "127.0.0.1", port, "usr", "pa:ss", "alvo.exemplo.com", 443, err, sizeof(err));
        if (fd < 0) fail("http_connect devia abrir", err);
        else {
            if (!strstr(f.req, "CONNECT alvo.exemplo.com:443 HTTP/1.1\r\n")) fail("CONNECT errado no fio", f.req);
            NSString *creds = @"usr:pa:ss";
            NSString *b64 = [[creds dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0];
            NSString *want = [NSString stringWithFormat:@"Proxy-Authorization: Basic %@", b64];
            if (!strstr(f.req, want.UTF8String)) fail("Basic auth errado no fio", f.req);
            const char *ping = "PING";
            send(fd, ping, 4, 0);
            char echo[8] = {0};
            ssize_t n = recv(fd, echo, 4, 0);
            if (n != 4 || memcmp(echo, ping, 4) != 0) fail("o túnel HTTP não passou dados", NULL);
            close(fd);
        }
        close(f.fd);
    }

    // ---- HTTP CONNECT recusado (407)
    {
        Fake f = {0};
        f.kind = 407;
        int port = 0;
        f.fd = listen_local(&port);
        starts(&f, http_server, NULL);
        err[0] = 0;
        int fd = upstream_connect("http", "127.0.0.1", port, "usr", "x", "alvo.exemplo.com", 443, err, sizeof(err));
        if (fd >= 0) { fail("407 devia falhar", NULL); close(fd); }
        else if (!strstr(err, "407")) fail("o erro devia citar o 407", err);
        close(f.fd);
    }

    // ---- SOCKS4a
    {
        Fake f = {0};
        int port = 0;
        f.fd = listen_local(&port);
        starts(&f, socks4_server, NULL);
        err[0] = 0;
        int fd = upstream_connect("socks4a", "127.0.0.1", port, "usr", "", "alvo.exemplo.com", 80, err, sizeof(err));
        if (fd < 0) fail("socks4a devia abrir", err);
        else {
            unsigned char *r = (unsigned char *)f.req;
            if (f.used < 10) fail("pedido SOCKS4a curto", NULL);
            else {
                if (r[0] != 0x04 || r[1] != 0x01) fail("cabeçalho SOCKS4 errado", NULL);
                if (!(r[2] == 0x00 && r[3] == 0x50)) fail("porta SOCKS4 errada no fio", NULL);
                if (!(r[4] == 0 && r[5] == 0 && r[6] == 0 && r[7] == 1)) fail("SOCKS4a devia mandar 0.0.0.1", NULL);
                if (strcmp(f.req + 8, "usr") != 0) fail("usuário SOCKS4 errado", f.req + 8);
                if (strcmp(f.req + 12, "alvo.exemplo.com") != 0) fail("host SOCKS4a não foi enviado", f.req + 12);
            }
            close(fd);
        }
        close(f.fd);
    }

    // ---- SOCKS4 recusado
    {
        Fake f = {0};
        f.kind = 1;
        int port = 0;
        f.fd = listen_local(&port);
        starts(&f, socks4_server, NULL);
        err[0] = 0;
        int fd = upstream_connect("socks4a", "127.0.0.1", port, "usr", "", "alvo.exemplo.com", 80, err, sizeof(err));
        if (fd >= 0) { fail("recusa do SOCKS4 devia falhar", NULL); close(fd); }
        else if (!strstr(err, "recusou")) fail("o erro devia dizer que recusou", err);
        close(f.fd);
    }

    // ---- https ainda não suportado: erro claro, sem conectar
    {
        err[0] = 0;
        int fd = upstream_connect("https", "127.0.0.1", 1, "u", "p", "alvo", 443, err, sizeof(err));
        if (fd >= 0) { fail("https devia ser recusado nesta versão", NULL); close(fd); }
        else if (!strstr(err, "https")) fail("o erro devia falar de https", err);
    }

    printf(fails ? "%d FALHA(S)\n" : "UPSTREAM: TODOS OS TESTES PASSARAM\n", fails);
    return fails ? 1 : 0;
} }
