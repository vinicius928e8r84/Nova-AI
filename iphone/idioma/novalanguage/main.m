#import "Comandos.h"
#import "Saida.h"
#import "Validacao.h"

static NSArray<NSString *> *ArgumentosDaLinhaDeComando(int quantidade, char **valores) {
    NSMutableArray<NSString *> *argumentos = [NSMutableArray array];
    for (int i = 1; i < quantidade; i++) [argumentos addObject:[NSString stringWithUTF8String:valores[i]]];
    return argumentos;
}

static Dominio DominioDaOpcao(Opcoes *opcoes) {
    return opcoes->dominio.length ? opcoes->dominio : @"global";
}

static int ExecutarLinhaDeComando(NSArray<NSString *> *argumentos) {
    NSString *comando = argumentos[0].lowercaseString;
    Opcoes opcoes = {};
    Mensagem erro = LerOpcoes([argumentos subarrayWithRange:NSMakeRange(1, argumentos.count - 1)], &opcoes);
    if (erro) {
        ImprimirFalha(erro);
        return 64;
    }
    Dominio dominio = DominioDaOpcao(&opcoes);
    if (!DominioValido(dominio)) {
        ImprimirFalha(@"domínio inválido (use global ou um bundle id)");
        return 64;
    }
    return ExecutarComando(comando, dominio, &opcoes);
}

__attribute__((visibility("default"))) int main(int argc, char **argv) {
    @autoreleasepool {
        NSArray<NSString *> *argumentos = ArgumentosDaLinhaDeComando(argc, argv);
        if (!argumentos.count) {
            ImprimirFalha(@"uso: novalanguage read|write|clear [--domain global|<bundle-id>]");
            return 64;
        }
        return ExecutarLinhaDeComando(argumentos);
    }
}
