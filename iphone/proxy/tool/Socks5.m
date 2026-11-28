#import "Socks5.h"
#include <string.h>
#include <stdarg.h>
#include <errno.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <netdb.h>
#include <sys/time.h>

static void escrever_falha(Falha falha, const char *fmt, ...) {
    if (!falha.texto || falha.capacidade == 0) return;
    va_list ap; va_start(ap, fmt);
    vsnprintf(falha.texto, falha.capacidade, fmt, ap);
    va_end(ap);
}

static int wait_fd(Soquete fd, short events, int timeout_ms) {
    struct pollfd p = { .fd = fd, .events = events };
    int r;
    do { r = poll(&p, 1, timeout_ms); } while (r < 0 && errno == EINTR);
    if (r <= 0) return -1;
    return 0;
}

static int conferir_conexao_pendente(Soquete fd, int ms) {
    if (wait_fd(fd, POLLOUT, ms) < 0) return -1;
    int soerr = 0; socklen_t sl = sizeof(soerr);
    if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &soerr, &sl) < 0 || soerr != 0) return -1;
    return 0;
}

static int connect_timeout(Soquete fd, struct sockaddr *addr, socklen_t alen, int ms) {
    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    int r = connect(fd, addr, alen);
    if (r < 0 && errno != EINPROGRESS) return -1;
    if (r < 0 && conferir_conexao_pendente(fd, ms) < 0) return -1;
    fcntl(fd, F_SETFL, flags);
    return 0;
}

static int send_all(Soquete fd, const void *buf, size_t len) {
    const char *p = buf;
    while (len > 0) {
        ssize_t n = send(fd, p, len, 0);
        if (n <= 0) { if (errno == EINTR) continue; return -1; }
        p += n; len -= (size_t)n;
    }
    return 0;
}

static int recv_full(Soquete fd, void *buf, size_t len) {
    char *p = buf;
    while (len > 0) {
        ssize_t n = recv(fd, p, len, 0);
        if (n <= 0) { if (n < 0 && errno == EINTR) continue; return -1; }
        p += n; len -= (size_t)n;
    }
    return 0;
}

static int primeiro_que_conecta(struct addrinfo *lista) {
    for (struct addrinfo *ai = lista; ai; ai = ai->ai_next) {
        int fd = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd < 0) continue;
        if (connect_timeout(fd, ai->ai_addr, ai->ai_addrlen, 10000) == 0) return fd;
        close(fd);
    }
    return -1;
}

static int conectar_ao_proxy(Endereco proxy, Falha falha) {
    struct addrinfo hints, *res = NULL;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    char portstr[8];
    snprintf(portstr, sizeof(portstr), "%d", proxy.porta);
    int gai = getaddrinfo(proxy.host, portstr, &hints, &res);
    if (gai != 0 || !res) {
        escrever_falha(falha, "DNS do proxy falhou: %s", gai_strerror(gai));
        return -1;
    }
    int fd = primeiro_que_conecta(res);
    freeaddrinfo(res);
    if (fd < 0) {
        escrever_falha(falha, "não consegui conectar no proxy %s:%d", proxy.host, proxy.porta);
        return -1;
    }
    return fd;
}

