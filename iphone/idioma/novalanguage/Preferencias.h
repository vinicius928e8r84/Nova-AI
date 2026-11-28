#import "Tipos.h"

CFStringRef AplicacaoDoDominio(Dominio dominio);
void GravarIdiomas(NSArray<NSString *> *idiomas, CFStringRef aplicacao);
void GravarLocale(CodigoDeLocale locale, CFStringRef aplicacao);
BOOL SincronizarAplicacao(CFStringRef aplicacao);
NSString *PrimeiroIdiomaGravado(CFStringRef aplicacao);
NSDictionary *EstadoDoDominio(Dominio dominio);
