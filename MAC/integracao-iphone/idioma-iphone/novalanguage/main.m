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

// Diretórios onde ficam as preferências dos apps. O valor VALE no cfprefsd; o
// arquivo serve só para DESCOBRIR quais apps têm idioma próprio (senão não há
// como saber o nome do domínio para limpar).
static NSArray<NSString *> *PrefsDirs(void) {
    const char *env = getenv("NOVALANGUAGE_PREFS_DIRS");
    if (env && env[0]) {
        NSMutableArray *dirs = [NSMutableArray array];
        for (NSString *d in [[NSString stringWithUTF8String:env] componentsSeparatedByString:@":"]) {
            if (d.length) [dirs addObject:d];
        }
        return dirs;
    }
    return @[ @"/var/mobile/Library/Preferences",
              @"/var/mobile/Containers/Data/Application",
              @"/var/mobile/Containers/Shared/AppGroup" ];
}

// Devolve os bundle ids que têm AppleLanguages próprio (lido do arquivo, só
// para descoberta; a limpeza é feita pelo CFPreferences).
static NSArray<NSString *> *ScanOverrides(void) {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSMutableSet<NSString *> *achados = [NSMutableSet set];
    for (NSString *dir in PrefsDirs()) {
        BOOL flat = [dir hasSuffix:@"/Preferences"] || [dir hasSuffix:@"/prefs"];
        if (!flat && [fm fileExistsAtPath:dir]) {
            for (NSString *f in [fm contentsOfDirectoryAtPath:dir error:nil]) if ([f hasSuffix:@".plist"]) { flat = YES; break; }
        }
        if (flat) {
            for (NSString *f in [fm contentsOfDirectoryAtPath:dir error:nil]) {
                if (![f hasSuffix:@".plist"] || [f hasPrefix:@"."]) continue;
                NSString *dominio = [f stringByDeletingPathExtension];
                NSDictionary *d = [NSDictionary dictionaryWithContentsOfFile:[dir stringByAppendingPathComponent:f]];
                if ([d isKindOfClass:[NSDictionary class]] && d[@"AppleLanguages"]) [achados addObject:dominio];
            }
            continue;
        }
        // Containers: <raiz>/<UUID>/Library/Preferences/*.plist
        for (NSString *uuid in [fm contentsOfDirectoryAtPath:dir error:nil]) {
            NSString *prefs = [[dir stringByAppendingPathComponent:uuid] stringByAppendingPathComponent:@"Library/Preferences"];
            NSDictionary *meta = [NSDictionary dictionaryWithContentsOfFile:
                                  [[dir stringByAppendingPathComponent:uuid] stringByAppendingPathComponent:@".com.apple.mobile_container_manager.metadata.plist"]];
            NSString *bundleID = [meta isKindOfClass:[NSDictionary class]] ? meta[@"MCMMetadataIdentifier"] : nil;
            if (![bundleID isKindOfClass:[NSString class]] || !bundleID.length) bundleID = uuid;
            for (NSString *f in [fm contentsOfDirectoryAtPath:prefs error:nil]) {
                if (![f hasSuffix:@".plist"]) continue;
                NSDictionary *d = [NSDictionary dictionaryWithContentsOfFile:[prefs stringByAppendingPathComponent:f]];
                if ([d isKindOfClass:[NSDictionary class]] && d[@"AppleLanguages"]) [achados addObject:bundleID];
            }
        }
    }
    return [achados.allObjects sortedArrayUsingSelector:@selector(compare:)];
}

// "pt-BR" -> "pt_BR"; sem região devolve nil (não mexe no AppleLocale).
static NSString *AutoLocale(NSString *tag) {
    NSArray<NSString *> *partes = [tag componentsSeparatedByString:@"-"];
    if (partes.count < 2) return nil;
    NSMutableArray *out = [NSMutableArray arrayWithObject:partes[0]];
    for (NSUInteger i = 1; i < partes.count; i++) [out addObject:[partes[i] uppercaseString]];
    return [out componentsJoinedByString:@"_"];
}

