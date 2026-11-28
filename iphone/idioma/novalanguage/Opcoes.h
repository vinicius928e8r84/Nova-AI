#import "Tipos.h"

typedef struct {
    __unsafe_unretained Dominio dominio;
    __unsafe_unretained CodigoDeLocale locale;
    __unsafe_unretained TagDeIdioma tag;
    BOOL limparApps;
    BOOL naoLimparApps;
} Opcoes;

Mensagem LerOpcoes(NSArray<NSString *> *argumentos, Opcoes *opcoes);
