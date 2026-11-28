#import <Foundation/Foundation.h>

typedef struct {
    const char *esquema;
    const char *host;
    int porta;
    const char *usuario;
    const char *senha;
    const char *alvo_host;
    int alvo_porta;
} PedidoDeConexao;

int conectar_upstream_pelo_palco(const PedidoDeConexao *pedido, char *err, size_t errlen);
int conectar_socks5_pelo_palco(const PedidoDeConexao *pedido, char *err, size_t errlen);
