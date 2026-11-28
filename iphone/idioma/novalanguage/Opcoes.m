#import "Opcoes.h"
#import "Saida.h"

enum { ColunaDoArgumento, ColunaDoNomeLongo, ColunaDaMensagemSemValor };

static NSArray<NSString *> *OpcaoComValor(NSString *argumento) {
    for (NSArray<NSString *> *opcao in @[ @[ @"--domain", @"--domain", @"--domain sem valor" ],
                                         @[ @"-d", @"--domain", @"--domain sem valor" ],
                                         @[ @"--locale", @"--locale", @"--locale sem valor" ],
                                         @[ @"-l", @"--locale", @"--locale sem valor" ],
                                         @[ @"--format", @"--format", @"--format sem valor" ],
                                         @[ @"-f", @"--format", @"--format sem valor" ] ]) {
        if ([opcao[ColunaDoArgumento] isEqualToString:argumento]) return opcao;
    }
    return nil;
}

static Mensagem AplicarFormato(NSString *formato) {
    NSString *minusculo = formato.lowercaseString;
    if ([minusculo isEqualToString:@"lines"] || [minusculo isEqualToString:@"text"]) {
        UsarSaidaEmLinhas();
        return nil;
    }
    return [minusculo isEqualToString:@"json"] ? nil : @"--format inválido (json|lines)";
}

static Mensagem AplicarOpcaoComValor(Opcoes *opcoes, NSString *nomeLongo, NSString *valor) {
    if ([nomeLongo isEqualToString:@"--domain"]) {
        opcoes->dominio = valor;
        return nil;
    }
    if ([nomeLongo isEqualToString:@"--locale"]) {
        opcoes->locale = valor;
        return nil;
    }
    return AplicarFormato(valor);
}

static Mensagem LerOpcaoSemValor(Opcoes *opcoes, NSString *argumento) {
    if ([argumento isEqualToString:@"--clear-apps"]) opcoes->limparApps = YES;
    else if ([argumento isEqualToString:@"--no-clear-apps"]) opcoes->naoLimparApps = YES;
    else if ([argumento hasPrefix:@"--"]) return [NSString stringWithFormat:@"opção desconhecida: %@", argumento];
    else if (!opcoes->tag) opcoes->tag = argumento;
    return nil;
}

static Mensagem LerArgumento(NSArray<NSString *> *argumentos, NSUInteger *posicao, Opcoes *opcoes) {
    NSString *argumento = argumentos[*posicao];
    NSArray<NSString *> *opcao = OpcaoComValor(argumento);
    if (!opcao) return LerOpcaoSemValor(opcoes, argumento);
    if (*posicao + 1 >= argumentos.count) return opcao[ColunaDaMensagemSemValor];
    *posicao += 1;
    return AplicarOpcaoComValor(opcoes, opcao[ColunaDoNomeLongo], argumentos[*posicao]);
}

Mensagem LerOpcoes(NSArray<NSString *> *argumentos, Opcoes *opcoes) {
    for (NSUInteger posicao = 0; posicao < argumentos.count; posicao++) {
        Mensagem erro = LerArgumento(argumentos, &posicao, opcoes);
        if (erro) return erro;
    }
    return nil;
}
