#import "ProxyConfig.h"

static NSString *const kConfigPath = @"/var/jb/var/mobile/Library/Preferences/com.aquiles.novaproxy.json";

@implementation ProxyConfig

+ (NSString *)configPath { return kConfigPath; }

// Casa a string inteira com o padrão e devolve os grupos (nil se não casar).
static NSArray<NSString *> *Match(NSString *pattern, NSString *s) {
    NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
    NSTextCheckingResult *m = [re firstMatchInString:s options:0 range:NSMakeRange(0, s.length)];
    if (!m || m.range.length != s.length) return nil;
    NSMutableArray *g = [NSMutableArray array];
    for (NSUInteger i = 1; i < m.numberOfRanges; i++) [g addObject:[s substringWithRange:[m rangeAtIndex:i]]];
    return g;
}

+ (instancetype)parse:(NSString *)raw error:(NSString **)error {
    NSString *s = [raw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (s.length == 0) { if (error) *error = @"proxy vazio"; return nil; }

    NSString *scheme = @"socks5";
    NSRange sep = [s rangeOfString:@"://"];
    if (sep.location != NSNotFound) {
        scheme = [[s substringToIndex:sep.location] lowercaseString];
        s = [s substringFromIndex:sep.location + sep.length];
    }
    if (![scheme isEqualToString:@"socks5"] && ![scheme isEqualToString:@"socks5h"]) {
        if (error) *error = [NSString stringWithFormat:@"esquema não suportado: %@ (use socks5://)", scheme];
        return nil;
    }

    // Só aceita formatos inteiros e sem ambiguidade. Nada de ler "o que der" e
    // seguir: a porta só tem dígitos (1-65535) e não sobra texto no fim.
    static NSString *const H = @"([A-Za-z0-9._-]+)";
    NSString *host = nil, *portStr = nil, *user = @"", *pass = @"";
    NSArray<NSString *> *g;
    if ((g = Match([NSString stringWithFormat:@"%@:(\\d{1,5}):([^:@\\s]+):(.+)", H], s))) {
        // formato Evomi: host:porta:usuario:senha (a senha pode ter ':' e '@')
        host = g[0]; portStr = g[1]; user = g[2]; pass = g[3];
    } else if ((g = Match([NSString stringWithFormat:@"([^:@\\s]+):(.*)@%@:(\\d{1,5})", H], s))) {
        // usuario:senha@host:porta (usa o último '@'; a senha pode ter ':' e '@')
        user = g[0]; pass = g[1]; host = g[2]; portStr = g[3];
    } else if ((g = Match([NSString stringWithFormat:@"%@:(\\d{1,5})", H], s))) {
        host = g[0]; portStr = g[1];
    } else {
        if (error) *error = @"formato inválido: use socks5://host:porta:usuario:senha, "
                            @"usuario:senha@host:porta ou host:porta (a porta só tem números)";
        return nil;
    }

    int port = [portStr intValue];
    if (port <= 0 || port > 65535) {
        if (error) *error = @"porta fora da faixa 1-65535";
        return nil;
    }

    ProxyConfig *c = [ProxyConfig new];
    c.host = host;
    c.port = port;
    c.user = user;
    c.pass = pass;
    c.localPort = 8899;
    return c;
}

+ (instancetype)load {
    NSData *d = [NSData dataWithContentsOfFile:kConfigPath];
    if (!d) return nil;
    NSDictionary *j = [NSJSONSerialization JSONObjectWithData:d options:0 error:nil];
    if (![j isKindOfClass:[NSDictionary class]]) return nil;
    ProxyConfig *c = [ProxyConfig new];
    c.host = j[@"host"] ?: @"";
    c.port = [j[@"port"] intValue];
    c.user = j[@"user"] ?: @"";
    c.pass = j[@"pass"] ?: @"";
    c.localPort = j[@"localPort"] ? [j[@"localPort"] intValue] : 8899;
    if (c.host.length == 0 || c.port <= 0) return nil;
    return c;
}

- (BOOL)save:(NSString **)error {
    NSDictionary *j = @{ @"host": self.host ?: @"", @"port": @(self.port),
                         @"user": self.user ?: @"", @"pass": self.pass ?: @"",
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
