#import "ModeloReal.h"
#include <dlfcn.h>

typedef CFTypeRef (*CopiarRespostaDoMobileGestalt)(CFStringRef, CFDictionaryRef);

TipoDeProduto TipoDeProdutoReal(void) {
    void *biblioteca = dlopen("/usr/lib/libMobileGestalt.dylib", RTLD_LAZY);
    if (!biblioteca) return nil;
    CopiarRespostaDoMobileGestalt copiarResposta = (CopiarRespostaDoMobileGestalt)dlsym(biblioteca, "MGCopyAnswer");
    if (!copiarResposta) return nil;
    CFTypeRef resposta = copiarResposta(CFSTR("ProductType"), NULL);
    if (!resposta) return nil;
    return CFBridgingRelease(resposta);
}
