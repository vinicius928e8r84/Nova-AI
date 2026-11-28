#import "roteiro_palco.h"
#include <pthread.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>

static int servidor = -1;
static int porta = 0;
static Roteiro *volatile atual = NULL;
static dispatch_semaphore_t concluido;

static int ouvir_no_loopback(int *porta_escolhida) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    int um = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &um, sizeof(um));
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(s, (struct sockaddr *)&a, sizeof(a)) < 0 || listen(s, 8) < 0) return -1;
    socklen_t l = sizeof(a);
    getsockname(s, (struct sockaddr *)&a, &l);
    *porta_escolhida = ntohs(a.sin_port);
    return s;
}

int porta_livre(void) {
    int p = 0;
    int s = ouvir_no_loopback(&p);
    close(s);
    return p;
}

static BOOL ler_passo(Soquete c, Roteiro *r, size_t quantidade) {
    size_t lidos = 0;
    while (lidos < quantidade) {
        ssize_t n = recv(c, r->recebido + r->recebido_tamanho + lidos, quantidade - lidos, 0);
        if (n <= 0) return NO;
        lidos += (size_t)n;
    }
    r->recebido_tamanho += lidos;
    return YES;
}

static BOOL executar_passo(Soquete c, Roteiro *r, const Passo *passo) {
    if (passo->ler && !ler_passo(c, r, passo->ler)) return NO;
    return !passo->tamanho || send(c, passo->responder, passo->tamanho, 0) > 0;
}

static void ecoar(Soquete c, Roteiro *r) {
    char b[256];
    ssize_t n;
    while ((n = recv(c, b, sizeof(b), 0)) > 0 && send(c, b, (size_t)n, 0) > 0) {
        if (r->eco_tamanho + (size_t)n <= sizeof(r->eco)) memcpy(r->eco + r->eco_tamanho, b, (size_t)n);
        r->eco_tamanho += (size_t)n;
    }
}

static void atender(Soquete c) {
    Roteiro *r = atual;
    BOOL seguiu = YES;
    for (size_t i = 0; seguiu && i < r->quantidade; i++) seguiu = executar_passo(c, r, &r->passos[i]);
    if (seguiu && r->ecoar) ecoar(c, r);
    close(c);
    dispatch_semaphore_signal(concluido);
}

static void *aceitar_sempre(void *arg) {
    (void)arg;
    for (;;) {
        int c = accept(servidor, NULL, NULL);
        if (c >= 0) atender(c);
    }
    return NULL;
}

int porta_do_servidor_de_roteiro(void) {
    if (servidor >= 0) return porta;
    concluido = dispatch_semaphore_create(0);
    servidor = ouvir_no_loopback(&porta);
    pthread_t th;
    pthread_create(&th, NULL, aceitar_sempre, NULL);
    pthread_detach(th);
    return porta;
}

void usar_roteiro(Roteiro *roteiro) {
    roteiro->recebido_tamanho = 0;
    roteiro->eco_tamanho = 0;
    atual = roteiro;
}

BOOL esperar_roteiro_concluido(void) {
    return dispatch_semaphore_wait(concluido, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0;
}

BOOL recebido_igual(const Roteiro *roteiro, const char *esperado, size_t tamanho) {
    return roteiro->recebido_tamanho == tamanho && memcmp(roteiro->recebido, esperado, tamanho) == 0;
}

BOOL eco_igual(const Roteiro *roteiro, const char *esperado, size_t tamanho) {
    return roteiro->eco_tamanho == tamanho && memcmp(roteiro->eco, esperado, tamanho) == 0;
}

static void falhar(const CenaDeRoteiro *cena, const char *motivo, const char *extra) {
    printf("FALHA: %s: %s %s\n", cena->nome, motivo, extra ?: "");
}

static int conferir_erro(const CenaDeRoteiro *cena, Soquete fd, const char *err) {
    if (!cena->erro) {
        if (fd >= 0) return 0;
        falhar(cena, "devia conectar", err);
        return 1;
    }
    if (fd >= 0) {
        falhar(cena, "devia recusar", NULL);
        return 1;
    }
    BOOL confere = cena->erro[0] ? strstr(err, cena->erro) != NULL : err[0] == 0;
    if (confere) return 0;
    falhar(cena, "o erro devia ser", err);
    return 1;
}

static int conferir_fluxo(const CenaDeRoteiro *cena, Soquete fd) {
    char volta[4] = {0};
    BOOL voltou = send(fd, "ping", 4, 0) == 4 && recv(fd, volta, 4, MSG_WAITALL) == 4;
    if (voltou && memcmp(volta, "ping", 4) == 0) return 0;
    falhar(cena, "o fluxo depois do aperto de mão desalinhou", NULL);
    return 1;
}

static int conferir_servidor(const CenaDeRoteiro *cena, const Roteiro *roteiro) {
    if (!esperar_roteiro_concluido()) {
        falhar(cena, "o servidor de mentira não terminou", NULL);
        return 1;
    }
    if (recebido_igual(roteiro, cena->enviado, cena->enviado_tamanho)) return 0;
    falhar(cena, "os bytes enviados ao proxy são outros", NULL);
    return 1;
}

static int executar_cena(const CenaDeRoteiro *cena, Conectar conectar) {
    Roteiro roteiro = { .passos = cena->passos, .quantidade = cena->quantidade, .ecoar = cena->erro == NULL };
    PedidoDeConexao pedido = cena->pedido;
    BOOL servida = pedido.porta == 0;
    if (servida) {
        pedido.porta = porta_do_servidor_de_roteiro();
        usar_roteiro(&roteiro);
    }
    char err[256] = {0};
    int fd = conectar(&pedido, err, sizeof(err));
    int falhas = conferir_erro(cena, fd, err);
    if (fd >= 0) {
        if (!falhas && !cena->erro) falhas += conferir_fluxo(cena, fd);
        close(fd);
    }
    return falhas + (servida ? conferir_servidor(cena, &roteiro) : 0);
}

int executar_cenas(const CenaDeRoteiro *cenas, size_t total, Conectar conectar) {
    int falhas = 0;
    for (size_t i = 0; i < total; i++) falhas += executar_cena(&cenas[i], conectar);
    return falhas;
}
