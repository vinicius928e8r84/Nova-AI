#import <Foundation/Foundation.h>
#import <dlfcn.h>
#import <objc/runtime.h>
#import <sys/stat.h>
#import <sys/sysctl.h>
#import <sys/time.h>
#import "substrate.h"

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

typedef struct { void *alvo; void *gancho; } GanchoDeFuncao;
typedef struct { Class classe; SEL seletor; IMP gancho; } GanchoDeMetodo;

static GanchoDeFuncao ganchosDeFuncao[16];
static int totalDeGanchosDeFuncao;
static GanchoDeMetodo ganchosDeMetodo[16];
static int totalDeGanchosDeMetodo;

void MSHookFunction(void *alvo, void *gancho, void **original) {
    ganchosDeFuncao[totalDeGanchosDeFuncao++] = (GanchoDeFuncao){ alvo, gancho };
    *original = alvo;
}

void MSHookMessageEx(Class classe, SEL seletor, IMP gancho, IMP *original) {
    ganchosDeMetodo[totalDeGanchosDeMetodo++] = (GanchoDeMetodo){ classe, seletor, gancho };
    *original = class_getMethodImplementation(classe, seletor);
}

static void *AlvoDoMobileGestalt(const char *nome) {
    return dlsym(dlopen(getenv("NOVAMODEL_MG_FALSO"), RTLD_LAZY), nome);
}

static const char *NomeDoAlvo(void *alvo) {
    if (alvo == AlvoDoMobileGestalt("MGCopyAnswer")) return "MGCopyAnswer";
    if (alvo == AlvoDoMobileGestalt("MGCopyAnswerWithError")) return "MGCopyAnswerWithError";
    if (alvo == AlvoDoMobileGestalt("MGGetStringAnswer")) return "MGGetStringAnswer";
    if (alvo == (void *)sysctlbyname) return "sysctlbyname";
    if (alvo == (void *)sysctl) return "sysctl";
    return "desconhecido";
}

static void *GanchoDe(void *alvo) {
    for (int i = 0; i < totalDeGanchosDeFuncao; i++) if (ganchosDeFuncao[i].alvo == alvo) return ganchosDeFuncao[i].gancho;
    return NULL;
}

static IMP GanchoDoMetodo(const char *seletor) {
    for (int i = 0; i < totalDeGanchosDeMetodo; i++) if (strcmp(sel_getName(ganchosDeMetodo[i].seletor), seletor) == 0) return ganchosDeMetodo[i].gancho;
    return NULL;
}

static void MostrarInstalacao(void) {
    printf("ganchos de função: %d\n", totalDeGanchosDeFuncao);
    for (int i = 0; i < totalDeGanchosDeFuncao; i++) printf("  %d %s\n", i, NomeDoAlvo(ganchosDeFuncao[i].alvo));
    printf("ganchos de método: %d\n", totalDeGanchosDeMetodo);
    for (int i = 0; i < totalDeGanchosDeMetodo; i++) {
        printf("  %d %s %s\n", i, class_getName(ganchosDeMetodo[i].classe), sel_getName(ganchosDeMetodo[i].seletor));
    }
}

static NSString *CaminhoDoControle(void) {
    return @(getenv("NOVAMODEL_CONTROLE"));
}

static long relogio;

static void DefinirDataDoControle(struct timespec data) {
    struct timespec datas[2] = { data, data };
    utimensat(AT_FDCWD, CaminhoDoControle().UTF8String, datas, 0);
}

static struct timespec DataDoControle(void) {
    struct stat info;
    stat(CaminhoDoControle().UTF8String, &info);
    return info.st_mtimespec;
}

static void GravarControle(NSString *conteudo) {
    [conteudo writeToFile:CaminhoDoControle() atomically:NO encoding:NSUTF8StringEncoding error:nil];
    DefinirDataDoControle((struct timespec){ 1000000000 + ++relogio, 0 });
}

static void ApagarControle(void) {
    unlink(CaminhoDoControle().UTF8String);
}

static NSString *TextoDe(CFTypeRef valor) {
    if (!valor) return @"(NULL)";
    return CFBridgingRelease(valor);
}

