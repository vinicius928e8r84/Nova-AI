#import <Foundation/Foundation.h>
#import "conexao_palco.h"

#define BYTES(literal) literal, sizeof(literal) - 1
#define TAMANHO(literal) (sizeof(literal) - 1)

typedef struct {
    size_t ler;
    const char *responder;
    size_t tamanho;
} Passo;

typedef struct {
    const Passo *passos;
    size_t quantidade;
    BOOL ecoar;
    char recebido[8192];
    size_t recebido_tamanho;
    char eco[8192];
    size_t eco_tamanho;
} Roteiro;

int porta_do_servidor_de_roteiro(void);
void usar_roteiro(Roteiro *roteiro);
BOOL esperar_roteiro_concluido(void);
BOOL recebido_igual(const Roteiro *roteiro, const char *esperado, size_t tamanho);
BOOL eco_igual(const Roteiro *roteiro, const char *esperado, size_t tamanho);
int porta_livre(void);

typedef struct {
    const char *nome;
    PedidoDeConexao pedido;
    Passo passos[4];
    size_t quantidade;
    const char *erro;
    const char *enviado;
    size_t enviado_tamanho;
} CenaDeRoteiro;

typedef int (*Conectar)(const PedidoDeConexao *pedido, char *err, size_t errlen);

int executar_cenas(const CenaDeRoteiro *cenas, size_t total, Conectar conectar);
