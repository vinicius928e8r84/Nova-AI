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

typedef struct {
    const char *usuario;
    Endereco alvo;
    BOOL dns_remoto;
} DestinoSocks4;

typedef int (*Conector)(ProxyMontante proxy, Endereco alvo, Falha falha);

static void escrever_falha(Falha falha, const char *fmt, ...) {
    if (!falha.texto || falha.capacidade == 0) return;
    va_list ap; va_start(ap, fmt);
    vsnprintf(falha.texto, falha.capacidade, fmt, ap);
    va_end(ap);
}

static int send_all_fd(Soquete fd, const void *buf, size_t len) {
    const char *p = buf;
    while (len > 0) {
        ssize_t n = send(fd, p, len, 0);
        if (n <= 0) { if (errno == EINTR) continue; return -1; }
        p += n; len -= (size_t)n;
    }
    return 0;
}

static int recv_full_fd(Soquete fd, void *buf, size_t len) {
    char *p = buf;
    while (len > 0) {
        ssize_t n = recv(fd, p, len, 0);
        if (n <= 0) { if (n < 0 && errno == EINTR) continue; return -1; }
        p += n; len -= (size_t)n;
    }
    return 0;
}

static int resolver(Endereco destino, struct addrinfo **res, Falha falha) {
    char portstr[16];
    snprintf(portstr, sizeof(portstr), "%d", destino.porta);
    struct addrinfo hints = {0};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    int gai = getaddrinfo(destino.host, portstr, &hints, res);
    if (gai != 0 || !*res) {
        escrever_falha(falha, "não resolvi %s: %s", destino.host, gai_strerror(gai));
        return -1;
    }
    return 0;
}

static int abrir_socket(struct addrinfo *res, Falha falha) {
    int fd = socket(res->ai_family, SOCK_STREAM, 0);
    if (fd >= 0) return fd;
    freeaddrinfo(res);
    escrever_falha(falha, "socket: %s", strerror(errno));
    return -1;
}

static int conectar_sem_bloquear(Soquete fd, struct addrinfo *res) {
    int r = connect(fd, res->ai_addr, res->ai_addrlen);
    freeaddrinfo(res);
    return r;
}

static int esperar_escrita(Soquete fd, int timeout_ms) {
    struct pollfd p = { .fd = fd, .events = POLLOUT };
    int pr;
    do { pr = poll(&p, 1, timeout_ms); } while (pr < 0 && errno == EINTR);
    return pr;
}

static int terminar_conexao_pendente(Soquete fd, Endereco destino, int timeout_ms, Falha falha) {
    if (esperar_escrita(fd, timeout_ms) <= 0) {
        escrever_falha(falha, "timeout conectando em %s:%d", destino.host, destino.porta);
        return -1;
    }
    int soerr = 0; socklen_t sl = sizeof(soerr);
    if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &soerr, &sl) < 0 || soerr != 0) {
        escrever_falha(falha, "não conectei em %s:%d: %s", destino.host, destino.porta, strerror(soerr ? soerr : errno));
        return -1;
    }
    return 0;
}