static NSString *PerguntarAoMG(const char *funcao, CFStringRef pergunta) {
    void *alvo = AlvoDoMobileGestalt(funcao);
    void *gancho = GanchoDe(alvo);
    if (!gancho) return @"(sem gancho)";
    if (strcmp(funcao, "MGCopyAnswerWithError") == 0) return TextoDe(((CFTypeRef (*)(CFStringRef, CFDictionaryRef, CFErrorRef *))gancho)(pergunta, NULL, NULL));
    if (strcmp(funcao, "MGGetStringAnswer") == 0) return TextoDe((CFTypeRef)((CFStringRef (*)(CFStringRef))gancho)(pergunta));
    return TextoDe(((CFTypeRef (*)(CFStringRef, CFDictionaryRef))gancho)(pergunta, NULL));
}

static void MostrarMG(const char *funcao, NSArray<NSString *> *perguntas) {
    for (NSString *pergunta in perguntas) printf("  %s(%s) = %s\n", funcao, pergunta.UTF8String, PerguntarAoMG(funcao, (__bridge CFStringRef)pergunta).UTF8String);
}

static NSArray<NSString *> *TodasAsPerguntas(void) {
    return @[ @"ProductType", @"MarketingProductName", @"ProductName", @"HWModelStr", @"ModelNumber", @"DeviceName" ];
}

static void MostrarTodoOMG(void) {
    MostrarMG("MGCopyAnswer", TodasAsPerguntas());
}

static void CenaDoMG(const char *nome, NSString *controle) {
    printf("== %s\n", nome);
    if (controle) GravarControle(controle);
    else ApagarControle();
    MostrarTodoOMG();
}

static void CenasDeControle(void) {
    CenaDoMG("sem-arquivo-de-controle", nil);
    CenaDoMG("habilitado-com-tudo", @"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\",\"productName\":\"iPad\",\"hwModel\":\"D16AP\",\"modelNumber\":\"MLPF3\",\"extra\":1}");
    CenaDoMG("habilitado-so-com-o-tipo", @"{\"enabled\":true,\"productType\":\"iPhone15,2\"}");
    CenaDoMG("desabilitado", @"{\"enabled\":false,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\"}");
    CenaDoMG("habilitado-sem-tipo", @"{\"enabled\":true,\"name\":\"iPhone 13\"}");
    CenaDoMG("tipo-vazio", @"{\"enabled\":true,\"productType\":\"\",\"name\":\"iPhone 13\"}");
    CenaDoMG("tipo-que-nao-e-texto", @"{\"enabled\":true,\"productType\":5,\"name\":\"iPhone 13\"}");
    CenaDoMG("nome-que-nao-e-texto", @"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":7,\"productName\":8,\"hwModel\":[],\"modelNumber\":{}}");
    CenaDoMG("nome-do-produto-vazio", @"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"productName\":\"\"}");
    CenaDoMG("habilitado-como-texto-verdadeiro", @"{\"enabled\":\"true\",\"productType\":\"iPhone14,5\"}");
    CenaDoMG("habilitado-como-texto-falso", @"{\"enabled\":\"nao\",\"productType\":\"iPhone14,5\"}");
    CenaDoMG("habilitado-como-numero", @"{\"enabled\":1,\"productType\":\"iPhone14,5\"}");
    CenaDoMG("json-invalido", @"{\"enabled\":true,");
    CenaDoMG("arquivo-vazio", @"");
}

static void CenaDeApagarDepoisDeHabilitar(void) {
    printf("== arquivo-apagado-depois-de-habilitado\n");
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\"}");
    MostrarMG("MGCopyAnswer", @[ @"ProductType" ]);
    ApagarControle();
    MostrarMG("MGCopyAnswer", @[ @"ProductType" ]);
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\"}");
    MostrarMG("MGCopyAnswer", @[ @"ProductType" ]);
}

static void CenaDeCachePorTamanhoEData(void) {
    printf("== cache-por-tamanho-e-data\n");
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\"}");
    MostrarMG("MGCopyAnswer", @[ @"ProductType" ]);
    struct timespec data = DataDoControle();
    [@"{\"enabled\":true,\"productType\":\"iPhone15,2\"}" writeToFile:CaminhoDoControle() atomically:NO encoding:NSUTF8StringEncoding error:nil];
    DefinirDataDoControle(data);
    printf("  mesmo tamanho e mesma data:\n");
    MostrarMG("MGCopyAnswer", @[ @"ProductType" ]);
    DefinirDataDoControle((struct timespec){ data.tv_sec + 1, data.tv_nsec });
    printf("  mesmo tamanho e data nova:\n");
    MostrarMG("MGCopyAnswer", @[ @"ProductType" ]);
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone16,1\",\"name\":\"x\"}");
    printf("  tamanho novo:\n");
    MostrarMG("MGCopyAnswer", @[ @"ProductType", @"MarketingProductName" ]);
}

