#import <sys/sysctl.h>
#import "roteiro.h"

typedef int (*SysctlPorNome)(const char *, void *, size_t *, void *, size_t);
typedef int (*SysctlPorCodigo)(int *, u_int, void *, size_t *, const void *, size_t);

typedef struct {
    int resultado;
    int erro;
    size_t tamanho;
    char texto[64];
} RespostaDoSysctl;

typedef struct {
    const char *nome;
    size_t capacidade;
    BOOL comEscrita;
} ConsultaPorNome;

typedef struct {
    int *nome;
    u_int tamanhoDoNome;
    BOOL comEscrita;
} ConsultaPorCodigo;

static RespostaDoSysctl ChamarPorNome(SysctlPorNome funcao, ConsultaPorNome consulta) {
    RespostaDoSysctl resposta = { 0, 0, consulta.capacidade, "" };
    char *destino = consulta.capacidade ? resposta.texto : NULL;
    resposta.resultado = funcao(consulta.nome, destino, &resposta.tamanho, consulta.comEscrita ? resposta.texto : NULL, consulta.comEscrita ? 1 : 0);
    resposta.erro = resposta.resultado ? errno : 0;
    return resposta;
}

static RespostaDoSysctl ChamarPorCodigo(SysctlPorCodigo funcao, ConsultaPorCodigo consulta) {
    RespostaDoSysctl resposta = { 0, 0, sizeof(resposta.texto), "" };
    const void *novo = consulta.comEscrita ? resposta.texto : NULL;
    resposta.resultado = funcao(consulta.nome, consulta.tamanhoDoNome, resposta.texto, &resposta.tamanho, novo, consulta.comEscrita ? 1 : 0);
    resposta.erro = resposta.resultado ? errno : 0;
    return resposta;
}

static BOOL RespostasIguais(RespostaDoSysctl a, RespostaDoSysctl b) {
    if (a.resultado != b.resultado || a.erro != b.erro) return NO;
    return a.tamanho == b.tamanho && memcmp(a.texto, b.texto, sizeof(a.texto)) == 0;
}

static void MostrarResposta(Rotulo rotulo, RespostaDoSysctl doGancho, RespostaDoSysctl direta) {
    if (RespostasIguais(doGancho, direta)) {
        printf("  %s: igual ao original\n", rotulo.UTF8String);
        return;
    }
    printf("  %s: resultado=%d errno=%d tamanho=%zu texto=%s\n", rotulo.UTF8String, doGancho.resultado, doGancho.erro, doGancho.tamanho, doGancho.texto);
}

static void MostrarSysctlPorNome(ConsultaPorNome consulta) {
    SysctlPorNome gancho = GanchoDaFuncao((void *)sysctlbyname);
    Rotulo rotulo = [NSString stringWithFormat:@"sysctlbyname(%s, capacidade %zu, escrita %d)", consulta.nome, consulta.capacidade, consulta.comEscrita];
    MostrarResposta(rotulo, ChamarPorNome(gancho, consulta), ChamarPorNome(sysctlbyname, consulta));
}

static void MostrarSysctlPorCodigo(Rotulo rotulo, ConsultaPorCodigo consulta) {
    SysctlPorCodigo gancho = GanchoDaFuncao((void *)sysctl);
    MostrarResposta(rotulo, ChamarPorCodigo(gancho, consulta), ChamarPorCodigo((SysctlPorCodigo)sysctl, consulta));
}

static void CenasDoSysctlPorNome(void) {
    printf("== sysctlbyname\n");
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\"}");
    MostrarSysctlPorNome((ConsultaPorNome){ "hw.machine", 64, NO });
    MostrarSysctlPorNome((ConsultaPorNome){ "hw.product", 64, NO });
    MostrarSysctlPorNome((ConsultaPorNome){ "hw.machine", 11, NO });
    MostrarSysctlPorNome((ConsultaPorNome){ "hw.machine", 10, NO });
    MostrarSysctlPorNome((ConsultaPorNome){ "hw.machine", 64, YES });
    MostrarSysctlPorNome((ConsultaPorNome){ "hw.ncpu", 64, NO });
}

static void CenasDoSysctlPorNomeSemBuffer(void) {
    SysctlPorNome gancho = GanchoDaFuncao((void *)sysctlbyname);
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
    SysctlPorNome gancho = GanchoDaFuncao((void *)sysctlbyname);
    ConsultaPorNome consulta = { "hw.machine", 64, NO };
    MostrarResposta(@"hw.machine sem controle", ChamarPorNome(gancho, consulta), ChamarPorNome(sysctlbyname, consulta));
}

static void CenasDoSysctlPorCodigo(void) {
    printf("== sysctl\n");
    GravarControle(@"{\"enabled\":true,\"productType\":\"iPhone14,5\",\"name\":\"iPhone 13\"}");
    int maquina[2] = { CTL_HW, HW_MACHINE };
    int produto[2] = { CTL_HW, HW_PRODUCT };
    int processadores[2] = { CTL_HW, HW_NCPU };
    int outroGrupo[2] = { CTL_KERN, HW_MACHINE };
    MostrarSysctlPorCodigo(@"hw.machine", (ConsultaPorCodigo){ maquina, 2, NO });
    MostrarSysctlPorCodigo(@"hw.product", (ConsultaPorCodigo){ produto, 2, NO });
    MostrarSysctlPorCodigo(@"hw.machine com escrita", (ConsultaPorCodigo){ maquina, 2, YES });
    MostrarSysctlPorCodigo(@"hw.machine com nome curto", (ConsultaPorCodigo){ maquina, 1, NO });
    MostrarSysctlPorCodigo(@"hw.ncpu", (ConsultaPorCodigo){ processadores, 2, NO });
    MostrarSysctlPorCodigo(@"kern com o código de hw.machine", (ConsultaPorCodigo){ outroGrupo, 2, NO });
}

void MostrarCenasDoSysctl(void) {
    CenasDoSysctlPorNome();
    CenasDoSysctlPorNomeSemBuffer();
    CenaDoSysctlPorNomeSemSpoof();
    CenasDoSysctlPorCodigo();
}
