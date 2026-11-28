#import "Saida.h"

static BOOL saidaEmLinhas = NO;

void UsarSaidaEmLinhas(void) {
    saidaEmLinhas = YES;
}

static NSString *TextoDoNumero(NSNumber *numero) {
    if (CFGetTypeID((__bridge CFTypeRef)numero) != CFBooleanGetTypeID()) return numero.stringValue;
    return numero.boolValue ? @"yes" : @"no";
}

static NSString *TextoDoValor(id valor) {
    if ([valor isKindOfClass:[NSNull class]]) return @"";
    if ([valor isKindOfClass:[NSArray class]]) return [(NSArray *)valor componentsJoinedByString:@","];
    if ([valor isKindOfClass:[NSNumber class]]) return TextoDoNumero(valor);
    return [valor description];
}

static void ImprimirEmLinhas(NSDictionary *resposta) {
    for (NSString *chave in [resposta.allKeys sortedArrayUsingSelector:@selector(compare:)]) {
        printf("%s=%s\n", chave.UTF8String, TextoDoValor(resposta[chave]).UTF8String);
    }
    fflush(stdout);
}

static void ImprimirEmJSON(NSDictionary *resposta) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:resposta options:0 error:nil];
    if (!json) {
        fputs("{\"ok\":false,\"error\":\"json\"}\n", stdout);
        return;
    }
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

void ImprimirResposta(NSDictionary *resposta) {
    if (saidaEmLinhas) ImprimirEmLinhas(resposta);
    else ImprimirEmJSON(resposta);
}

NSDictionary *Falha(Mensagem mensagem) {
    return @{ @"ok": @NO, @"error": mensagem ?: @"erro" };
}

void ImprimirFalha(Mensagem mensagem) {
    ImprimirResposta(Falha(mensagem));
}