static void ajustar_socket(Soquete fd, int timeout_ms) {
    struct timeval tv = { .tv_sec = timeout_ms / 1000, .tv_usec = (timeout_ms % 1000) * 1000 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    int one = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
}

static int tcp_connect(Endereco destino, int timeout_ms, Falha falha) {
    struct addrinfo *res = NULL;
    if (resolver(destino, &res, falha) < 0) return -1;
    int fd = abrir_socket(res, falha);
    if (fd < 0) return -1;

    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    int r = conectar_sem_bloquear(fd, res);
    if (r < 0 && errno != EINPROGRESS) {
        escrever_falha(falha, "não conectei em %s:%d: %s", destino.host, destino.porta, strerror(errno));
        close(fd);
        return -1;
    }
    if (r < 0 && terminar_conexao_pendente(fd, destino, timeout_ms, falha) < 0) {
        close(fd);
        return -1;
    }
    fcntl(fd, F_SETFL, flags);
    ajustar_socket(fd, timeout_ms);
    return fd;
}

static int resolver_ipv4(const char *host, struct in_addr *in, Falha falha) {
    if (inet_pton(AF_INET, host, in) == 1) return 0;
    struct addrinfo hints = {0}, *res = NULL;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    int r = getaddrinfo(host, NULL, &hints, &res);
    if (r != 0 || !res) {
        if (res) freeaddrinfo(res);
        escrever_falha(falha, "SOCKS4 precisa de IPv4: use socks4a:// para mandar o nome %s", host);
        return -1;
    }
    *in = ((struct sockaddr_in *)res->ai_addr)->sin_addr;
    freeaddrinfo(res);
    return 0;
}

static size_t anexar_ip(unsigned char *req, size_t n, DestinoSocks4 destino, Falha falha) {
    if (destino.dns_remoto) {
        req[n++] = 0; req[n++] = 0; req[n++] = 0; req[n++] = 1;
        return n;
    }
    struct in_addr in;
    if (resolver_ipv4(destino.alvo.host, &in, falha) < 0) return 0;
    memcpy(req + n, &in.s_addr, 4);
    return n + 4;
}

static size_t anexar_texto(unsigned char *req, size_t n, const char *texto) {
    size_t tamanho = strlen(texto);
    if (tamanho > 500) tamanho = 500;
    memcpy(req + n, texto, tamanho);
    req[n + tamanho] = 0;
    return n + tamanho + 1;
}

static size_t montar_pedido_socks4(unsigned char *req, DestinoSocks4 destino, Falha falha) {
    size_t n = 0;
    req[n++] = 0x04;
    req[n++] = 0x01;
    req[n++] = (unsigned char)((destino.alvo.porta >> 8) & 0xFF);
    req[n++] = (unsigned char)(destino.alvo.porta & 0xFF);
    n = anexar_ip(req, n, destino, falha);
    if (n == 0) return 0;
    n = anexar_texto(req, n, (destino.usuario && destino.usuario[0]) ? destino.usuario : "");
    if (destino.dns_remoto) n = anexar_texto(req, n, destino.alvo.host);
    return n;
}

static void amostra_de_texto(const unsigned char *resp, size_t tamanho, char *amostra) {
    size_t n = 0;
    for (; n < 16 && n < tamanho; n++) {
        if (resp[n] < 0x20 || resp[n] >= 0x7F) break;
        amostra[n] = (char)resp[n];
    }
    amostra[n] = 0;
}

static void explicar_resposta_socks4(const unsigned char *resp, size_t tamanho, Falha falha) {
    if (resp[0] == 0x05) {
        escrever_falha(falha, "esse proxy fala SOCKS5, não SOCKS4: use socks5:// na mesma porta");
    } else if (resp[0] >= 0x20 && resp[0] < 0x7F) {
        char amostra[17];
        amostra_de_texto(resp, tamanho, amostra);
        escrever_falha(falha, "o proxy não é SOCKS4 (respondeu \"%s\"): use socks5:// ou http://", amostra);
    } else {
        escrever_falha(falha, "resposta SOCKS4 inesperada (0x%02x): use socks5:// ou http://", resp[0]);
    }
}

static int ler_resposta_socks4(Soquete fd, Falha falha) {
    unsigned char resp[8];
    if (recv_full_fd(fd, resp, sizeof(resp)) < 0) { escrever_falha(falha, "proxy SOCKS4 não respondeu"); return -1; }
    if (resp[0] != 0x00) {
        explicar_resposta_socks4(resp, sizeof(resp), falha);
        return -1;
    }
    if (resp[1] != 0x5A) { escrever_falha(falha, "proxy SOCKS4 recusou o destino (código %d)", resp[1]); return -1; }
    return 0;
}

static int negociar_socks4(Soquete fd, DestinoSocks4 destino, Falha falha) {
    unsigned char req[1024];
    size_t n = montar_pedido_socks4(req, destino, falha);
    if (n == 0) return -1;
    if (send_all_fd(fd, req, n) < 0) { escrever_falha(falha, "não consegui enviar o pedido SOCKS4"); return -1; }
    return ler_resposta_socks4(fd, falha);
}

static int socks4_connect(ProxyMontante proxy, DestinoSocks4 destino, Falha falha) {
    int fd = tcp_connect(proxy.endereco, 15000, falha);
    if (fd < 0) return -1;
    if (negociar_socks4(fd, destino, falha) < 0) {
        close(fd);
        return -1;
    }
    return fd;
}

static NSString *cabecalho_de_login(Credencial credencial) {
    NSString *creds = [NSString stringWithFormat:@"%s:%s", credencial.usuario, credencial.senha ? credencial.senha : ""];
    NSData *raw = [creds dataUsingEncoding:NSUTF8StringEncoding];
    NSString *b64 = [raw base64EncodedStringWithOptions:0];
    return [NSString stringWithFormat:@"Proxy-Authorization: Basic %@\r\n", b64];
}

static NSString *pedido_connect(Credencial credencial, Endereco alvo) {
    NSMutableString *req = [NSMutableString string];
    [req appendFormat:@"CONNECT %s:%d HTTP/1.1\r\n", alvo.host, alvo.porta];
    [req appendFormat:@"Host: %s:%d\r\n", alvo.host, alvo.porta];
    [req appendString:@"Proxy-Connection: keep-alive\r\n"];
    [req appendString:@"User-Agent: novaproxy/0.2\r\n"];
    if (credencial.usuario && credencial.usuario[0]) [req appendString:cabecalho_de_login(credencial)];
    [req appendString:@"\r\n"];
    return req;
}

static int ler_cabecalho_http(Soquete fd, char *resp, size_t capacidade, Falha falha) {
    size_t used = 0;
    while (used < capacidade - 1) {
        ssize_t r = recv(fd, resp + used, capacidade - 1 - used, 0);
        if (r <= 0) {
            escrever_falha(falha, "o proxy não respondeu ao CONNECT (a porta pode ser TLS): "
                                  "use http:// na porta 1000 ou socks5:// na 1002");
            return -1;
        }
        used += (size_t)r;
        resp[used] = 0;
        if (strstr(resp, "\r\n\r\n")) return 0;
    }
    escrever_falha(falha, "resposta do proxy HTTP incompleta");
    return -1;
}

static void copiar_linha_de_status(const char *resp, char *status, size_t capacidade) {
    const char *eol = strstr(resp, "\r\n");
    size_t line_len = eol ? (size_t)(eol - resp) : strlen(resp);
    size_t cp = line_len < capacidade - 1 ? line_len : capacidade - 1;
    memcpy(status, resp, cp);
    status[cp] = 0;
}

static int negociar_http(Soquete fd, Credencial credencial, Endereco alvo, Falha falha) {
    NSString *pedido = pedido_connect(credencial, alvo);
    const char *bytes = pedido.UTF8String;
    if (send_all_fd(fd, bytes, strlen(bytes)) < 0) {
        escrever_falha(falha, "não consegui enviar o CONNECT ao proxy HTTP");
        return -1;
    }
    char resp[8192];
    if (ler_cabecalho_http(fd, resp, sizeof(resp), falha) < 0) return -1;
    char status[512];
    copiar_linha_de_status(resp, status, sizeof(status));
    if (!strstr(status, " 200")) {
        escrever_falha(falha, "proxy HTTP recusou o CONNECT: %s", status);
        return -1;
    }
    return 0;
}

static int http_connect(ProxyMontante proxy, Endereco alvo, Falha falha) {
    int fd = tcp_connect(proxy.endereco, 15000, falha);
    if (fd < 0) return -1;
    if (negociar_http(fd, proxy.credencial, alvo, falha) < 0) {
        close(fd);
        return -1;
    }
    return fd;
}

static int via_socks5(ProxyMontante proxy, Endereco alvo, Falha falha) {
    return socks5_connect(proxy.endereco, proxy.credencial, alvo, falha);
}

static int via_socks4a(ProxyMontante proxy, Endereco alvo, Falha falha) {
    return socks4_connect(proxy, (DestinoSocks4){ proxy.credencial.usuario, alvo, YES }, falha);
}

static int via_socks4(ProxyMontante proxy, Endereco alvo, Falha falha) {
    return socks4_connect(proxy, (DestinoSocks4){ proxy.credencial.usuario, alvo, NO }, falha);
}

static int via_http(ProxyMontante proxy, Endereco alvo, Falha falha) {
    return http_connect(proxy, alvo, falha);
}

static int via_https(ProxyMontante proxy, Endereco alvo, Falha falha) {
    escrever_falha(falha, "esquema https (TLS até o proxy) ainda não é suportado nesta versão: "
                          "use http:// na porta 1000 ou socks5:// na 1002");
    return -1;
}

static const struct {
    const char *esquema;
    Conector conectar;
} conectores[] = {
    { "socks5", via_socks5 },
    { "socks5h", via_socks5 },
    { "socks4a", via_socks4a },
    { "socks4", via_socks4 },
    { "http", via_http },
    { "https", via_https },
};

int upstream_connect(ProxyMontante proxy, Endereco alvo, Falha falha) {
    const char *sch = (proxy.esquema && proxy.esquema[0]) ? proxy.esquema : "socks5";
    for (size_t i = 0; i < sizeof(conectores) / sizeof(conectores[0]); i++) {
        if (strcmp(sch, conectores[i].esquema) == 0) return conectores[i].conectar(proxy, alvo, falha);
    }
    escrever_falha(falha, "esquema desconhecido: %s", sch);
    return -1;
}
