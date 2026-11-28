#import "../ProxyConfig.h"
#import <objc/runtime.h>

typedef id (*ParseOriginal)(id, SEL, NSString *, NSString **);

static int chamadas = 0;

static int casoQuebrado(void) {
    const char *valor = getenv("NOVA_CASO_QUEBRADO");
    return valor ? atoi(valor) : -1;
}

static void registrarCaso(NSString *raw) {
    const char *caminho = getenv("NOVA_CASOS");
    FILE *arquivo = caminho ? fopen(caminho, "a") : NULL;
    if (!arquivo) return;
    fprintf(arquivo, "%s\n", raw.UTF8String);
    fclose(arquivo);
}

static id inverter(id real, NSString **error) {
    if (!real) return [ProxyConfig new];
    *error = @"quebrado de propósito";
    return nil;
}

__attribute__((constructor)) static void instalarPalco(void) {
    Method parse = class_getClassMethod([ProxyConfig class], @selector(parse:error:));
    ParseOriginal original = (ParseOriginal)method_getImplementation(parse);
    method_setImplementation(parse, imp_implementationWithBlock(^id(id classe, NSString *raw, NSString **error) {
        registrarCaso(raw);
        id real = original(classe, @selector(parse:error:), raw, error);
        return chamadas++ == casoQuebrado() ? inverter(real, error) : real;
    }));
}
