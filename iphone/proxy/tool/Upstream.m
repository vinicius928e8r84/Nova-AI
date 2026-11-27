#import "Upstream.h"
#import "Socks5.h"
#include <string.h>
#include <stdarg.h>
#include <errno.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <netdb.h>
#include <sys/time.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>

static void set_err(char *err, size_t len, const char *fmt, ...) {
    if (!err || len == 0) return;
    va_list ap; va_start(ap, fmt);
    vsnprintf(err, len, fmt, ap);
    va_end(ap);
}

static int send_all_fd(int fd, const void *buf, size_t len) {
    const char *p = buf;
    while (len > 0) {
        ssize_t n = send(fd, p, len, 0);
        if (n <= 0) { if (errno == EINTR) continue; return -1; }
        p += n; len -= (size_t)n;
    }
    return 0;
}

static int recv_full_fd(int fd, void *buf, size_t len) {
    char *p = buf;
    while (len > 0) {
        ssize_t n = recv(fd, p, len, 0);
        if (n <= 0) { if (n < 0 && errno == EINTR) continue; return -1; }
        p += n; len -= (size_t)n;
    }
    return 0;
}

static int tcp_connect(const char *host, int port, int timeout_ms, char *err, size_t errlen) {
    char portstr[16];
    snprintf(portstr, sizeof(portstr), "%d", port);
    struct addrinfo hints = {0}, *res = NULL;
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    int gai = getaddrinfo(host, portstr, &hints, &res);
    if (gai != 0 || !res) {
        set_err(err, errlen, "não resolvi %s: %s", host, gai_strerror(gai));
        return -1;
    }
    int fd = socket(res->ai_family, SOCK_STREAM, 0);
    if (fd < 0) { freeaddrinfo(res); set_err(err, errlen, "socket: %s", strerror(errno)); return -1; }

    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    int r = connect(fd, res->ai_addr, res->ai_addrlen);
    freeaddrinfo(res);
    if (r < 0 && errno != EINPROGRESS) {
        set_err(err, errlen, "não conectei em %s:%d: %s", host, port, strerror(errno));
        close(fd);
        return -1;
    }
    if (r < 0) {
        struct pollfd p = { .fd = fd, .events = POLLOUT };
        int pr;
        do { pr = poll(&p, 1, timeout_ms); } while (pr < 0 && errno == EINTR);
        if (pr <= 0) { set_err(err, errlen, "timeout conectando em %s:%d", host, port); close(fd); return -1; }
        int soerr = 0; socklen_t sl = sizeof(soerr);
        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &soerr, &sl) < 0 || soerr != 0) {
            set_err(err, errlen, "não conectei em %s:%d: %s", host, port, strerror(soerr ? soerr : errno));
            close(fd);
            return -1;
        }
    }
    fcntl(fd, F_SETFL, flags);

    struct timeval tv = { .tv_sec = timeout_ms / 1000, .tv_usec = (timeout_ms % 1000) * 1000 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    int one = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
    return fd;
}

static int socks4_connect(const char *proxy_host, int proxy_port,
                          const char *user, const char *target_host, int target_port,
                          BOOL remote_dns, char *err, size_t errlen) {
    int fd = tcp_connect(proxy_host, proxy_port, 15000, err, errlen);
    if (fd < 0) return -1;

    unsigned char req[1024];
    size_t n = 0;
    req[n++] = 0x04;
    req[n++] = 0x01;
    req[n++] = (unsigned char)((target_port >> 8) & 0xFF);
    req[n++] = (unsigned char)(target_port & 0xFF);

    if (remote_dns) {
        req[n++] = 0; req[n++] = 0; req[n++] = 0; req[n++] = 1;
    } else {
        struct in_addr in;
        if (inet_pton(AF_INET, target_host, &in) != 1) {
            struct addrinfo hints = {0}, *res = NULL;
            hints.ai_family = AF_INET;
            hints.ai_socktype = SOCK_STREAM;
            int r = getaddrinfo(target_host, NULL, &hints, &res);
            if (r != 0 || !res) {
                if (res) freeaddrinfo(res);
                set_err(err, errlen, "SOCKS4 precisa de IPv4: use socks4a:// para mandar o nome %s", target_host);
                close(fd);
                return -1;
            }
            in = ((struct sockaddr_in *)res->ai_addr)->sin_addr;
            freeaddrinfo(res);
        }
        memcpy(req + n, &in.s_addr, 4); n += 4;
    }

    const char *u = (user && user[0]) ? user : "";
    size_t ul = strlen(u);
    if (ul > 500) ul = 500;
    memcpy(req + n, u, ul); n += ul;
    req[n++] = 0;
    if (remote_dns) {
        size_t hl = strlen(target_host);
        if (hl > 500) hl = 500;
        memcpy(req + n, target_host, hl); n += hl;
        req[n++] = 0;
    }

    if (send_all_fd(fd, req, n) < 0) { set_err(err, errlen, "não consegui enviar o pedido SOCKS4"); close(fd); return -1; }

    unsigned char resp[8];
    if (recv_full_fd(fd, resp, sizeof(resp)) < 0) { set_err(err, errlen, "proxy SOCKS4 não respondeu"); close(fd); return -1; }
    if (resp[0] != 0x00) {
        if (resp[0] == 0x05) {
            set_err(err, errlen, "esse proxy fala SOCKS5, não SOCKS4: use socks5:// na mesma porta");
        } else if (resp[0] >= 0x20 && resp[0] < 0x7F) {
            char amostra[17];
            size_t n = 0;
            for (; n < 16 && n < sizeof(resp); n++) {
                if (resp[n] < 0x20 || resp[n] >= 0x7F) break;
                amostra[n] = (char)resp[n];
            }
            amostra[n] = 0;
            set_err(err, errlen, "o proxy não é SOCKS4 (respondeu \"%s\"): use socks5:// ou http://", amostra);
        } else {
            set_err(err, errlen, "resposta SOCKS4 inesperada (0x%02x): use socks5:// ou http://", resp[0]);
        }
        close(fd);
        return -1;
    }
    if (resp[1] != 0x5A) { set_err(err, errlen, "proxy SOCKS4 recusou o destino (código %d)", resp[1]); close(fd); return -1; }
    return fd;
}

