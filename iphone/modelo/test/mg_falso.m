#import <Foundation/Foundation.h>

static CFTypeRef RespostaOriginal(const char *origem, CFStringRef pergunta) {
    CFStringRef texto = pergunta ? pergunta : CFSTR("(nulo)");
    return CFStringCreateWithFormat(NULL, NULL, CFSTR("%s:%@"), origem, texto);
}

CFTypeRef MGCopyAnswer(CFStringRef pergunta, CFDictionaryRef opcoes) {
    return RespostaOriginal("original", pergunta);
}

CFTypeRef MGCopyAnswerWithError(CFStringRef pergunta, CFDictionaryRef opcoes, CFErrorRef *erro) {
    if (erro) *erro = NULL;
    return RespostaOriginal("original-com-erro", pergunta);
}

CFStringRef MGGetStringAnswer(CFStringRef pergunta) {
    return RespostaOriginal("original-texto", pergunta);
}
