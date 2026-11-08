#import "ProxyConfig.h"

static NSString *const kConfigPath = @"/var/jb/var/mobile/Library/Preferences/com.aquiles.novaproxy.json";

@implementation ProxyConfig

+ (NSString *)configPath { return kConfigPath; }

static BOOL SchemeSupported(NSString *s) {
    static NSSet *ok;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        ok = [NSSet setWithObjects:@"socks5", @"socks5h", @"socks4", @"socks4a", @"http", @"https", nil];
    });
    return [ok containsObject:s];
}

// Sem esquema na string, a porta é a única pista. 1000/3128/8080/8888 são portas
// clássicas de proxy HTTP; 1001 é o endpoint HTTPS da Evomi; o resto fica SOCKS5,
// que é o que o app sempre usou.
static NSString *SchemeForPort(int port) {
    switch (port) {
        case 1000:
        case 3128:
        case 8080:
        case 8888:
        case 8000:
            return @"http";
        case 1001:
            return @"https";
        default:
            return @"socks5";
    }
}

// Casa a string inteira com o padrão e devolve os grupos (nil se não casar).
static NSArray<NSString *> *Match(NSString *pattern, NSString *s) {
    NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
    NSTextCheckingResult *m = [re firstMatchInString:s options:0 range:NSMakeRange(0, s.length)];
    if (!m || m.range.length != s.length) return nil;
    NSMutableArray *g = [NSMutableArray array];
    for (NSUInteger i = 1; i < m.numberOfRanges; i++) {
        NSRange r = [m rangeAtIndex:i];
        [g addObject:r.location == NSNotFound ? @"" : [s substringWithRange:r]];
    }
    return g;
}

+ (instancetype)parse:(NSString *)raw error:(NSString **)error {
    NSString *s = [raw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (s.length == 0) { if (error) *error = @"proxy vazio"; return nil; }

    // Aspas e barra final sobrando são enfeite de colagem, não fazem parte da string.
    if (s.length >= 2) {
        unichar a = [s characterAtIndex:0], b = [s characterAtIndex:s.length - 1];
        if ((a == '"' && b == '"') || (a == '\'' && b == '\'') || (a == '`' && b == '`')) {
            s = [[s substringWithRange:NSMakeRange(1, s.length - 2)] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        }
    }
    while ([s hasSuffix:@"/"]) s = [s substringToIndex:s.length - 1];
    if (s.length == 0) { if (error) *error = @"proxy vazio"; return nil; }

    NSString *scheme = nil;
    NSRange sep = [s rangeOfString:@"://"];
    if (sep.location != NSNotFound) {
        scheme = [[s substringToIndex:sep.location] lowercaseString];
        s = [s substringFromIndex:NSMaxRange(sep)];
    }
    if (scheme && !SchemeSupported(scheme)) {
        if (error) *error = [NSString stringWithFormat:@"esquema não suportado: %@ (use socks5, socks4, http ou https)", scheme];
        return nil;
    }

    static NSString *const H = @"([A-Za-z0-9._-]{3,})";
    static NSString *const U = @"([^:@\\s]+)";
    NSString *host = nil, *portStr = nil, *user = @"", *pass = @"";
    NSArray<NSString *> *g;
    if ((g = Match([NSString stringWithFormat:@"%@:(\\d{1,5}):%@:(.+)", H, U], s))) {
        // formato Evomi: host:porta:usuario:senha (a senha pode ter ':' e '@')
        host = g[0]; portStr = g[1]; user = g[2]; pass = g[3];
    } else if ((g = Match([NSString stringWithFormat:@"%@:(.*)@%@:(\\d{1,5})", U, H], s))) {
        // usuario:senha@host:porta (último '@'; a senha pode ter ':' e '@')
        user = g[0]; pass = g[1]; host = g[2]; portStr = g[3];
    } else if ((g = Match([NSString stringWithFormat:@"%@:(\\d{1,5})@%@:(.+)", H, U], s))) {
        // ordem invertida da Evomi: host:porta@usuario:senha
        host = g[0]; portStr = g[1]; user = g[2]; pass = g[3];
    } else if ((g = Match([NSString stringWithFormat:@"%@:(\\d{1,5})", H], s))) {
        host = g[0]; portStr = g[1];
    } else {
        if (error) *error = @"não achei host e porta nesta string: use "
                            @"host:porta:usuario:senha, usuario:senha@host:porta, "
                            @"host:porta@usuario:senha ou host:porta (a porta só tem números)";
        return nil;
    }

    int port = [portStr intValue];
    if (port <= 0 || port > 65535) {
        if (error) *error = @"porta fora da faixa 1-65535";
        return nil;
    }

    BOOL guessed = NO;
    if (!scheme) { scheme = SchemeForPort(port); guessed = YES; }

    ProxyConfig *c = [ProxyConfig new];
    c.scheme = scheme;
    c.host = host;
    c.port = port;
    c.user = user;
    c.pass = pass;
    c.localPort = 8899;
    c.schemeGuessed = guessed;
    return c;
}

+ (instancetype)load {
    NSData *d = [NSData dataWithContentsOfFile:kConfigPath];
    if (!d) return nil;
    NSDictionary *j = [NSJSONSerialization JSONObjectWithData:d options:0 error:nil];
    if (![j isKindOfClass:[NSDictionary class]]) return nil;
    ProxyConfig *c = [ProxyConfig new];
    NSString *sch = [j[@"scheme"] isKindOfClass:[NSString class]] ? j[@"scheme"] : nil;
    c.scheme = (sch.length && SchemeSupported(sch)) ? sch : @"socks5";
    c.host = j[@"host"] ?: @"";
    c.port = [j[@"port"] intValue];
    c.user = j[@"user"] ?: @"";
    c.pass = j[@"pass"] ?: @"";
    c.localPort = j[@"localPort"] ? [j[@"localPort"] intValue] : 8899;
    if (c.host.length == 0 || c.port <= 0) return nil;
    return c;
}

- (BOOL)save:(NSString **)error {
    NSDictionary *j = @{ @"scheme": self.scheme ?: @"socks5",
                         @"host": self.host ?: @"",
                         @"port": @(self.port),
                         @"user": self.user ?: @"",
                         @"pass": self.pass ?: @"",
                         @"localPort": @(self.localPort) };
    NSData *d = [NSJSONSerialization dataWithJSONObject:j options:0 error:nil];
    NSString *dir = [kConfigPath stringByDeletingLastPathComponent];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    if (![d writeToFile:kConfigPath atomically:YES]) {
        if (error) *error = [NSString stringWithFormat:@"não consegui gravar %@", kConfigPath];
        return NO;
    }
    [[NSFileManager defaultManager] setAttributes:@{NSFilePosixPermissions: @0600}
                                     ofItemAtPath:kConfigPath error:nil];
    return YES;
}

@end
