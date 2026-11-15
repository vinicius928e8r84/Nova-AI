#import "ProxyConfig.h"

static NSString *const kConfigPath = @"/var/jb/var/mobile/Library/Preferences/com.aquiles.novaproxy.json";

@implementation ProxyConfig

+ (NSString *)configPath { return kConfigPath; }

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

    NSString *user = @"", *pass = @"", *hostPort = s;

    // usuario:senha@host:porta
    NSRange at = [s rangeOfString:@"@" options:NSBackwardsSearch];
    if (at.location != NSNotFound) {
        NSString *creds = [s substringToIndex:at.location];
        hostPort = [s substringFromIndex:at.location + 1];
        NSRange colon = [creds rangeOfString:@":"];
        if (colon.location == NSNotFound) { if (error) *error = @"credenciais sem ':'"; return nil; }
        user = [creds substringToIndex:colon.location];
        pass = [creds substringFromIndex:colon.location + 1];
    }

    NSMutableArray<NSString *> *parts = [[hostPort componentsSeparatedByString:@":"] mutableCopy];
    if (parts.count < 2) { if (error) *error = @"falta a porta"; return nil; }

    // formato Evomi: host:porta:usuario:senha (a senha pode conter ':')
    if (at.location == NSNotFound && parts.count >= 4) {
        hostPort = [NSString stringWithFormat:@"%@:%@", parts[0], parts[1]];
        user = parts[2];
        NSRange r = NSMakeRange(3, parts.count - 3);
        pass = [[parts subarrayWithRange:r] componentsJoinedByString:@":"];
        parts = [[hostPort componentsSeparatedByString:@":"] mutableCopy];
    }

    NSString *host = parts[0];
    int port = [parts[1] intValue];
    if (host.length == 0 || port <= 0 || port > 65535) {
        if (error) *error = @"host/porta inválidos";
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
