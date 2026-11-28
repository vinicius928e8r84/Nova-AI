#import "conexao_palco.h"
#import "../Upstream.h"
#import "../Socks5.h"

int conectar_upstream_pelo_palco(const PedidoDeConexao *p, char *err, size_t errlen) {
    return upstream_connect(p->esquema, p->host, p->porta, p->usuario, p->senha,
                            p->alvo_host, p->alvo_porta, err, errlen);
}

int conectar_socks5_pelo_palco(const PedidoDeConexao *p, char *err, size_t errlen) {
    return socks5_connect(p->host, p->porta, p->usuario, p->senha,
                          p->alvo_host, p->alvo_porta, err, errlen);
}
