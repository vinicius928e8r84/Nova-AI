#import <dlfcn.h>
#import <sys/sysctl.h>
#import "roteiro.h"
#import "substrate.h"

typedef struct {
    void *alvo;
    void *gancho;
} GanchoDeFuncao;

typedef struct {
    Class classe;
    SEL seletor;
    IMP gancho;
} GanchoDeMetodo;

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

AlvoDeFuncao AlvoDoMobileGestalt(NomeDaFuncao funcao) {
    return dlsym(dlopen(getenv("NOVAMODEL_MG_FALSO"), RTLD_LAZY), funcao.UTF8String);
}

void *GanchoDaFuncao(AlvoDeFuncao alvo) {
    for (int i = 0; i < totalDeGanchosDeFuncao; i++) if (ganchosDeFuncao[i].alvo == alvo) return ganchosDeFuncao[i].gancho;
    return NULL;
}

IMP GanchoDoMetodo(NomeDoSeletor seletor) {
    for (int i = 0; i < totalDeGanchosDeMetodo; i++) if (strcmp(sel_getName(ganchosDeMetodo[i].seletor), seletor.UTF8String) == 0) return ganchosDeMetodo[i].gancho;
    return NULL;
}

static NSString *NomeDoAlvo(AlvoDeFuncao alvo) {
    for (NomeDaFuncao funcao in @[ @"MGCopyAnswer", @"MGCopyAnswerWithError", @"MGGetStringAnswer" ]) if (alvo == AlvoDoMobileGestalt(funcao)) return funcao;
    if (alvo == (void *)sysctlbyname) return @"sysctlbyname";
    return alvo == (void *)sysctl ? @"sysctl" : @"desconhecido";
}

void MostrarInstalacao(void) {
    printf("ganchos de função: %d\n", totalDeGanchosDeFuncao);
    for (int i = 0; i < totalDeGanchosDeFuncao; i++) printf("  %d %s\n", i, NomeDoAlvo(ganchosDeFuncao[i].alvo).UTF8String);
    printf("ganchos de método: %d\n", totalDeGanchosDeMetodo);
    for (int i = 0; i < totalDeGanchosDeMetodo; i++) {
        printf("  %d %s %s\n", i, class_getName(ganchosDeMetodo[i].classe), sel_getName(ganchosDeMetodo[i].seletor));
    }
}
