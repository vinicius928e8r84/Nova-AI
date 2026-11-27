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

static char g_scheme[16];
static char g_proxy_host[256];
static char g_proxy_user[256];
static char g_proxy_pass[512];
static int g_proxy_port = 0;
static volatile int g_conns = 0;

static int send_all(int fd, const void *buf, size_t len) {
    const char *p = buf;
    while (len > 0) {
        ssize_t n = send(fd, p, len, 0);
        if (n <= 0) { if (errno == EINTR) continue; return -1; }
        p += n; len -= (size_t)n;
    }
    return 0;
}

static void relay(int a, int b) {
    char buf[65536];
    int openA = 1, openB = 1;
    while (openA || openB) {
        struct pollfd pfd[2];
        pfd[0].fd = openA ? a : -1; pfd[0].events = POLLIN; pfd[0].revents = 0;
        pfd[1].fd = openB ? b : -1; pfd[1].events = POLLIN; pfd[1].revents = 0;
        int r = poll(pfd, 2, 180000);
        if (r <= 0) break;
        if (pfd[0].revents & (POLLIN | POLLHUP | POLLERR)) {
            ssize_t n = recv(a, buf, sizeof(buf), 0);
            if (n <= 0) { openA = 0; shutdown(b, SHUT_WR); }
            else if (send_all(b, buf, (size_t)n) < 0) break;
        }
        if (pfd[1].revents & (POLLIN | POLLHUP | POLLERR)) {
            ssize_t n = recv(b, buf, sizeof(buf), 0);
            if (n <= 0) { openB = 0; shutdown(a, SHUT_WR); }
            else if (send_all(a, buf, (size_t)n) < 0) break;
        }
    }
}

static int split_host_port(const char *s, char *host, size_t hlen, int *port, int defport) {
    const char *colon = strrchr(s, ':');
    if (colon && colon != s) {
        size_t n = (size_t)(colon - s);
        if (n >= hlen) n = hlen - 1;
        memcpy(host, s, n); host[n] = 0;
        *port = atoi(colon + 1);
        if (*port <= 0 || *port > 65535) return -1;
        return 0;
    }
    snprintf(host, hlen, "%s", s);
    *port = defport;
    return 0;
}

