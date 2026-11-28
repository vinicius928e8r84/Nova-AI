#import "Preferencias.h"
#import "Validacao.h"

static NSString *const kPreferenciasGlobaisNoDisco = @"/var/mobile/Library/Preferences/.GlobalPreferences.plist";

static CFStringRef DominioGlobal(void) {
    static NSString *substituto;
    static dispatch_once_t uma_vez;
    dispatch_once(&uma_vez, ^{
        const char *ambiente = getenv("NOVALANGUAGE_GLOBAL_DOMAIN");
        if (ambiente && ambiente[0]) substituto = [NSString stringWithUTF8String:ambiente];
    });
    return substituto ? (__bridge CFStringRef)substituto : kCFPreferencesAnyApplication;
}

CFStringRef AplicacaoDoDominio(Dominio dominio) {
    return DominioEhGlobal(dominio) ? DominioGlobal() : (__bridge CFStringRef)dominio;
}

static CFPropertyListRef CopiarPreferencia(CFStringRef chave, CFStringRef aplicacao) {
    return CFPreferencesCopyValue(chave, aplicacao, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
}

static void GravarPreferencia(CFStringRef chave, CFPropertyListRef valor, CFStringRef aplicacao) {
    CFPreferencesSetValue(chave, valor, aplicacao, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
}

void GravarIdiomas(NSArray<NSString *> *idiomas, CFStringRef aplicacao) {
    GravarPreferencia(CFSTR("AppleLanguages"), (__bridge CFPropertyListRef)idiomas, aplicacao);
}

void GravarLocale(CodigoDeLocale locale, CFStringRef aplicacao) {
    GravarPreferencia(CFSTR("AppleLocale"), (__bridge CFPropertyListRef)locale, aplicacao);
}

BOOL SincronizarAplicacao(CFStringRef aplicacao) {
    return CFPreferencesSynchronize(aplicacao, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
}

static NSArray<NSString *> *TextosDoArray(NSArray *itens) {
    NSMutableArray<NSString *> *textos = [NSMutableArray array];
    for (id item in itens) if ([item isKindOfClass:[NSString class]]) [textos addObject:item];
    return textos;
}

static NSArray<NSString *> *IdiomasDoValor(CFPropertyListRef valor) {
    if (!valor) return [NSMutableArray array];
    if (CFGetTypeID(valor) == CFArrayGetTypeID()) return TextosDoArray((__bridge NSArray *)valor);
    if (CFGetTypeID(valor) == CFStringGetTypeID()) return @[ (__bridge NSString *)valor ];
    return [NSMutableArray array];
}

static NSArray<NSString *> *IdiomasGravados(CFStringRef aplicacao) {
    CFPropertyListRef valor = CopiarPreferencia(CFSTR("AppleLanguages"), aplicacao);
    NSArray<NSString *> *idiomas = IdiomasDoValor(valor);
    if (valor) CFRelease(valor);
    return idiomas;
}

static NSString *PrimeiroTextoDoArray(NSArray *itens) {
    if (itens.count && [itens[0] isKindOfClass:[NSString class]]) return itens[0];
    return @"";
}

static NSString *PrimeiroIdiomaDoValor(CFPropertyListRef valor) {
    if (!valor) return @"";
    if (CFGetTypeID(valor) == CFArrayGetTypeID()) return PrimeiroTextoDoArray((__bridge NSArray *)valor);
    if (CFGetTypeID(valor) == CFStringGetTypeID()) return (__bridge NSString *)valor;
    return @"";
}

NSString *PrimeiroIdiomaGravado(CFStringRef aplicacao) {
    CFPropertyListRef valor = CopiarPreferencia(CFSTR("AppleLanguages"), aplicacao);
    NSString *primeiro = PrimeiroIdiomaDoValor(valor);
    if (valor) CFRelease(valor);
    return primeiro;
}

static NSString *LocaleGravado(CFStringRef aplicacao) {
    CFPropertyListRef valor = CopiarPreferencia(CFSTR("AppleLocale"), aplicacao);
    NSString *locale = nil;
    if (valor && CFGetTypeID(valor) == CFStringGetTypeID()) locale = (__bridge NSString *)valor;
    if (valor) CFRelease(valor);
    return locale;
}

static NSString *IdiomaDoDisco(id valor) {
    if ([valor isKindOfClass:[NSArray class]] && [valor count]) return [valor firstObject];
    if ([valor isKindOfClass:[NSString class]]) return valor;
    return nil;
}

static void AcrescentarIdiomaDoDisco(NSMutableDictionary *estado, NSArray<NSString *> *idiomas) {
    NSDictionary *plist = [NSDictionary dictionaryWithContentsOfFile:kPreferenciasGlobaisNoDisco];
    if (![plist isKindOfClass:[NSDictionary class]]) return;
    NSString *doDisco = IdiomaDoDisco(plist[@"AppleLanguages"]);
    estado[@"disk"] = doDisco ?: [NSNull null];
    estado[@"diskPath"] = kPreferenciasGlobaisNoDisco;
    estado[@"diskMatches"] = doDisco ? @([idiomas.firstObject isEqualToString:doDisco]) : [NSNull null];
}

NSDictionary *EstadoDoDominio(Dominio dominio) {
    BOOL global = DominioEhGlobal(dominio);
    CFStringRef aplicacao = AplicacaoDoDominio(dominio);
    NSArray<NSString *> *idiomas = IdiomasGravados(aplicacao);
    NSString *locale = LocaleGravado(aplicacao);
    NSMutableDictionary *estado = [@{
        @"ok": @YES,
        @"domain": global ? @"global" : dominio,
        @"language": idiomas.count ? idiomas.firstObject : [NSNull null],
        @"languages": idiomas,
        @"locale": locale ?: [NSNull null],
        @"override": idiomas.count ? @YES : @NO,
    } mutableCopy];
    if (global) AcrescentarIdiomaDoDisco(estado, idiomas);
    return estado;
}