static void CenasDasVariantesDoMG(void) {
    printf("== variantes-do-mg\n");
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\"}");
    NSArray<NSString *> *perguntas = @[ @"ProductType", @"MarketingProductName", @"DeviceName" ];
    MostrarMG("MGCopyAnswerWithError", perguntas);
    MostrarMG("MGGetStringAnswer", perguntas);
    printf("== pergunta-nula\n");
    printf("  MGCopyAnswer(NULL) = %s\n", PerguntarAoMG("MGCopyAnswer", NULL).UTF8String);
    printf("  MGCopyAnswerWithError(NULL) = %s\n", PerguntarAoMG("MGCopyAnswerWithError", NULL).UTF8String);
    printf("  MGGetStringAnswer(NULL) = %s\n", PerguntarAoMG("MGGetStringAnswer", NULL).UTF8String);
}

typedef struct { int resultado; int erro; size_t tamanho; char texto[64]; } RespostaDoSysctl;

typedef int (*SysctlPorNome)(const char *, void *, size_t *, void *, size_t);
typedef int (*SysctlPorCodigo)(int *, u_int, void *, size_t *, const void *, size_t);

static RespostaDoSysctl ChamarPorNome(SysctlPorNome funcao, const char *nome, size_t capacidade, int comEscrita) {
    RespostaDoSysctl resposta = { 0, 0, capacidade, "" };
    resposta.resultado = funcao(nome, capacidade ? resposta.texto : NULL, &resposta.tamanho, comEscrita ? resposta.texto : NULL, comEscrita ? 1 : 0);
    resposta.erro = resposta.resultado ? errno : 0;
    return resposta;
}

static RespostaDoSysctl ChamarPorCodigo(SysctlPorCodigo funcao, int *nome, u_int tamanhoDoNome, int comEscrita) {
    RespostaDoSysctl resposta = { 0, 0, sizeof(resposta.texto), "" };
    resposta.resultado = funcao(nome, tamanhoDoNome, resposta.texto, &resposta.tamanho, comEscrita ? resposta.texto : NULL, comEscrita ? 1 : 0);
    resposta.erro = resposta.resultado ? errno : 0;
    return resposta;
}

static int RespostasIguais(RespostaDoSysctl a, RespostaDoSysctl b) {
    return a.resultado == b.resultado && a.erro == b.erro && a.tamanho == b.tamanho && memcmp(a.texto, b.texto, sizeof(a.texto)) == 0;
}

static void MostrarResposta(const char *rotulo, RespostaDoSysctl doGancho, RespostaDoSysctl direta) {
    if (RespostasIguais(doGancho, direta)) {
        printf("  %s: igual ao original\n", rotulo);
        return;
    }
    printf("  %s: resultado=%d errno=%d tamanho=%zu texto=%s\n", rotulo, doGancho.resultado, doGancho.erro, doGancho.tamanho, doGancho.texto);
}

static void MostrarSysctlPorNome(const char *nome, size_t capacidade, int comEscrita) {
    SysctlPorNome gancho = GanchoDe((void *)sysctlbyname);
    char rotulo[96];
    snprintf(rotulo, sizeof(rotulo), "sysctlbyname(%s, capacidade %zu, escrita %d)", nome ? nome : "(NULL)", capacidade, comEscrita);
    MostrarResposta(rotulo, ChamarPorNome(gancho, nome, capacidade, comEscrita), ChamarPorNome(sysctlbyname, nome, capacidade, comEscrita));
}

