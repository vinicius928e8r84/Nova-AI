#import <Foundation/Foundation.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

typedef int Soquete;

typedef struct {
    const char *host;
    int porta;
} Endereco;

typedef struct {
    const char *usuario;
    const char *senha;
} Credencial;

typedef struct {
    char *texto;
    size_t capacidade;
} Falha;
