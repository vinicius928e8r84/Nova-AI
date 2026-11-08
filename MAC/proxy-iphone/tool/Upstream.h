#import <Foundation/Foundation.h>

// Abre um túnel TCP até target_host:target_port usando o proxy configurado,
// respeitando o esquema: socks5/socks5h, socks4/socks4a e http (CONNECT).
// Devolve o fd do túnel já aberto ou -1 e preenche err em português.
// https (TLS até o proxy) ainda não é suportado: devolve -1 com erro claro.
int upstream_connect(const char *scheme,
                     const char *proxy_host, int proxy_port,
                     const char *user, const char *pass,
                     const char *target_host, int target_port,
                     char *err, size_t errlen);