// O domínio global de verdade é kCFPreferencesAnyApplication. Para os testes no
// Mac existir um desvio (NOVALANGUAGE_GLOBAL_DOMAIN) evita escrever nas
// preferências reais da máquina — no aparelho a variável não existe.
static CFStringRef GlobalDomain(void) {
    static NSString *override;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        const char *e = getenv("NOVALANGUAGE_GLOBAL_DOMAIN");
        if (e && e[0]) override = [NSString stringWithUTF8String:e];
    });
    return override ? (__bridge CFStringRef)override : kCFPreferencesAnyApplication;
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

    CFStringRef app = global ? GlobalDomain() : (__bridge CFStringRef)domain;
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
    BOOL clearApps = NO, noClearApps = NO;
    NSMutableArray<NSString *> *positional = [NSMutableArray array];

    for (NSUInteger i = 0; i < rest.count; i++) {
        NSString *a = rest[i];
        if ([a isEqualToString:@"--domain"] || [a isEqualToString:@"-d"]) {
            if (i + 1 >= rest.count) { PrintJSON(Fail(@"--domain sem valor")); return 64; }
            domain = rest[++i];
        } else if ([a isEqualToString:@"--clear-apps"]) {
            clearApps = YES;
        } else if ([a isEqualToString:@"--no-clear-apps"]) {
            noClearApps = YES;
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

    BOOL global = IsGlobal(domain);
    if (!global && !ValidBundle(domain)) { PrintJSON(Fail(@"domínio inválido (use global ou um bundle id)")); return 64; }

    CFStringRef app = global ? GlobalDomain() : (__bridge CFStringRef)domain;

    if ([cmd isEqualToString:@"scan"]) {
        // Quais apps têm idioma PRÓPRIO. Sem isto, trocar o global não alcança
        // esses apps: cada um continua no idioma que gravou para si.
        NSArray<NSString *> *apps = ScanOverrides();
        PrintJSON(@{ @"ok": @YES, @"count": @(apps.count), @"apps": apps });
        return 0;
    }

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
        // auto = derivar o AppleLocale do próprio idioma (pt-BR -> pt_BR), para
        // não ficar com texto em português e data/número no padrão americano.
        BOOL localeAuto = NO;
        if ([locale isEqualToString:@"auto"]) { locale = AutoLocale(tag); localeAuto = YES; }
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
        if (localeAuto) out[@"localeAuto"] = @YES;

        // "aparelho inteiro e todos os apps": app com idioma próprio ignora o
        // global, então limpa esses overrides (só com --clear-apps explícito).
        if (global && clearApps && !noClearApps) {
            NSMutableArray<NSString *> *limpos = [NSMutableArray array];
            NSMutableArray<NSString *> *falhas = [NSMutableArray array];
            for (NSString *bundle in ScanOverrides()) {
                CFStringRef app2 = (__bridge CFStringRef)bundle;
                // Guarda o idioma que o app tinha antes de limpar: é isto que
                // permite o revert devolver cada app ao que era.
                CFPropertyListRef atual = CFPreferencesCopyValue(CFSTR("AppleLanguages"), app2,
                                                                 kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
                NSString *antes = @"";
                if (atual && CFGetTypeID(atual) == CFArrayGetTypeID()) {
                    NSArray *arr = (__bridge NSArray *)atual;
                    if (arr.count && [arr[0] isKindOfClass:[NSString class]]) antes = arr[0];
                } else if (atual && CFGetTypeID(atual) == CFStringGetTypeID()) {
                    antes = (__bridge NSString *)atual;
                }
                if (atual) CFRelease(atual);

                CFPreferencesSetValue(CFSTR("AppleLanguages"), NULL, app2,
                                      kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
                if (CFPreferencesSynchronize(app2, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)) {
                    [limpos addObject:[NSString stringWithFormat:@"%@:%@", bundle, antes]];
                } else {
                    [falhas addObject:bundle];
                }
            }
            out[@"clearedApps"] = limpos;
            out[@"clearedCount"] = @(limpos.count);
            if (falhas.count) out[@"clearFailed"] = falhas;
        }
        // confirmation é o que veio do store depois de gravar, não o pedido.
        out[@"confirmed"] = [tag isEqual:(out[@"language"] ?: [NSNull null])] ? @YES : @NO;
        PrintJSON(out);
        return ([out[@"confirmed"] boolValue] && synced) ? 0 : 1;
    }

    PrintJSON(Fail([NSString stringWithFormat:@"comando desconhecido: %@", cmd]));
    return 64;
} }
