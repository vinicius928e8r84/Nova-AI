#import "roteiro.h"

#ifndef SEM_UIDEVICE
@interface UIDevice : NSObject
@end

@implementation UIDevice
- (id)model { return @"original-model"; }
- (id)localizedModel { return @"original-localizedModel"; }
#ifndef UIDEVICE_SEM_MODELNAME
- (id)modelName { return @"original-modelName"; }
- (id)_modelName { return @"original-_modelName"; }
#endif
@end
#endif

static void MostrarUIDevice(NomeDoSeletor seletor) {
    IMP gancho = GanchoDoMetodo(seletor);
    if (!gancho) {
        printf("  %s = (sem gancho)\n", seletor.UTF8String);
        return;
    }
    id resposta = ((id (*)(id, SEL))gancho)(nil, NSSelectorFromString(seletor));
    printf("  %s = %s\n", seletor.UTF8String, [[resposta description] UTF8String]);
}

static void CenaDoUIDevice(Rotulo nome, ConteudoDoControle controle) {
    printf("== %s\n", nome.UTF8String);
    GravarControle(controle);
    for (NomeDoSeletor seletor in @[ @"model", @"localizedModel", @"modelName", @"_modelName" ]) MostrarUIDevice(seletor);
}

void MostrarCenasDoUIDevice(void) {
    CenaDoUIDevice(@"uidevice-habilitado", @"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\",\"productName\":\"iPad\"}");
    CenaDoUIDevice(@"uidevice-habilitado-so-com-o-tipo", @"{\"enabled\":true,\"productType\":\"iPhone14,5\"}");
    CenaDoUIDevice(@"uidevice-desabilitado", @"{\"enabled\":false,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\"}");
}
