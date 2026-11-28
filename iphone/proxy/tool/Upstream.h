#import "Conexao.h"

typedef struct {
    const char *esquema;
    Endereco endereco;
    Credencial credencial;
} ProxyMontante;

int upstream_connect(ProxyMontante proxy, Endereco alvo, Falha falha);
