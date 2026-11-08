#import <Foundation/Foundation.h>

// novalanguage — lê e grava o idioma preferido pelo store de preferências
// (CFPreferences), que é quem manda em tempo de execução.
//
// Por que existe: no iOS 16 não há `defaults` nem `plutil` no aparelho, e editar
// o .plist à mão não adianta (a autoridade é o cache do cfprefsd). A escrita que
// o time provou funcionar é esta: CFPreferencesSetValue + Synchronize, como
// usuário `mobile`, sem root.
//
// Uso:
//   novalanguage read  [--domain global|<bundle-id>]
//   novalanguage write <tag> [--domain global|<bundle-id>] [--locale <xx_YY>]
//   novalanguage clear [--domain global|<bundle-id>] [--locale <xx_YY>|-]
//   ... qualquer comando aceita --format json (padrão) | lines
//
// Sempre imprime uma linha JSON com o que ficou no store *depois* da operação
// (leitura de confirmação), nunca o que a gente pediu.

static NSArray<NSString *> *GlobalPrefsCandidates(void) {
    // A ordem importa: o mesmo domínio que o Security & Infra mediu funcionando.
    return @[ @"/var/mobile/Library/Preferences/.GlobalPreferences.plist" ];
}

static BOOL IsGlobal(NSString *d) {
    return [d isEqualToString:@"global"] || [d isEqualToString:@"system"] || [d isEqualToString:@"aparelho"];
}

static BOOL ValidTag(NSString *t) {
    // BCP-47 curto: idioma de 2-3 letras + subtags de 2-8 alfanuméricos.
    static NSRegularExpression *re;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        re = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$" options:0 error:nil];
    });
    if (t.length < 2 || t.length > 35) return NO;
    return [re numberOfMatchesInString:t options:0 range:NSMakeRange(0, t.length)] == 1;
}

static BOOL ValidLocale(NSString *l) {
    static NSRegularExpression *re;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        re = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z]{2,3}(_[A-Za-z0-9]{2,8})*$" options:0 error:nil];
    });
    if (l.length < 2 || l.length > 35) return NO;
    return [re numberOfMatchesInString:l options:0 range:NSMakeRange(0, l.length)] == 1;
}

static BOOL ValidBundle(NSString *d) {
    static NSRegularExpression *re;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        re = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9][A-Za-z0-9.-]{2,120}$" options:0 error:nil];
    });
    return [re numberOfMatchesInString:d options:0 range:NSMakeRange(0, d.length)] == 1;
}

static NSString *DomainArg(NSString *domain) {
    return domain.length ? domain : @"global";
}

static BOOL gLines = NO;   // --format lines: chave=valor, uma por linha

