#import "Validacao.h"

static BOOL CasaOPadrao(NSString *texto, NSString *padrao) {
    NSRegularExpression *expressao = [NSRegularExpression regularExpressionWithPattern:padrao options:0 error:nil];
    return [expressao numberOfMatchesInString:texto options:0 range:NSMakeRange(0, texto.length)] == 1;
}

static BOOL TamanhoDeCodigoValido(NSString *codigo) {
    return codigo.length >= 2 && codigo.length <= 35;
}

BOOL TagValida(TagDeIdioma tag) {
    return TamanhoDeCodigoValido(tag) && CasaOPadrao(tag, @"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$");
}

BOOL LocaleValido(CodigoDeLocale locale) {
    return TamanhoDeCodigoValido(locale) && CasaOPadrao(locale, @"^[A-Za-z]{2,3}(_[A-Za-z0-9]{2,8})*$");
}

BOOL BundleValido(NSString *bundle) {
    return CasaOPadrao(bundle, @"^[A-Za-z0-9][A-Za-z0-9.-]{2,120}$");
}

BOOL DominioEhGlobal(Dominio dominio) {
    for (NSString *apelido in @[ @"global", @"system", @"aparelho" ]) {
        if ([dominio isEqualToString:apelido]) return YES;
    }
    return NO;
}

BOOL DominioValido(Dominio dominio) {
    return DominioEhGlobal(dominio) || BundleValido(dominio);
}
