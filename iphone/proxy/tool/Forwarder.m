#import "Forwarder.h"
#import "Upstream.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <signal.h>
#include <pthread.h>
#include <poll.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>

typedef struct {
    char host[256];
    int porta;
} HostPorta;

typedef struct {
    int origem;
    int destino;
    int aberto;
} Sentido;

typedef struct {
    char cabecalho[16384];
    size_t usado;
    char *fim_do_cabecalho;
    char *fim_da_linha;
    char metodo[16];
    char alvo[1024];
    char versao[16];
    HostPorta destino;
    int conecta;
    char *caminho;
} Pedido;

static char g_scheme[16];
static char g_proxy_host[256];
static char g_proxy_user[256];
static char g_proxy_pass[512];
static int g_proxy_port = 0;
static volatile int g_conns = 0;

static int send_all(Soquete fd, const void *buf, size_t len) {
    const char *p = buf;
    while (len > 0) {
        ssize_t n = send(fd, p, len, 0);
        if (n <= 0) { if (errno == EINTR) continue; return -1; }
        p += n; len -= (size_t)n;
    }
    return 0;
}

static int repassar_sentido(Sentido *sentido, short revents) {
    if (!(revents & (POLLIN | POLLHUP | POLLERR))) return 0;
    char buf[65536];
    ssize_t n = recv(sentido->origem, buf, sizeof(buf), 0);
    if (n <= 0) {
        sentido->aberto = 0;
        shutdown(sentido->destino, SHUT_WR);
        return 0;
    }
    return send_all(sentido->destino, buf, (size_t)n) < 0 ? -1 : 0;
}

static void relay(Soquete a, Soquete b) {
    Sentido ida = { a, b, 1 }, volta = { b, a, 1 };
    while (ida.aberto || volta.aberto) {
        struct pollfd pfd[2];
        pfd[0].fd = ida.aberto ? a : -1; pfd[0].events = POLLIN; pfd[0].revents = 0;
        pfd[1].fd = volta.aberto ? b : -1; pfd[1].events = POLLIN; pfd[1].revents = 0;
        int r = poll(pfd, 2, 180000);
        if (r <= 0) break;
        if (repassar_sentido(&ida, pfd[0].revents) < 0) break;
        if (repassar_sentido(&volta, pfd[1].revents) < 0) break;
    }
}

static int separar_host_porta(const char *s, int porta_padrao, HostPorta *saida) {
    const char *colon = strrchr(s, ':');
    if (colon && colon != s) {
        size_t n = (size_t)(colon - s);
        if (n >= sizeof(saida->host)) n = sizeof(saida->host) - 1;
        memcpy(saida->host, s, n); saida->host[n] = 0;
        saida->porta = atoi(colon + 1);
        if (saida->porta <= 0 || saida->porta > 65535) return -1;
        return 0;
    }
    snprintf(saida->host, sizeof(saida->host), "%s", s);
    saida->porta = porta_padrao;
    return 0;
}

static void recusar_pedido(Soquete fd) {
    const char *bad = "HTTP/1.1 400 Bad Request\r\n\r\n";
    send_all(fd, bad, strlen(bad));
}

static int ler_cabecalho(Soquete fd, Pedido *pedido) {
    size_t capacidade = sizeof(pedido->cabecalho);
    while (pedido->usado < capacidade - 1) {
        ssize_t n = recv(fd, pedido->cabecalho + pedido->usado, capacidade - 1 - pedido->usado, 0);
        if (n <= 0) return -1;
        pedido->usado += (size_t)n;
        pedido->cabecalho[pedido->usado] = 0;
        if (strstr(pedido->cabecalho, "\r\n\r\n")) break;
    }
    if (!strstr(pedido->cabecalho, "\r\n\r\n")) {
        recusar_pedido(fd);
        return -1;
    }
    pedido->fim_do_cabecalho = strstr(pedido->cabecalho, "\r\n\r\n") + 4;
    return 0;
}

static int ler_linha_do_pedido(Pedido *pedido) {
    char metodo[16] = {0};
    char line[2048];
    pedido->fim_da_linha = strstr(pedido->cabecalho, "\r\n");
    size_t ll = pedido->fim_da_linha ? (size_t)(pedido->fim_da_linha - pedido->cabecalho) : strlen(pedido->cabecalho);
    if (ll >= sizeof(line)) ll = sizeof(line) - 1;
    memcpy(line, pedido->cabecalho, ll); line[ll] = 0;
    if (sscanf(line, "%15s %1023s %15s", metodo, pedido->alvo, pedido->versao) != 3) return -1;
    memcpy(pedido->metodo, metodo, sizeof(metodo));
    pedido->conecta = (strcmp(metodo, "CONNECT") == 0);
    return 0;
}

static int destino_do_get(Pedido *pedido) {
    char *p = strstr(pedido->alvo, "http://");
    if (!p) return -1;
    p += 7;
    char *slash = strchr(p, '/');
    if (!slash) return -1;
    char hostbuf[512];
    size_t hn = (size_t)(slash - p);
    if (hn >= sizeof(hostbuf)) hn = sizeof(hostbuf) - 1;
    memcpy(hostbuf, p, hn); hostbuf[hn] = 0;
    if (separar_host_porta(hostbuf, 80, &pedido->destino) < 0) return -1;
    pedido->caminho = slash;
    return 0;
}