static void *handle_client(void *arg) {
    int fd = (int)(intptr_t)arg;
    char header[16384];
    size_t used = 0;
    struct timeval tv = { .tv_sec = 30, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    while (used < sizeof(header) - 1) {
        ssize_t n = recv(fd, header + used, sizeof(header) - 1 - used, 0);
        if (n <= 0) goto done;
        used += (size_t)n;
        header[used] = 0;
        if (strstr(header, "\r\n\r\n")) break;
    }
    if (!strstr(header, "\r\n\r\n")) {
        const char *bad = "HTTP/1.1 400 Bad Request\r\n\r\n";
        send_all(fd, bad, strlen(bad));
        goto done;
    }

    char *header_end = strstr(header, "\r\n\r\n") + 4;
    size_t header_len = (size_t)(header_end - header);
    size_t extra_len = used - header_len;

    char line[2048];
    char *eol = strstr(header, "\r\n");
    size_t ll = eol ? (size_t)(eol - header) : strlen(header);
    if (ll >= sizeof(line)) ll = sizeof(line) - 1;
    memcpy(line, header, ll); line[ll] = 0;

    char method[16] = {0}, target[1024] = {0}, version[16] = {0};
    if (sscanf(line, "%15s %1023s %15s", method, target, version) != 3) {
        const char *bad = "HTTP/1.1 400 Bad Request\r\n\r\n";
        send_all(fd, bad, strlen(bad));
        goto done;
    }

    char host[256];
    int port = 0;
    int is_connect = (strcmp(method, "CONNECT") == 0);
    char *path = NULL;

    if (is_connect) {
        if (split_host_port(target, host, sizeof(host), &port, 443) < 0) {
            const char *bad = "HTTP/1.1 400 Bad Request\r\n\r\n";
            send_all(fd, bad, strlen(bad));
            goto done;
        }
    } else {
        char *p = strstr(target, "http://");
        if (!p) {
            const char *bad = "HTTP/1.1 400 Bad Request\r\n\r\n";
            send_all(fd, bad, strlen(bad));
            goto done;
        }
        p += 7;
        char *slash = strchr(p, '/');
        if (!slash) {
            const char *bad = "HTTP/1.1 400 Bad Request\r\n\r\n";
            send_all(fd, bad, strlen(bad));
            goto done;
        }
        char hostbuf[512];
        size_t hn = (size_t)(slash - p);
        if (hn >= sizeof(hostbuf)) hn = sizeof(hostbuf) - 1;
        memcpy(hostbuf, p, hn); hostbuf[hn] = 0;
        if (split_host_port(hostbuf, host, sizeof(host), &port, 80) < 0) {
            const char *bad = "HTTP/1.1 400 Bad Request\r\n\r\n";
            send_all(fd, bad, strlen(bad));
            goto done;
        }
        path = slash;
    }

    char err[256] = {0};
    int up = upstream_connect(g_scheme, g_proxy_host, g_proxy_port, g_proxy_user, g_proxy_pass,
                              host, port, err, sizeof(err));
    if (up < 0) {
        fprintf(stderr, "[novaproxy] %s:%d falhou: %s\n", host, port, err);
        const char *bad = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n";
        send_all(fd, bad, strlen(bad));
        goto done;
    }

    if (is_connect) {
        const char *ok = "HTTP/1.1 200 Connection Established\r\n\r\n";
        if (send_all(fd, ok, strlen(ok)) < 0) { close(up); goto done; }
        if (extra_len > 0 && send_all(up, header_end, extra_len) < 0) { close(up); goto done; }
    } else {
        char newline[2048];
        snprintf(newline, sizeof(newline), "%s %s %s\r\n", method, path, version);
        if (send_all(up, newline, strlen(newline)) < 0) { close(up); goto done; }
        if (send_all(up, eol + 2, (size_t)(header_end - (eol + 2))) < 0) { close(up); goto done; }
        if (extra_len > 0 && send_all(up, header_end, extra_len) < 0) { close(up); goto done; }
    }

    relay(fd, up);
    close(up);

done:
    close(fd);
    __sync_fetch_and_sub(&g_conns, 1);
    return NULL;
}

int run_forwarder(ProxyConfig *config) {
    snprintf(g_scheme, sizeof(g_scheme), "%s", config.scheme.UTF8String ?: "socks5");
    snprintf(g_proxy_host, sizeof(g_proxy_host), "%s", config.host.UTF8String ?: "");
    snprintf(g_proxy_user, sizeof(g_proxy_user), "%s", config.user.UTF8String ?: "");
    snprintf(g_proxy_pass, sizeof(g_proxy_pass), "%s", config.pass.UTF8String ?: "");
    g_proxy_port = config.port;

    signal(SIGPIPE, SIG_IGN);

    int srv = socket(AF_INET, SOCK_STREAM, 0);
    if (srv < 0) { perror("socket"); return 1; }
    int one = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons((uint16_t)config.localPort);
    if (bind(srv, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind 127.0.0.1");
        close(srv);
        return 1;
    }
    if (listen(srv, 128) < 0) { perror("listen"); close(srv); return 1; }

    fprintf(stderr, "[novaproxy] escutando 127.0.0.1:%d -> %s %s:%d (auth=%s)\n",
            config.localPort, g_scheme, g_proxy_host, g_proxy_port, g_proxy_user[0] ? "sim" : "nao");

    for (;;) {
        int fd = accept(srv, NULL, NULL);
        if (fd < 0) { if (errno == EINTR) continue; break; }
        if (g_conns >= 200) { close(fd); continue; }
        __sync_fetch_and_add(&g_conns, 1);
        setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
        pthread_t th;
        if (pthread_create(&th, NULL, handle_client, (void *)(intptr_t)fd) != 0) {
            close(fd);
            __sync_fetch_and_sub(&g_conns, 1);
            continue;
        }
        pthread_detach(th);
    }
    close(srv);
    return 0;
}
