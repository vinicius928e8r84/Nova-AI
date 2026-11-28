#import <Foundation/Foundation.h>
#include "Controle.m"

void MSHookMessageEx(Class classe, SEL seletor, IMP substituto, IMP *original) {}

static int falhas = 0;

static void conferir(NSString *nome, BOOL obtido, BOOL esperado) {
    BOOL ok = obtido == esperado;
    printf("%s %s\n", ok ? "ok" : "FALHOU", nome.UTF8String);
    if (!ok) falhas++;
}

static NSString *tokenDe(NSString *hex) {
    return [NSString stringWithFormat:@"/s/%@/frame.jpg", hex];
}

static NSString *repetir(NSString *texto, NSUInteger vezes) {
    return [@"" stringByPaddingToLength:texto.length * vezes withString:texto startingAtIndex:0];
}

static void caminhoDoToken(void) {
    NSString *hex = @"0123456789abcdef0123456789abcdef";
    conferir(@"token: 32 hexadecimais minúsculos", isHexTokenPath(tokenDe(hex)), YES);
    conferir(@"token: maiúsculas", isHexTokenPath(tokenDe(@"0123456789ABCDEF0123456789abcdef")), NO);
    conferir(@"token: 31 caracteres", isHexTokenPath(tokenDe([hex substringToIndex:31])), NO);
    conferir(@"token: 33 caracteres", isHexTokenPath(tokenDe([hex stringByAppendingString:@"0"])), NO);
    conferir(@"token: letra fora de a-f", isHexTokenPath(tokenDe(@"0123456789abcdef0123456789abcdeg")), NO);
    conferir(@"token: prefixo errado", isHexTokenPath([NSString stringWithFormat:@"/t/%@/frame.jpg", hex]), NO);
    conferir(@"token: sufixo errado", isHexTokenPath([NSString stringWithFormat:@"/s/%@/frame.png", hex]), NO);
    conferir(@"token: nulo", isHexTokenPath(nil), NO);
    conferir(@"token: não é texto", isHexTokenPath((NSString *)@42), NO);
}

static void caminhoDoSocket(void) {
    conferir(@"socket: em /var/tmp", isCameraSocketPath(@"/var/tmp/.nb-0123.sock"), YES);
    conferir(@"socket: em /var/run", isCameraSocketPath(@"/var/run/nb-0123.sock"), YES);
    conferir(@"socket: fora das pastas", isCameraSocketPath(@"/tmp/.nb-0123456789.sock"), NO);
    conferir(@"socket: com ..", isCameraSocketPath(@"/var/tmp/../etc/nb.sock"), NO);
    conferir(@"socket: com //", isCameraSocketPath(@"/var/tmp//nb-0123.sock"), NO);
    conferir(@"socket: 11 caracteres", isCameraSocketPath(@"/var/tmp/ab"), NO);
    conferir(@"socket: 12 caracteres", isCameraSocketPath(@"/var/tmp/abc"), YES);
    conferir(@"socket: 96 caracteres", isCameraSocketPath([@"/var/tmp/" stringByAppendingString:repetir(@"a", 87)]), YES);
    conferir(@"socket: 97 caracteres", isCameraSocketPath([@"/var/tmp/" stringByAppendingString:repetir(@"a", 88)]), NO);
    conferir(@"socket: nulo", isCameraSocketPath(nil), NO);
    conferir(@"socket: não é texto", isCameraSocketPath((NSString *)@42), NO);
}

static void concessao(void) {
    NSTimeInterval agora = [[NSDate date] timeIntervalSince1970];
    g_enabled = NO; g_faulted = NO; g_continuous = NO; g_expires = agora + 60;
    conferir(@"concessão: desligada", leaseValid(), NO);
    g_enabled = YES;
    conferir(@"concessão: ligada e dentro do prazo", leaseValid(), YES);
    g_expires = agora - 1;
    conferir(@"concessão: vencida", leaseValid(), NO);
    g_continuous = YES;
    conferir(@"concessão: contínua não vence", leaseValid(), YES);
    g_faulted = YES;
    conferir(@"concessão: com falha", leaseValid(), NO);
    g_faulted = NO; g_enabled = NO; g_continuous = NO; g_expires = 0;
}

int main(void) {
    @autoreleasepool {
        caminhoDoToken();
        caminhoDoSocket();
        concessao();
    }
    printf(falhas ? "PONTE: %d FALHAS\n" : "PONTE: TODOS OS TESTES PASSARAM\n", falhas);
    return falhas ? 1 : 0;
}