static void limitar_o_tempo(Soquete fd) {
    struct timeval tv = { .tv_sec = 20, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
}

static int tem_login(Credencial credencial) {
    return credencial.usuario && credencial.usuario[0];
}

static int login_aceito(Soquete fd, const unsigned char *pedido, size_t tamanho) {
    unsigned char reply[2];
    if (send_all(fd, pedido, tamanho) < 0) return 0;
    if (recv_full(fd, reply, 2) < 0) return 0;
    return reply[1] == 0x00;
}

static int autenticar(Soquete fd, Credencial credencial, Falha falha) {
    size_t ul = strlen(credencial.usuario), pl = strlen(credencial.senha);
    if (ul > 255 || pl > 255) { escrever_falha(falha, "credenciais longas demais"); return -1; }
    unsigned char ab[513];
    size_t k = 0;
    ab[k++] = 0x01; ab[k++] = (unsigned char)ul;
    memcpy(ab + k, credencial.usuario, ul); k += ul;
    ab[k++] = (unsigned char)pl;
    memcpy(ab + k, credencial.senha, pl); k += pl;
    if (login_aceito(fd, ab, k)) return 0;
    escrever_falha(falha, "autenticação recusada pelo proxy");
    return -1;
}

static int tratar_metodo(Soquete fd, unsigned char metodo, Credencial credencial, Falha falha) {
    if (metodo == 0x02) {
        if (!tem_login(credencial)) { escrever_falha(falha, "proxy exige autenticação"); return -1; }
        return autenticar(fd, credencial, falha);
    }
    if (metodo != 0x00) { escrever_falha(falha, "método SOCKS5 não aceito (0x%02x)", metodo); return -1; }
    return 0;
}

static int negociar_metodo(Soquete fd, Credencial credencial, Falha falha) {
    unsigned char buf[3] = { 0x05, 1, tem_login(credencial) ? 0x02 : 0x00 };
    if (send_all(fd, buf, 3) < 0) { escrever_falha(falha, "falha ao enviar saudação"); return -1; }
    unsigned char reply[2];
    if (recv_full(fd, reply, 2) < 0 || reply[0] != 0x05) {
        escrever_falha(falha, "resposta inválida do SOCKS5");
        return -1;
    }
    return tratar_metodo(fd, reply[1], credencial, falha);
}

static size_t anexar_endereco(unsigned char *buf, size_t n, const char *host) {
    struct in_addr v4; struct in6_addr v6;
    if (inet_pton(AF_INET, host, &v4) == 1) {
        buf[n++] = 0x01; memcpy(buf + n, &v4, 4);
        return n + 4;
    }
    if (inet_pton(AF_INET6, host, &v6) == 1) {
        buf[n++] = 0x04; memcpy(buf + n, &v6, 16);
        return n + 16;
    }
    size_t hl = strlen(host);
    if (hl > 255) return 0;
    buf[n++] = 0x03; buf[n++] = (unsigned char)hl;
    memcpy(buf + n, host, hl);
    return n + hl;
}

static size_t montar_pedido(unsigned char *buf, Endereco alvo) {
    memset(buf, 0, 512);
    size_t n = 0;
    buf[n++] = 0x05; buf[n++] = 0x01; buf[n++] = 0x00;
    n = anexar_endereco(buf, n, alvo.host);
    if (n == 0) return 0;
    buf[n++] = (alvo.porta >> 8) & 0xff;
    buf[n++] = alvo.porta & 0xff;
    return n;
}

static int pedir_conexao(Soquete fd, Endereco alvo, Falha falha) {
    unsigned char buf[512];
    size_t n = montar_pedido(buf, alvo);
    if (n == 0) { escrever_falha(falha, "host longo demais"); return -1; }
    if (send_all(fd, buf, n) < 0) { escrever_falha(falha, "falha ao pedir conexão"); return -1; }
    return 0;
}

static int descartar_endereco(Soquete fd, unsigned char tipo) {
    size_t skip = 0;
    if (tipo == 0x01) skip = 4;
    else if (tipo == 0x04) skip = 16;
    else if (tipo == 0x03) {
        unsigned char l = 0;
        if (recv_full(fd, &l, 1) < 0) return -1;
        skip = l;
    }
    unsigned char drain[260];
    if (skip > 0 && recv_full(fd, drain, skip) < 0) return -1;
    return recv_full(fd, drain, 2);
}

static int ler_resposta(Soquete fd, Falha falha) {
    unsigned char head[4];
    if (recv_full(fd, head, 4) < 0 || head[0] != 0x05) {
        escrever_falha(falha, "sem resposta do SOCKS5");
        return -1;
    }
    if (head[1] != 0x00) {
        escrever_falha(falha, "proxy recusou a conexão (código %d)", head[1]);
        return -1;
    }
    return descartar_endereco(fd, head[3]);
}

static int apertar_a_mao(Soquete fd, Credencial credencial, Endereco alvo, Falha falha) {
    if (negociar_metodo(fd, credencial, falha) < 0) return -1;
    if (pedir_conexao(fd, alvo, falha) < 0) return -1;
    return ler_resposta(fd, falha);
}

int socks5_connect(Endereco proxy, Credencial credencial, Endereco alvo, Falha falha) {
    int fd = conectar_ao_proxy(proxy, falha);
    if (fd < 0) return -1;
    limitar_o_tempo(fd);
    if (apertar_a_mao(fd, credencial, alvo, falha) < 0) {
        close(fd);
        return -1;
    }
    return fd;
}