static void CenasDoSysctlPorNome(void) {
    printf("== sysctlbyname\n");
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\"}");
    MostrarSysctlPorNome("hw.machine", 64, 0);
    MostrarSysctlPorNome("hw.product", 64, 0);
    MostrarSysctlPorNome("hw.machine", 11, 0);
    MostrarSysctlPorNome("hw.machine", 10, 0);
    MostrarSysctlPorNome("hw.machine", 64, 1);
    MostrarSysctlPorNome("hw.ncpu", 64, 0);
    SysctlPorNome gancho = GanchoDe((void *)sysctlbyname);
    size_t tamanho = 123;
    int resultado = gancho("hw.machine", NULL, &tamanho, NULL, 0);
    printf("  sem buffer: resultado=%d tamanho=%zu\n", resultado, tamanho);
    char buffer[64] = "";
    resultado = gancho("hw.machine", buffer, NULL, NULL, 0);
    int erro = errno;
    printf("  sem tamanho: resultado=%d errno=%d\n", resultado, erro);
}

static void CenaDoSysctlPorNomeSemSpoof(void) {
    printf("== sysctlbyname-sem-spoof\n");
    ApagarControle();
    SysctlPorNome gancho = GanchoDe((void *)sysctlbyname);
    MostrarResposta("hw.machine sem controle", ChamarPorNome(gancho, "hw.machine", 64, 0), ChamarPorNome(sysctlbyname, "hw.machine", 64, 0));
}

static void MostrarSysctl(const char *rotulo, int *nome, u_int tamanhoDoNome, int comEscrita) {
    SysctlPorCodigo gancho = GanchoDe((void *)sysctl);
    MostrarResposta(rotulo, ChamarPorCodigo(gancho, nome, tamanhoDoNome, comEscrita), ChamarPorCodigo((SysctlPorCodigo)sysctl, nome, tamanhoDoNome, comEscrita));
}

static void CenasDoSysctl(void) {
    printf("== sysctl\n");
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\"}");
    int maquina[2] = { CTL_HW, HW_MACHINE };
    int produto[2] = { CTL_HW, HW_PRODUCT };
    int outro[2] = { CTL_HW, HW_NCPU };
    int outroGrupo[2] = { CTL_KERN, HW_MACHINE };
    MostrarSysctl("hw.machine", maquina, 2, 0);
    MostrarSysctl("hw.product", produto, 2, 0);
    MostrarSysctl("hw.machine com escrita", maquina, 2, 1);
    MostrarSysctl("hw.machine com nome curto", maquina, 1, 0);
    MostrarSysctl("hw.ncpu", outro, 2, 0);
    MostrarSysctl("kern com o código de hw.machine", outroGrupo, 2, 0);
}

static void MostrarUIDevice(const char *seletor) {
    IMP gancho = GanchoDoMetodo(seletor);
    if (!gancho) {
        printf("  %s = (sem gancho)\n", seletor);
        return;
    }
    id resposta = ((id (*)(id, SEL))gancho)(nil, sel_registerName(seletor));
    printf("  %s = %s\n", seletor, [[resposta description] UTF8String]);
}

static void CenaDoUIDevice(const char *nome, NSString *controle) {
    printf("== %s\n", nome);
    if (controle) GravarControle(controle);
    else ApagarControle();
    for (NSString *seletor in @[ @"model", @"localizedModel", @"modelName", @"_modelName" ]) MostrarUIDevice(seletor.UTF8String);
}

static void CenasDoUIDevice(void) {
    CenaDoUIDevice("uidevice-habilitado", @"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\",\"productName\":\"iPad\"}");
    CenaDoUIDevice("uidevice-habilitado-so-com-o-tipo", @"{\"enabled\":true,\"productType\":\"iPhone14,5\"}");
    CenaDoUIDevice("uidevice-desabilitado", @"{\"enabled\":false,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\"}");
}

static void MostrarCenas(void) {
    CenasDeControle();
    CenaDeApagarDepoisDeHabilitar();
    CenaDeCachePorTamanhoEData();
    CenasDasVariantesDoMG();
    CenasDoSysctlPorNome();
    CenaDoSysctlPorNomeSemSpoof();
    CenasDoSysctl();
    CenasDoUIDevice();
}

int main(int argc, char **argv) {
    setvbuf(stdout, NULL, _IONBF, 0);
    @autoreleasepool {
        if (argc > 1 && strcmp(argv[1], "instalacao") == 0) MostrarInstalacao();
        else MostrarCenas();
    }
    return 0;
}
