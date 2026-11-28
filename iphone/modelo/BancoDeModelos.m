#import "BancoDeModelos.h"
#import "ArquivoJSON.h"

NSString *CaminhoDoBancoDeModelos(void) {
    return @"/var/jb/usr/share/novamodel/models.json";
}

static NSArray *LerModelos(void) {
    NSArray *modelos = LerDicionarioJSON(CaminhoDoBancoDeModelos())[@"models"];
    return [modelos isKindOfClass:[NSArray class]] ? modelos : nil;
}

static BOOL ModeloTemOTipo(id modelo, TipoDeProduto tipo) {
    return [modelo isKindOfClass:[NSDictionary class]] && [modelo[@"productType"] isEqualToString:tipo];
}

static NSString *NomeSeValido(id nome) {
    return [nome isKindOfClass:[NSString class]] && [nome length] ? nome : nil;
}

NSString *NomeDoModelo(TipoDeProduto tipo) {
    for (id modelo in LerModelos()) {
        if (!ModeloTemOTipo(modelo, tipo)) continue;
        NSString *nome = NomeSeValido(modelo[@"name"]);
        if (nome) return nome;
    }
    return nil;
}
