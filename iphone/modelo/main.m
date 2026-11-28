#import "Comandos.h"
#include <string.h>

static BOOL ComandoInformado(int quantidade, char **argumentos, const char *nome, int minimoDeArgumentos) {
    return quantidade >= minimoDeArgumentos && strcmp(argumentos[1], nome) == 0;
}

__attribute__((visibility("default"))) int main(int argc, char **argv) {
    @autoreleasepool {
        if (ComandoInformado(argc, argv, "set", 3)) return ComandoSet([NSString stringWithUTF8String:argv[2]]);
        if (ComandoInformado(argc, argv, "clear", 2)) return ComandoClear();
        if (ComandoInformado(argc, argv, "status", 2)) return ComandoStatus();
        MostrarUso();
        return 1;
    }
}