static int http_connect(const char *proxy_host, int proxy_port,
                        const char *user, const char *pass,
                        const char *target_host, int target_port,
                        char *err, size_t errlen) {
    int fd = tcp_connect(proxy_host, proxy_port, 15000, err, errlen);
    if (fd < 0) return -1;

    NSMutableString *req = [NSMutableString string];
    [req appendFormat:@"CONNECT %s:%d HTTP/1.1\r\n", target_host, target_port];
    [req appendFormat:@"Host: %s:%d\r\n", target_host, target_port];
    [req appendString:@"Proxy-Connection: keep-alive\r\n"];
    [req appendString:@"User-Agent: novaproxy/0.2\r\n"];
    if (user && user[0]) {
        NSString *creds = [NSString stringWithFormat:@"%s:%s", user, pass ? pass : ""];
        NSData *raw = [creds dataUsingEncoding:NSUTF8StringEncoding];
        NSString *b64 = [raw base64EncodedStringWithOptions:0];
        [req appendFormat:@"Proxy-Authorization: Bearer %@\r\n", b64];
    }
    [req appendString:@"\r\n"];

    const char *bytes = req.UTF8String;
    if (send_all_fd(fd, bytes, strlen(bytes)) < 0) {
        set_err(err, errlen, "não consegui enviar o CONNECT ao proxy HTTP");
        close(fd);
        return -1;
    }

    char resp[8192];
    size_t used = 0;
    while (used < sizeof(resp) - 1) {
        ssize_t r = recv(fd, resp + used, sizeof(resp) - 1 - used, 0);
        if (r <= 0) {
            set_err(err, errlen, "o proxy não respondeu ao CONNECT (a porta pode ser TLS): "
                                 "use http:// na porta 1000 ou socks5:// na 1002");
            close(fd);
            return -1;
        }
        used += (size_t)r;
        resp[used] = 0;
        if (strstr(resp, "\r\n\r\n")) break;
    }
    if (!strstr(resp, "\r\n\r\n")) { set_err(err, errlen, "resposta do proxy HTTP incompleta"); close(fd); return -1; }

    char *eol = strstr(resp, "\r\n");
    size_t line_len = eol ? (size_t)(eol - resp) : strlen(resp);
    char status[512];
    size_t cp = line_len < sizeof(status) - 1 ? line_len : sizeof(status) - 1;
    memcpy(status, resp, cp); status[cp] = 0;

    if (!strstr(status, " 200")) {
        set_err(err, errlen, "proxy HTTP recusou o CONNECT: %s", status);
        close(fd);
        return -1;
    }
    return fd;
}

int upstream_connect(const char *scheme,
                     const char *proxy_host, int proxy_port,
                     const char *user, const char *pass,
                     const char *target_host, int target_port,
                     char *err, size_t errlen) {
    const char *sch = (scheme && scheme[0]) ? scheme : "socks5";

    if (strcmp(sch, "socks5") == 0 || strcmp(sch, "socks5h") == 0) {
        return socks5_connect(proxy_host, proxy_port, user, pass, target_host, target_port, err, errlen);
    }
    if (strcmp(sch, "socks4a") == 0) {
        return socks4_connect(proxy_host, proxy_port, user, target_host, target_port, YES, err, errlen);
    }
    if (strcmp(sch, "socks4") == 0) {
        return socks4_connect(proxy_host, proxy_port, user, target_host, target_port, NO, err, errlen);
    }
    if (strcmp(sch, "http") == 0) {
        return http_connect(proxy_host, proxy_port, user, pass, target_host, target_port, err, errlen);
    }
    if (strcmp(sch, "https") == 0) {
        set_err(err, errlen, "esquema https (TLS até o proxy) ainda não é suportado nesta versão: "
                             "use http:// na porta 1000 ou socks5:// na 1002");
        return -1;
    }
    set_err(err, errlen, "esquema desconhecido: %s", sch);
    return -1;
}
