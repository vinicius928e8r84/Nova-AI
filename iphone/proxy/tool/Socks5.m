#import "Socks5.h"
#include <string.h>
#include <stdarg.h>
#include <errno.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <netdb.h>
#include <sys/time.h>

static void set_err(char *err, size_t len, const char *fmt, ...) {
    if (!err || len == 0) return;
    va_list ap; va_start(ap, fmt);
    vsnprintf(err, len, fmt, ap);
    va_end(ap);
}

static int wait_fd(int fd, short events, int timeout_ms) {
    struct pollfd p = { .fd = fd, .events = events };
    int r;
    do { r = poll(&p, 1, timeout_ms); } while (r < 0 && errno == EINTR);
    if (r <= 0) return -1;
    return 0;
}

static int connect_timeout(int fd, struct sockaddr *addr, socklen_t alen, int ms) {
    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    int r = connect(fd, addr, alen);
    if (r < 0 && errno != EINPROGRESS) return -1;
    if (r < 0) {
        if (wait_fd(fd, POLLOUT, ms) < 0) return -1;
        int soerr = 0; socklen_t sl = sizeof(soerr);
        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &soerr, &sl) < 0 || soerr != 0) return -1;
    }
    fcntl(fd, F_SETFL, flags);
    return 0;
}

static int send_all(int fd, const void *buf, size_t len) {
    const char *p = buf;
    while (len > 0) {
        ssize_t n = send(fd, p, len, 0);
        if (n <= 0) { if (errno == EINTR) continue; return -1; }
        p += n; len -= (size_t)n;
    }
    return 0;
}

static int recv_full(int fd, void *buf, size_t len) {
    char *p = buf;
    while (len > 0) {
        ssize_t n = recv(fd, p, len, 0);
        if (n <= 0) { if (n < 0 && errno == EINTR) continue; return -1; }
        p += n; len -= (size_t)n;
    }
    return 0;
}

int socks5_connect(const char *proxy_host, int proxy_port,
                   const char *user, const char *pass,
                   const char *target_host, int target_port,
                   char *err, size_t errlen) {
    struct addrinfo hints, *res = NULL;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    char portstr[8];
    snprintf(portstr, sizeof(portstr), "%d", proxy_port);
    int gai = getaddrinfo(proxy_host, portstr, &hints, &res);
    if (gai != 0 || !res) {
        set_err(err, errlen, "DNS do proxy falhou: %s", gai_strerror(gai));
        return -1;
    }

    int fd = -1;
    for (struct addrinfo *ai = res; ai; ai = ai->ai_next) {
        fd = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd < 0) continue;
        if (connect_timeout(fd, ai->ai_addr, ai->ai_addrlen, 10000) == 0) break;
        close(fd); fd = -1;
    }
    freeaddrinfo(res);
    if (fd < 0) {
        set_err(err, errlen, "não consegui conectar no proxy %s:%d", proxy_host, proxy_port);
        return -1;
    }

    struct timeval tv = { .tv_sec = 20, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    unsigned char buf[512];
    int have_auth = (user && user[0]);

    buf[0] = 0x05; buf[1] = 1; buf[2] = have_auth ? 0x02 : 0x00;
    if (send_all(fd, buf, 3) < 0) { set_err(err, errlen, "falha ao enviar saudação"); close(fd); return -1; }

    unsigned char reply[2];
    if (recv_full(fd, reply, 2) < 0 || reply[0] != 0x05) {
        set_err(err, errlen, "resposta inválida do SOCKS5"); close(fd); return -1;
    }
    if (reply[1] == 0x02) {
        if (!have_auth) { set_err(err, errlen, "proxy exige autenticação"); close(fd); return -1; }
        size_t ul = strlen(user), pl = strlen(pass);
        if (ul > 255 || pl > 255) { set_err(err, errlen, "credenciais longas demais"); close(fd); return -1; }
        unsigned char ab[513];
        size_t k = 0;
        ab[k++] = 0x01; ab[k++] = (unsigned char)ul;
        memcpy(ab + k, user, ul); k += ul;
        ab[k++] = (unsigned char)pl;
        memcpy(ab + k, pass, pl); k += pl;
        if (send_all(fd, ab, k) < 0 || recv_full(fd, reply, 2) < 0 || reply[1] != 0x00) {
            set_err(err, errlen, "autenticação recusada pelo proxy"); close(fd); return -1;
        }
    } else if (reply[1] != 0x00) {
        set_err(err, errlen, "método SOCKS5 não aceito (0x%02x)", reply[1]); close(fd); return -1;
    }

    memset(buf, 0, sizeof(buf));
    size_t n = 0;
    buf[n++] = 0x05; buf[n++] = 0x01; buf[n++] = 0x00;

    struct in_addr v4; struct in6_addr v6;
    if (inet_pton(AF_INET, target_host, &v4) == 1) {
        buf[n++] = 0x01; memcpy(buf + n, &v4, 4); n += 4;
    } else if (inet_pton(AF_INET6, target_host, &v6) == 1) {
        buf[n++] = 0x04; memcpy(buf + n, &v6, 16); n += 16;
    } else {
        size_t hl = strlen(target_host);
        if (hl > 255) { set_err(err, errlen, "host longo demais"); close(fd); return -1; }
        buf[n++] = 0x03; buf[n++] = (unsigned char)hl;
        memcpy(buf + n, target_host, hl); n += hl;
    }
    buf[n++] = (target_port >> 8) & 0xff;
    buf[n++] = target_port & 0xff;

    if (send_all(fd, buf, n) < 0) { set_err(err, errlen, "falha ao pedir conexão"); close(fd); return -1; }

    unsigned char head[4];
    if (recv_full(fd, head, 4) < 0 || head[0] != 0x05) {
        set_err(err, errlen, "sem resposta do SOCKS5"); close(fd); return -1;
    }
    if (head[1] != 0x00) {
        set_err(err, errlen, "proxy recusou a conexão (código %d)", head[1]); close(fd); return -1;
    }
    size_t skip = 0;
    if (head[3] == 0x01) skip = 4;
    else if (head[3] == 0x04) skip = 16;
    else if (head[3] == 0x03) {
        unsigned char l = 0;
        if (recv_full(fd, &l, 1) < 0) { close(fd); return -1; }
        skip = l;
    }
    unsigned char drain[260];
    if (skip > 0 && recv_full(fd, drain, skip) < 0) { close(fd); return -1; }
    if (recv_full(fd, drain, 2) < 0) { close(fd); return -1; }

    return fd;
}
