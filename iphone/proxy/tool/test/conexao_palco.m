#import "conexao_palco.h"
#import "../Upstream.h"
#import "../Socks5.h"

int conectar_upstream_pelo_palco(const PedidoDeConexao *p, char *err, size_t errlen) {
    ProxyMontante proxy = { p->esquema, { p->host, p->porta }, { p->usuario, p->senha } };
    return upstream_connect(proxy, (Endereco){ p->alvo_host, p->alvo_porta }, (Falha){ err, errlen });
}

int conectar_socks5_pelo_palco(const PedidoDeConexao *p, char *err, size_t errlen) {
    return socks5_connect((Endereco){ p->host, p->porta }, (Credencial){ p->usuario, p->senha },
                          (Endereco){ p->alvo_host, p->alvo_porta }, (Falha){ err, errlen });
}
