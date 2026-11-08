// Teste do ProxyConfig.parse no Mac:  ./teste/rodar.sh
// Confere que ele extrai SÓ o necessário (esquema, host, porta, usuário, senha)
// de qualquer uma das ordens aceitas, e que só recusa o que é inutilizável.
#import "../ProxyConfig.h"

static int fails = 0;

static void check(NSString *raw, NSString *scheme, NSString *host, int port, NSString *user, NSString *pass) {
    NSString *err = nil;
    ProxyConfig *c = [ProxyConfig parse:raw error:&err];
    BOOL good = c && [c.scheme isEqualToString:scheme] && [c.host isEqualToString:host]
                && c.port == port && [c.user isEqualToString:user] && [c.pass isEqualToString:pass];
    if (!good) {
        fails++;
        printf("FALHA (devia aceitar): %s -> %s\n", raw.UTF8String,
               c ? [NSString stringWithFormat:@"%@://%@:%d user=%@ pass=%@", c.scheme, c.host, c.port, c.user, c.pass].UTF8String
                 : (err ?: @"?").UTF8String);
    }
}

static void bad(NSString *raw) {
    NSString *err = nil;
    ProxyConfig *c = [ProxyConfig parse:raw error:&err];
    if (c || !err.length) {
        fails++;
        printf("FALHA (devia recusar): %s -> %s\n", raw.UTF8String,
               c ? [NSString stringWithFormat:@"%@://%@:%d", c.scheme, c.host, c.port].UTF8String : "sem erro");
    }
}

int main(void) { @autoreleasepool {
    // 1) ordem do painel da Evomi: host:porta:usuario:senha (senha com ':' e '@')
    check(@"socks5://h.exemplo.com:1002:usr:s3nh@_a-b", @"socks5", @"h.exemplo.com", 1002, @"usr", @"s3nh@_a-b");
    check(@"socks5://h.exemplo.com:1002:usr:a:b:c", @"socks5", @"h.exemplo.com", 1002, @"usr", @"a:b:c");
    check(@"h.exemplo.com:1002:usr:senha", @"socks5", @"h.exemplo.com", 1002, @"usr", @"senha");

    // 2) ordem URL: usuario:senha@host:porta
    check(@"socks5://usr:senha@h.exemplo.com:1002", @"socks5", @"h.exemplo.com", 1002, @"usr", @"senha");
    check(@"usr:senha@h.exemplo.com:1002", @"socks5", @"h.exemplo.com", 1002, @"usr", @"senha");
    check(@"socks5h://usr:se@nha@h.exemplo.com:65535", @"socks5h", @"h.exemplo.com", 65535, @"usr", @"se@nha");

    // 3) ordem invertida da Evomi: host:porta@usuario:senha (a que a tela recusava)
    check(@"h.exemplo.com:1002@usr:93MdZAAC_country-US_hardsession-X",
          @"socks5", @"h.exemplo.com", 1002, @"usr", @"93MdZAAC_country-US_hardsession-X");
    check(@"socks5://h.exemplo.com:1002@usr:senha", @"socks5", @"h.exemplo.com", 1002, @"usr", @"senha");

    // 4) sem credenciais
    check(@"h.exemplo.com:1080", @"socks5", @"h.exemplo.com", 1080, @"", @"");
    check(@"  1.2.3.4:1  ", @"socks5", @"1.2.3.4", 1, @"", @"");

    // 5) tipos de proxy
    check(@"http://h.exemplo.com:8080:usr:senha", @"http", @"h.exemplo.com", 8080, @"usr", @"senha");
    check(@"http://usr:senha@h.exemplo.com:3128", @"http", @"h.exemplo.com", 3128, @"usr", @"senha");
    check(@"socks4://usr:senha@h.exemplo.com:1080", @"socks4", @"h.exemplo.com", 1080, @"usr", @"senha");
    check(@"socks4a://h.exemplo.com:1080:usr:senha", @"socks4a", @"h.exemplo.com", 1080, @"usr", @"senha");
    check(@"Socks5://usr:senha@h.exemplo.com:1002", @"socks5", @"h.exemplo.com", 1002, @"usr", @"senha");

    // 6) sem esquema: a porta dá a pista (e o chamador avisa que foi dedução)
    check(@"h.exemplo.com:1000:usr:senha", @"http", @"h.exemplo.com", 1000, @"usr", @"senha");
    check(@"h.exemplo.com:8080", @"http", @"h.exemplo.com", 8080, @"", @"");
    check(@"h.exemplo.com:1001:usr:senha", @"https", @"h.exemplo.com", 1001, @"usr", @"senha");
    check(@"h.exemplo.com:1002", @"socks5", @"h.exemplo.com", 1002, @"", @"");

    // 7) enfeite de colagem é removido
    check(@"  \"h.exemplo.com:1002:usr:senha\"  ", @"socks5", @"h.exemplo.com", 1002, @"usr", @"senha");
    check(@"h.exemplo.com:1002:usr:senha/", @"socks5", @"h.exemplo.com", 1002, @"usr", @"senha");

    // 8) o que é inutilizável continua recusado
    bad(@"");
    bad(@"   ");
    bad(@"h.exemplo.com");
    bad(@":1002");
    bad(@"h ost.com:1002");
    bad(@"h.exemplo.com:0");
    bad(@"h.exemplo.com:65536");
    bad(@"h.exemplo.com:-1");
    bad(@"h.exemplo.com:12x");
    bad(@"h.exemplo.com:1e3");
    bad(@"socks5://h.exemplo.com:12x:usr:senha");
    bad(@"ftp://h.exemplo.com:1002:usr:senha");
    bad(@"socks5://usr@h.exemplo.com:1002");

    // ambiguidade conhecida: a ordem URL tem prioridade
    check(@"a.exemplo.com:1@b.exemplo.com:2", @"socks5", @"b.exemplo.com", 2, @"a.exemplo.com", @"1");

    printf(fails ? "%d FALHA(S)\n" : "PARSER: TODOS OS TESTES PASSARAM\n", fails);
    return fails ? 1 : 0;
} }