static void PrintJSON(NSDictionary *d) {
    if (gLines) {
        for (NSString *k in [d.allKeys sortedArrayUsingSelector:@selector(compare:)]) {
            id v = d[k];
            NSString *val;
            if ([v isKindOfClass:[NSNull class]]) val = @"";
            else if ([v isKindOfClass:[NSArray class]]) val = [(NSArray *)v componentsJoinedByString:@","];
            else if ([v isKindOfClass:[NSNumber class]]) {
                BOOL b = CFGetTypeID((__bridge CFTypeRef)v) == CFBooleanGetTypeID();
                val = b ? ([(NSNumber *)v boolValue] ? @"yes" : @"no") : [(NSNumber *)v stringValue];
            }
            else val = [v description];
            printf("%s=%s\n", k.UTF8String, val.UTF8String);
        }
        fflush(stdout);
        return;
    }
    NSData *j = [NSJSONSerialization dataWithJSONObject:d options:0 error:nil];
    if (!j) { fputs("{\"ok\":false,\"error\":\"json\"}\n", stdout); return; }
    fwrite(j.bytes, 1, j.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

static NSDictionary *Fail(NSString *msg) {
    return @{ @"ok": @NO, @"error": msg ?: @"erro" };
}

// Lê o valor atual do store. Devolve sempre um dicionário pronto para o JSON.
static NSDictionary *ReadState(NSString *domain) {
    BOOL global = IsGlobal(domain);
    if (!global && !ValidBundle(domain)) return Fail(@"domínio inválido");

    CFStringRef app = global ? kCFPreferencesAnyApplication : (__bridge CFStringRef)domain;
    CFPropertyListRef langs = CFPreferencesCopyValue(CFSTR("AppleLanguages"), app,
                                                     kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    CFPropertyListRef loc = CFPreferencesCopyValue(CFSTR("AppleLocale"), app,
                                                   kCFPreferencesCurrentUser, kCFPreferencesAnyHost);

    NSMutableArray<NSString *> *list = [NSMutableArray array];
    if (langs) {
        if (CFGetTypeID(langs) == CFArrayGetTypeID()) {
            for (id v in (__bridge NSArray *)langs) if ([v isKindOfClass:[NSString class]]) [list addObject:v];
        } else if (CFGetTypeID(langs) == CFStringGetTypeID()) {
            [list addObject:(__bridge NSString *)langs];
        }
    }
    NSString *locale = nil;
    if (loc && CFGetTypeID(loc) == CFStringGetTypeID()) locale = (__bridge NSString *)loc;

    NSMutableDictionary *out = [@{
        @"ok": @YES,
        @"domain": global ? @"global" : domain,
        @"language": list.count ? list.firstObject : [NSNull null],
        @"languages": list,
        @"locale": locale ?: [NSNull null],
        @"override": list.count ? @YES : @NO,
    } mutableCopy];

    // Informativo: o arquivo em disco só é reescrito quando o cfprefsd descarrega.
    // Se o store diz pt-BR e o disco diz en-US, um desligamento limpo volta ao
    // idioma do disco — é o risco que o time levantou hoje.
    if (global) {
        for (NSString *p in GlobalPrefsCandidates()) {
            NSDictionary *plist = [NSDictionary dictionaryWithContentsOfFile:p];
            if (![plist isKindOfClass:[NSDictionary class]]) continue;
            id dl = plist[@"AppleLanguages"];
            NSString *diskLang = nil;
            if ([dl isKindOfClass:[NSArray class]] && [dl count]) diskLang = [dl firstObject];
            else if ([dl isKindOfClass:[NSString class]]) diskLang = dl;
            out[@"disk"] = diskLang ?: [NSNull null];
            out[@"diskPath"] = p;
            out[@"diskMatches"] = diskLang ? @([list.firstObject isEqualToString:diskLang]) : [NSNull null];
            break;
        }
    }
    if (langs) CFRelease(langs);
    if (loc) CFRelease(loc);
    return out;
}

int main(int argc, char **argv) { @autoreleasepool {
    NSMutableArray<NSString *> *args = [NSMutableArray array];
    for (int i = 1; i < argc; i++) [args addObject:[NSString stringWithUTF8String:argv[i]]];
    if (!args.count) {
        PrintJSON(Fail(@"uso: novalanguage read|write|clear [--domain global|<bundle-id>]"));
        return 64;
    }

    NSString *cmd = args[0].lowercaseString;
    NSMutableArray<NSString *> *rest = [[args subarrayWithRange:NSMakeRange(1, args.count - 1)] mutableCopy];
    NSString *domain = nil, *locale = nil, *tag = nil;
    NSMutableArray<NSString *> *positional = [NSMutableArray array];

    for (NSUInteger i = 0; i < rest.count; i++) {
        NSString *a = rest[i];
        if ([a isEqualToString:@"--domain"] || [a isEqualToString:@"-d"]) {
            if (i + 1 >= rest.count) { PrintJSON(Fail(@"--domain sem valor")); return 64; }
            domain = rest[++i];
        } else if ([a isEqualToString:@"--locale"] || [a isEqualToString:@"-l"]) {
            if (i + 1 >= rest.count) { PrintJSON(Fail(@"--locale sem valor")); return 64; }
            locale = rest[++i];
        } else if ([a isEqualToString:@"--format"] || [a isEqualToString:@"-f"]) {
            if (i + 1 >= rest.count) { PrintJSON(Fail(@"--format sem valor")); return 64; }
            NSString *f = rest[++i].lowercaseString;
            if ([f isEqualToString:@"lines"] || [f isEqualToString:@"text"]) gLines = YES;
            else if (![f isEqualToString:@"json"]) { PrintJSON(Fail(@"--format inválido (json|lines)")); return 64; }
        } else if ([a hasPrefix:@"--"]) {
            PrintJSON(Fail([NSString stringWithFormat:@"opção desconhecida: %@", a]));
            return 64;
        } else {
            [positional addObject:a];
        }
    }
    if (positional.count) tag = positional[0];
    domain = DomainArg(domain);
    if (locale && [locale isEqualToString:@"auto"]) locale = nil;   // "auto" = não mexer no locale

    BOOL global = IsGlobal(domain);
    if (!global && !ValidBundle(domain)) { PrintJSON(Fail(@"domínio inválido (use global ou um bundle id)")); return 64; }

    CFStringRef app = global ? kCFPreferencesAnyApplication : (__bridge CFStringRef)domain;

    if ([cmd isEqualToString:@"read"]) {
        PrintJSON(ReadState(domain));
        return 0;
    }

    if ([cmd isEqualToString:@"clear"]) {
        // Remove o override de idioma. Com --locale <valor> devolve o AppleLocale;
        // com --locale - remove o AppleLocale (volta ao padrão do sistema).
        CFPreferencesSetValue(CFSTR("AppleLanguages"), NULL, app,
                              kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        if (locale && [locale isEqualToString:@"-"]) {
            CFPreferencesSetValue(CFSTR("AppleLocale"), NULL, app,
                                  kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        } else if (locale.length) {
            if (!ValidLocale(locale)) { PrintJSON(Fail([NSString stringWithFormat:@"locale inválido: %@", locale])); return 64; }
            CFPreferencesSetValue(CFSTR("AppleLocale"), (__bridge CFPropertyListRef)locale, app,
                                  kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        }
        BOOL synced = CFPreferencesSynchronize(app, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        NSMutableDictionary *out = [ReadState(domain) mutableCopy];
        out[@"synced"] = @(synced);
        out[@"cleared"] = @YES;
        PrintJSON(out);
        return synced ? 0 : 1;
    }

    if ([cmd isEqualToString:@"write"]) {
        if (!tag.length) { PrintJSON(Fail(@"falta o idioma (ex.: pt-BR)")); return 64; }
        if (!ValidTag(tag)) { PrintJSON(Fail([NSString stringWithFormat:@"idioma inválido: %@", tag])); return 64; }
        if (locale && ![locale isEqualToString:@"-"] && !ValidLocale(locale)) { PrintJSON(Fail([NSString stringWithFormat:@"locale inválido: %@", locale])); return 64; }

        CFPreferencesSetValue(CFSTR("AppleLanguages"), (__bridge CFPropertyListRef)@[ tag ], app,
                              kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        if (locale.length) {
            CFPreferencesSetValue(CFSTR("AppleLocale"), (__bridge CFPropertyListRef)locale, app,
                                  kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
        }
        BOOL synced = CFPreferencesSynchronize(app, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);

        NSMutableDictionary *out = [ReadState(domain) mutableCopy];
        out[@"synced"] = @(synced);
        out[@"requested"] = tag;
        // confirmation é o que veio do store depois de gravar, não o pedido.
        out[@"confirmed"] = [tag isEqual:(out[@"language"] ?: [NSNull null])] ? @YES : @NO;
        PrintJSON(out);
        return ([out[@"confirmed"] boolValue] && synced) ? 0 : 1;
    }

    PrintJSON(Fail([NSString stringWithFormat:@"comando desconhecido: %@", cmd]));
    return 64;
} }
