#import "Comandos.h"
#import "ArquivoDeControle.h"
#import "BancoDeModelos.h"
#import "ModeloReal.h"

int ComandoStatus(void) {
    NSString *real = TipoDeProdutoReal() ?: @"?";
    NSDictionary *controle = LerControle();
    BOOL habilitado = ControleHabilitado(controle);
    NSString *ativo = habilitado ? controle[@"productType"] : real;
    NSDictionary *saida = @{ @"real": real, @"active": ativo, @"enabled": @(habilitado) };
    NSData *json = [NSJSONSerialization dataWithJSONObject:saida options:0 error:NULL];
    if (!json) return 3;
    printf("%s\n", [[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] UTF8String]);
    return 0;
}

int ComandoSet(TipoDeProduto tipo) {
    NSString *nome = NomeDoModelo(tipo);
    if (!nome) {
        fprintf(stderr, "erro: modelo '%s' não existe no banco (%s)\n",
                tipo.UTF8String ?: "(nulo)", CaminhoDoBancoDeModelos().UTF8String);
        return 2;
    }
    if (!GravarControle(tipo, nome)) {
        fprintf(stderr, "erro: não consegui gravar %s\n", CaminhoDoControle().UTF8String);
        return 3;
    }
    printf("ok %s -> %s (aplicado; apps/Ajustes abertos podem precisar ser reabertos)\n",
           tipo.UTF8String, nome.UTF8String);
    return 0;
}

int ComandoClear(void) {
    RemoverControle();
    printf("ok cleared (modelo real restaurado)\n");
    return 0;
}

void MostrarUso(void) {
    fprintf(stderr,
            "uso:\n"
            "  novamodel set <productType>    ex.: novamodel set iPhone14,5\n"
            "  novamodel clear\n"
            "  novamodel status\n");
}