static int interpretar_destino(Pedido *pedido) {
    if (pedido->conecta) return separar_host_porta(pedido->alvo, 443, &pedido->destino);
    return destino_do_get(pedido);
}

static int preparar_pedido(Soquete fd, Pedido *pedido) {
    if (ler_cabecalho(fd, pedido) < 0) return -1;
    if (ler_linha_do_pedido(pedido) < 0 || interpretar_destino(pedido) < 0) {
        recusar_pedido(fd);
        return -1;
    }
    return 0;
}

static int abrir_upstream(Soquete fd, const Pedido *pedido) {
    ProxyMontante proxy = { g_scheme, { g_proxy_host, g_proxy_port }, { g_proxy_user, g_proxy_pass } };
    char err[256] = {0};
    int up = upstream_connect(proxy, (Endereco){ pedido->destino.host, pedido->destino.porta }, (Falha){ err, sizeof(err) });
    if (up >= 0) return up;
    fprintf(stderr, "[novaproxy] %s:%d falhou: %s\n", pedido->destino.host, pedido->destino.porta, err);
    const char *bad = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n";
    send_all(fd, bad, strlen(bad));
    return -1;
}

static int enviar_o_que_sobrou(Soquete up, const Pedido *pedido) {
    size_t extra_len = pedido->usado - (size_t)(pedido->fim_do_cabecalho - pedido->cabecalho);
    if (extra_len > 0 && send_all(up, pedido->fim_do_cabecalho, extra_len) < 0) return -1;
    return 0;
}

static int iniciar_connect(Soquete fd, Soquete up, const Pedido *pedido) {
    const char *ok = "HTTP/1.1 200 Connection Established\r\n\r\n";
    if (send_all(fd, ok, strlen(ok)) < 0) return -1;
    return enviar_o_que_sobrou(up, pedido);
}

static int iniciar_get(Soquete up, const Pedido *pedido) {
    char newline[2048];
    snprintf(newline, sizeof(newline), "%s %s %s\r\n", pedido->metodo, pedido->caminho, pedido->versao);
    if (send_all(up, newline, strlen(newline)) < 0) return -1;
    const char *resto = pedido->fim_da_linha + 2;
    if (send_all(up, resto, (size_t)(pedido->fim_do_cabecalho - resto)) < 0) return -1;
    return enviar_o_que_sobrou(up, pedido);
}

static void atender_pedido(Soquete fd, const Pedido *pedido) {
    int up = abrir_upstream(fd, pedido);
    if (up < 0) return;
    int pronto = pedido->conecta ? iniciar_connect(fd, up, pedido) : iniciar_get(up, pedido);
    if (pronto == 0) relay(fd, up);
    close(up);
}

static void *handle_client(void *arg) {
    int fd = (int)(intptr_t)arg;
    Pedido pedido = {0};
    struct timeval tv = { .tv_sec = 30, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    if (preparar_pedido(fd, &pedido) == 0) atender_pedido(fd, &pedido);
    close(fd);
    __sync_fetch_and_sub(&g_conns, 1);
    return NULL;
}

static void guardar_proxy(ProxyConfig *config) {
    snprintf(g_scheme, sizeof(g_scheme), "%s", config.scheme.UTF8String ?: "socks5");
    snprintf(g_proxy_host, sizeof(g_proxy_host), "%s", config.host.UTF8String ?: "");
    snprintf(g_proxy_user, sizeof(g_proxy_user), "%s", config.user.UTF8String ?: "");
    snprintf(g_proxy_pass, sizeof(g_proxy_pass), "%s", config.pass.UTF8String ?: "");
    g_proxy_port = config.port;
}

static int abrir_servidor(int porta_local) {
    int srv = socket(AF_INET, SOCK_STREAM, 0);
    if (srv < 0) { perror("socket"); return -1; }
    int one = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons((uint16_t)porta_local);
    if (bind(srv, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind 127.0.0.1");
        close(srv);
        return -1;
    }
    if (listen(srv, 128) < 0) { perror("listen"); close(srv); return -1; }
    return srv;
}

static void atender_em_thread(Soquete fd) {
    int one = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
    pthread_t th;
    if (pthread_create(&th, NULL, handle_client, (void *)(intptr_t)fd) != 0) {
        close(fd);
        __sync_fetch_and_sub(&g_conns, 1);
        return;
    }
    pthread_detach(th);
}

static void aceitar_clientes(Soquete srv) {
    for (;;) {
        int fd = accept(srv, NULL, NULL);
        if (fd < 0) { if (errno == EINTR) continue; break; }
        if (g_conns >= 200) { close(fd); continue; }
        __sync_fetch_and_add(&g_conns, 1);
        atender_em_thread(fd);
    }
}

int run_forwarder(ProxyConfig *config) {
    guardar_proxy(config);
    signal(SIGPIPE, SIG_IGN);

    int srv = abrir_servidor(config.localPort);
    if (srv < 0) return 1;

    fprintf(stderr, "[novaproxy] escutando 127.0.0.1:%d -> %s %s:%d (auth=%s)\n",
            config.localPort, g_scheme, g_proxy_host, g_proxy_port, g_proxy_user[0] ? "sim" : "nao");

    aceitar_clientes(srv);
    close(srv);
    return 0;
}
