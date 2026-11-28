#import "Comandos.h"
#import "Preferencias.h"
#import "Saida.h"
#import "Validacao.h"
#import "Varredura.h"

static int ComandoScan(void) {
    NSArray<NSString *> *apps = AppsComIdiomaProprio();
    ImprimirResposta(@{ @"ok": @YES, @"count": @(apps.count), @"apps": apps });
    return 0;
}

static int ComandoRead(Dominio dominio) {
    ImprimirResposta(EstadoDoDominio(dominio));
    return 0;
}

static Mensagem AplicarLocaleDoClear(CFStringRef aplicacao, CodigoDeLocale locale) {
    if ([locale isEqualToString:@"-"]) {
        GravarLocale(nil, aplicacao);
        return nil;
    }
    if (!locale.length) return nil;
    if (!LocaleValido(locale)) return [NSString stringWithFormat:@"locale inválido: %@", locale];
    GravarLocale(locale, aplicacao);
    return nil;
}

static int ComandoClear(Dominio dominio, const Opcoes *opcoes) {
    CFStringRef aplicacao = AplicacaoDoDominio(dominio);
    GravarIdiomas(nil, aplicacao);
    Mensagem erro = AplicarLocaleDoClear(aplicacao, opcoes->locale);
    if (erro) {
        ImprimirFalha(erro);
        return 64;
    }
    BOOL sincronizado = SincronizarAplicacao(aplicacao);
    NSMutableDictionary *saida = [EstadoDoDominio(dominio) mutableCopy];
    saida[@"synced"] = @(sincronizado);
    saida[@"cleared"] = @YES;
    ImprimirResposta(saida);
    return sincronizado ? 0 : 1;
}

static CodigoDeLocale LocaleAutomatico(TagDeIdioma tag) {
    NSArray<NSString *> *partes = [tag componentsSeparatedByString:@"-"];
    if (partes.count < 2) return nil;
    NSMutableArray *saida = [NSMutableArray arrayWithObject:partes[0]];
    for (NSUInteger i = 1; i < partes.count; i++) [saida addObject:[partes[i] uppercaseString]];
    return [saida componentsJoinedByString:@"_"];
}

static BOOL LocaleInformadoEhInvalido(CodigoDeLocale locale) {
    if (!locale || [locale isEqualToString:@"-"]) return NO;
    return !LocaleValido(locale);
}

static BOOL DeveLimparOsApps(Dominio dominio, const Opcoes *opcoes) {
    if (!DominioEhGlobal(dominio)) return NO;
    return opcoes->limparApps && !opcoes->naoLimparApps;
}

static void AcrescentarLimpezaDosApps(NSMutableDictionary *saida) {
    NSMutableArray<NSString *> *limpos = [NSMutableArray array];
    NSMutableArray<NSString *> *falhas = [NSMutableArray array];
    for (NSString *bundle in AppsComIdiomaProprio()) {
        CFStringRef aplicacao = (__bridge CFStringRef)bundle;
        NSString *antes = PrimeiroIdiomaGravado(aplicacao);
        GravarIdiomas(nil, aplicacao);
        if (SincronizarAplicacao(aplicacao)) [limpos addObject:[NSString stringWithFormat:@"%@:%@", bundle, antes]];
        else [falhas addObject:bundle];
    }
    saida[@"clearedApps"] = limpos;
    saida[@"clearedCount"] = @(limpos.count);
    if (falhas.count) saida[@"clearFailed"] = falhas;
}

static Mensagem ValidarIdioma(TagDeIdioma tag) {
    if (!tag.length) return @"falta o idioma (ex.: pt-BR)";
    if (!TagValida(tag)) return [NSString stringWithFormat:@"idioma inválido: %@", tag];
    return nil;
}

static int ComandoWrite(Dominio dominio, const Opcoes *opcoes) {
    TagDeIdioma tag = opcoes->tag;
    Mensagem erro = ValidarIdioma(tag);
    if (erro) {
        ImprimirFalha(erro);
        return 64;
    }
    CodigoDeLocale locale = opcoes->locale;
    BOOL localeAutomatico = [locale isEqualToString:@"auto"];
    if (localeAutomatico) locale = LocaleAutomatico(tag);
    if (LocaleInformadoEhInvalido(locale)) {
        ImprimirFalha([NSString stringWithFormat:@"locale inválido: %@", locale]);
        return 64;
    }
    CFStringRef aplicacao = AplicacaoDoDominio(dominio);
    GravarIdiomas(@[ tag ], aplicacao);
    if (locale.length) GravarLocale(locale, aplicacao);
    BOOL sincronizado = SincronizarAplicacao(aplicacao);
    NSMutableDictionary *saida = [EstadoDoDominio(dominio) mutableCopy];
    saida[@"synced"] = @(sincronizado);
    saida[@"requested"] = tag;
    if (localeAutomatico) saida[@"localeAuto"] = @YES;
    if (DeveLimparOsApps(dominio, opcoes)) AcrescentarLimpezaDosApps(saida);
    saida[@"confirmed"] = [tag isEqual:(saida[@"language"] ?: [NSNull null])] ? @YES : @NO;
    ImprimirResposta(saida);
    return ([saida[@"confirmed"] boolValue] && sincronizado) ? 0 : 1;
}

int ExecutarComando(NSString *comando, Dominio dominio, const Opcoes *opcoes) {
    if ([comando isEqualToString:@"scan"]) return ComandoScan();
    if ([comando isEqualToString:@"read"]) return ComandoRead(dominio);
    if ([comando isEqualToString:@"clear"]) return ComandoClear(dominio, opcoes);
    if ([comando isEqualToString:@"write"]) return ComandoWrite(dominio, opcoes);
    ImprimirFalha([NSString stringWithFormat:@"comando desconhecido: %@", comando]);
    return 64;
}
