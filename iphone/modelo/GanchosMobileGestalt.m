#import "GanchosMobileGestalt.h"
#import "Configuracao.h"
#import <substrate.h>
#import <dlfcn.h>

static NSSet<NSString *> *chavesDoMobileGestalt;

static CFTypeRef (*original_MGCopyAnswer)(CFStringRef, CFDictionaryRef);
static CFTypeRef (*original_MGCopyAnswerWithError)(CFStringRef, CFDictionaryRef, CFErrorRef *);
static CFStringRef (*original_MGGetStringAnswer)(CFStringRef);

static CFStringRef RespostaFalsificada(CFStringRef pergunta) {
    if (!pergunta) return NULL;
    NSString *chave = (__bridge NSString *)pergunta;
    if (![chavesDoMobileGestalt containsObject:chave]) return NULL;
    return CFBridgingRetain(ValorFalsificado(chave));
}

static CFTypeRef ganchoMGCopyAnswer(CFStringRef pergunta, CFDictionaryRef opcoes) {
    return RespostaFalsificada(pergunta) ?: original_MGCopyAnswer(pergunta, opcoes);
}

static CFTypeRef ganchoMGCopyAnswerWithError(CFStringRef pergunta, CFDictionaryRef opcoes, CFErrorRef *erro) {
    return RespostaFalsificada(pergunta) ?: original_MGCopyAnswerWithError(pergunta, opcoes, erro);
}

static CFStringRef ganchoMGGetStringAnswer(CFStringRef pergunta) {
    return RespostaFalsificada(pergunta) ?: original_MGGetStringAnswer(pergunta);
}

static void InstalarSeExistir(void *biblioteca, const char *simbolo, void *gancho, void **original) {
    void *alvo = biblioteca ? dlsym(biblioteca, simbolo) : NULL;
    if (alvo) MSHookFunction(alvo, gancho, original);
}

void InstalarGanchosDoMobileGestalt(void) {
    chavesDoMobileGestalt = [NSSet setWithObjects:@"ProductType", @"HWModelStr",
        @"ModelNumber", @"ProductName", @"MarketingProductName", nil];
    void *biblioteca = dlopen("/usr/lib/libMobileGestalt.dylib", RTLD_LAZY);
    InstalarSeExistir(biblioteca, "MGCopyAnswer", (void *)ganchoMGCopyAnswer, (void **)&original_MGCopyAnswer);
    InstalarSeExistir(biblioteca, "MGCopyAnswerWithError", (void *)ganchoMGCopyAnswerWithError, (void **)&original_MGCopyAnswerWithError);
    InstalarSeExistir(biblioteca, "MGGetStringAnswer", (void *)ganchoMGGetStringAnswer, (void **)&original_MGGetStringAnswer);
}
