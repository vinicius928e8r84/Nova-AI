#import "roteiro.h"

typedef CFTypeRef (*RespostaDoMG)(CFStringRef, CFDictionaryRef);
typedef CFTypeRef (*RespostaDoMGComErro)(CFStringRef, CFDictionaryRef, CFErrorRef *);
typedef CFStringRef (*TextoDoMG)(CFStringRef);

static NSString *TextoDe(CFTypeRef valor) {
    if (!valor) return @"(NULL)";
    return CFBridgingRelease(valor);
}

static NSString *PerguntarAoMG(NomeDaFuncao funcao, PerguntaDoMG pergunta) {
    void *gancho = GanchoDaFuncao(AlvoDoMobileGestalt(funcao));
    CFStringRef pergunta_cf = (__bridge CFStringRef)pergunta;
    if (!gancho) return @"(sem gancho)";
    if ([funcao isEqualToString:@"MGCopyAnswerWithError"]) return TextoDe(((RespostaDoMGComErro)gancho)(pergunta_cf, NULL, NULL));
    if ([funcao isEqualToString:@"MGGetStringAnswer"]) return TextoDe((CFTypeRef)((TextoDoMG)gancho)(pergunta_cf));
    return TextoDe(((RespostaDoMG)gancho)(pergunta_cf, NULL));
}

static void MostrarMG(NomeDaFuncao funcao, NSArray<PerguntaDoMG> *perguntas) {
    for (PerguntaDoMG pergunta in perguntas) {
        printf("  %s(%s) = %s\n", funcao.UTF8String, pergunta.UTF8String, PerguntarAoMG(funcao, pergunta).UTF8String);
    }
}

static void MostrarTipoDeProduto(void) {
    MostrarMG(@"MGCopyAnswer", @[ @"ProductType" ]);
}

static void CenaDoMG(Rotulo nome, ConteudoDoControle controle) {
    printf("== %s\n", nome.UTF8String);
    if (controle) GravarControle(controle);
    else ApagarControle();
    MostrarMG(@"MGCopyAnswer", @[ @"ProductType", @"MarketingProductName", @"ProductName", @"HWModelStr", @"ModelNumber", @"DeviceName" ]);
}

static void CenasDeControleValido(void) {
    CenaDoMG(@"sem-arquivo-de-controle", nil);
    CenaDoMG(@"habilitado-com-tudo", @"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\",\"productName\":\"iPad\",\"hwModel\":\"D16AP\",\"modelNumber\":\"MLPF3\",\"extra\":1}");
    CenaDoMG(@"habilitado-so-com-o-tipo", @"{\"enabled\":true,\"productType\":\"iPhone15,2\"}");
    CenaDoMG(@"desabilitado", @"{\"enabled\":false,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\"}");
    CenaDoMG(@"habilitado-sem-tipo", @"{\"enabled\":true,\"name\":\"iPhone 13\"}");
    CenaDoMG(@"tipo-vazio", @"{\"enabled\":true,\"productType\":\"\",\"name\":\"iPhone 13\"}");
    CenaDoMG(@"nome-do-produto-vazio", @"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"productName\":\"\"}");
}

static void CenasDeControleEstranho(void) {
    CenaDoMG(@"tipo-que-nao-e-texto", @"{\"enabled\":true,\"productType\":5,\"name\":\"iPhone 13\"}");
    CenaDoMG(@"nome-que-nao-e-texto", @"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":7,\"productName\":8,\"hwModel\":[],\"modelNumber\":{}}");
    CenaDoMG(@"habilitado-como-texto-verdadeiro", @"{\"enabled\":\"true\",\"productType\":\"iPhone14,5\"}");
    CenaDoMG(@"habilitado-como-texto-falso", @"{\"enabled\":\"nao\",\"productType\":\"iPhone14,5\"}");
    CenaDoMG(@"habilitado-como-numero", @"{\"enabled\":1,\"productType\":\"iPhone14,5\"}");
    CenaDoMG(@"json-invalido", @"{\"enabled\":true,");
    CenaDoMG(@"arquivo-vazio", @"");
}

static void CenaDeApagarDepoisDeHabilitar(void) {
    printf("== arquivo-apagado-depois-de-habilitado\n");
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\"}");
    MostrarTipoDeProduto();
    ApagarControle();
    MostrarTipoDeProduto();
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\"}");
    MostrarTipoDeProduto();
}

static void EscreverSemMudarAData(ConteudoDoControle conteudo, struct timespec data) {
    [conteudo writeToFile:CaminhoDoControle() atomically:NO encoding:NSUTF8StringEncoding error:nil];
    DefinirDataDoControle(data);
}

static void CenaDeCachePorTamanhoEData(void) {
    printf("== cache-por-tamanho-e-data\n");
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\"}");
    MostrarTipoDeProduto();
    struct timespec data = DataDoControle();
    EscreverSemMudarAData(@"{\"enabled\":true,\"productType\":\"iPhone15,2\"}", data);
    printf("  mesmo tamanho e mesma data:\n");
    MostrarTipoDeProduto();
    DefinirDataDoControle((struct timespec){ data.tv_sec + 1, data.tv_nsec });
    printf("  mesmo tamanho e data nova:\n");
    MostrarTipoDeProduto();
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone16,1\",\"name\":\"x\"}");
    printf("  tamanho novo:\n");
    MostrarMG(@"MGCopyAnswer", @[ @"ProductType", @"MarketingProductName" ]);
}

static void CenasDasVariantesDoMG(void) {
    printf("== variantes-do-mg\n");
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\"}");
    for (NomeDaFuncao funcao in @[ @"MGCopyAnswerWithError", @"MGGetStringAnswer" ]) {
        MostrarMG(funcao, @[ @"ProductType", @"MarketingProductName", @"DeviceName" ]);
    }
    printf("== pergunta-nula\n");
    for (NomeDaFuncao funcao in @[ @"MGCopyAnswer", @"MGCopyAnswerWithError", @"MGGetStringAnswer" ]) {
        printf("  %s(NULL) = %s\n", funcao.UTF8String, PerguntarAoMG(funcao, nil).UTF8String);
    }
}

void MostrarCenasDoMG(void) {
    CenasDeControleValido();
    CenasDeControleEstranho();
    CenaDeApagarDepoisDeHabilitar();
    CenaDeCachePorTamanhoEData();
    CenasDasVariantesDoMG();
}

int main(int argc, char **argv) {
    setvbuf(stdout, NULL, _IONBF, 0);
    @autoreleasepool {
        if (argc > 1 && strcmp(argv[1], "instalacao") == 0) {
            MostrarInstalacao();
            return 0;
        }
        MostrarCenasDoMG();
        MostrarCenasDoSysctl();
        MostrarCenasDoUIDevice();
    }
    return 0;
}
