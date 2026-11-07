// Teste do ProxyConfig.parse no Mac:  ./teste/rodar.sh
#import "../ProxyConfig.h"
static int fails = 0;
static void ok(NSString *raw, NSString *host, int port, NSString *user, NSString *pass) {
    NSString *err = nil; ProxyConfig *c = [ProxyConfig parse:raw error:&err];
    BOOL good = c && [c.host isEqualToString:host] && c.port == port && [c.user isEqualToString:user] && [c.pass isEqualToString:pass];
    if (!good) { fails++; printf("FALHA (devia aceitar): %s -> %s\n", raw.UTF8String, c ? [NSString stringWithFormat:@"%@:%d", c.host, c.port].UTF8String : (err ?: @"?").UTF8String); }
}
static void bad(NSString *raw) {
    NSString *err = nil; ProxyConfig *c = [ProxyConfig parse:raw error:&err];
    if (c || !err.length) { fails++; printf("FALHA (devia recusar): %s -> %s\n", raw.UTF8String, c ? [NSString stringWithFormat:@"%@:%d", c.host, c.port].UTF8String : "sem erro"); }
}
int main(void) { @autoreleasepool {
    ok(@"socks5://h.exemplo.com:1002:usr:s3nh@_a-b", @"h.exemplo.com", 1002, @"usr", @"s3nh@_a-b");
    ok(@"socks5://h.exemplo.com:1002:usr:a:b:c", @"h.exemplo.com", 1002, @"usr", @"a:b:c");
    ok(@"socks5://usr:senha@h.exemplo.com:1002", @"h.exemplo.com", 1002, @"usr", @"senha");
    ok(@"usr:senha@h.exemplo.com:1002", @"h.exemplo.com", 1002, @"usr", @"senha");
    ok(@"socks5h://usr:se@nha@h.exemplo.com:65535", @"h.exemplo.com", 65535, @"usr", @"se@nha");
    ok(@"h.exemplo.com:1080", @"h.exemplo.com", 1080, @"", @"");
    ok(@"  1.2.3.4:1  ", @"1.2.3.4", 1, @"", @"");
    // formato trocado host:porta@usuario:senha: nunca pode virar proxy errada
    bad(@"h.exemplo.com:1002@usr:93MdZAAC_country-US_hardsession-X");
    bad(@"socks5://h.exemplo.com:1002@usr:senha");
    // porta não numérica / fora da faixa
    bad(@"h.exemplo.com:93abc"); bad(@"h.exemplo.com:0"); bad(@"h.exemplo.com:65536");
    bad(@"h.exemplo.com:-1"); bad(@"h.exemplo.com:1e3"); bad(@"h.exemplo.com: 80");
    bad(@"usr:senha@h.exemplo.com:12x"); bad(@"socks5://h.exemplo.com:12x:usr:senha");
    // sobras calladas antes: 3 campos (sem senha), extras depois do host:porta com '@'
    bad(@"h.exemplo.com:1002:usr");
    bad(@"usr:senha@h.exemplo.com:1002:extra");
    // host inválido, esquema não suportado, vazio, credencial sem ':'
    bad(@""); bad(@"   "); bad(@":1002"); bad(@"http://h.exemplo.com:1002"); bad(@"usr@h.exemplo.com:1002");
    bad(@"h ost.com:1002"); bad(@"h.exemplo.com");
    printf(fails ? "%d FALHA(S)\n" : "TODOS OS TESTES DO PARSER PASSARAM\n", fails);
    return fails ? 1 : 0;
} }
