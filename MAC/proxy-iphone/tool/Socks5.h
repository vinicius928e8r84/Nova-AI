#import <Foundation/Foundation.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

// Abre uma conexão TCP com target_host:target_port através do proxy SOCKS5
// (com autenticação usuário/senha quando user não for vazio).
// Devolve o fd ou -1 e preenche err.
int socks5_connect(const char *proxy_host, int proxy_port,
                   const char *user, const char *pass,
                   const char *target_host, int target_port,
                   char *err, size_t errlen);
