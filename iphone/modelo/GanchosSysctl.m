#import "GanchosSysctl.h"
#import "Configuracao.h"
#import <substrate.h>
#import <sys/sysctl.h>
#import <sys/types.h>
#import <sys/errno.h>
#import <string.h>

static int (*original_sysctlbyname)(const char *, void *, size_t *, void *, size_t);
static int (*original_sysctl)(int *, u_int, void *, size_t *, const void *, size_t);

static int CopiarParaOBuffer(NSString *valor, void *destino, size_t *tamanho) {
    const char *texto = [valor UTF8String];
    size_t necessario = strlen(texto) + 1;
    if (destino == NULL) {
        if (tamanho) *tamanho = necessario;
        return 0;
    }
    if (tamanho == NULL || *tamanho < necessario) {
        if (tamanho) *tamanho = necessario;
        errno = ENOMEM;
        return -1;
    }
    memcpy(destino, texto, necessario);
    *tamanho = necessario;
    return 0;
}

static BOOL ResponderComSpoof(NSString *chave, void *destino, size_t *tamanho, int *resultado) {
    NSString *valor = ValorFalsificado(chave);
    if (!valor) return NO;
    *resultado = CopiarParaOBuffer(valor, destino, tamanho);
    return YES;
}

static NSString *ChaveDoSysctlPorNome(const char *nome) {
    if (strcmp(nome, "hw.machine") == 0) return @"ProductType";
    if (strcmp(nome, "hw.product") == 0) return @"MarketingProductName";
    return nil;
}

static NSString *ChaveDoSysctlPorCodigo(int codigo) {
    if (codigo == HW_MACHINE) return @"ProductType";
#ifdef HW_PRODUCT
    if (codigo == HW_PRODUCT) return @"MarketingProductName";
#endif
    return nil;
}

static BOOL ResponderPelaChave(NSString *chave, void *destino, size_t *tamanho, int *resultado) {
    return chave && ResponderComSpoof(chave, destino, tamanho, resultado);
}

static BOOL EhLeituraDeHardware(const int *nome, u_int tamanhoDoNome, const void *novo) {
    if (!nome || novo != NULL) return NO;
    return tamanhoDoNome >= 2 && nome[0] == CTL_HW;
}

static int ganchoSysctlbyname(const char *nome, void *antigo, size_t *tamanhoAntigo, void *novo, size_t tamanhoNovo) {
    if (nome && novo == NULL) {
        int resultado = 0;
        if (ResponderPelaChave(ChaveDoSysctlPorNome(nome), antigo, tamanhoAntigo, &resultado)) return resultado;
    }
    return original_sysctlbyname(nome, antigo, tamanhoAntigo, novo, tamanhoNovo);
}

static int ganchoSysctl(int *nome, u_int tamanhoDoNome, void *antigo, size_t *tamanhoAntigo, const void *novo, size_t tamanhoNovo) {
    if (EhLeituraDeHardware(nome, tamanhoDoNome, novo)) {
        int resultado = 0;
        if (ResponderPelaChave(ChaveDoSysctlPorCodigo(nome[1]), antigo, tamanhoAntigo, &resultado)) return resultado;
    }
    return original_sysctl(nome, tamanhoDoNome, antigo, tamanhoAntigo, novo, tamanhoNovo);
}

void InstalarGanchosDoSysctl(void) {
    MSHookFunction((void *)sysctlbyname, (void *)ganchoSysctlbyname, (void **)&original_sysctlbyname);
    MSHookFunction((void *)sysctl, (void *)ganchoSysctl, (void **)&original_sysctl);
}
