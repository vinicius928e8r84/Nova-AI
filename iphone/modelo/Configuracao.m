#import "Configuracao.h"
#import <sys/stat.h>

static NSString *const kControle = @"/var/tmp/nova-model-control.json";

static NSRecursiveLock *trava;
static NSDictionary<NSString *, NSString *> *tabelaDeSpoof;
static BOOL habilitado;
static BOOL carregado;
static struct timespec dataDoArquivo;
static off_t tamanhoDoArquivo;

void PrepararConfiguracao(void) {
    trava = [NSRecursiveLock new];
}

static void DescartarConfiguracao(void) {
    [trava lock];
    habilitado = NO;
    tabelaDeSpoof = nil;
    carregado = NO;
    [trava unlock];
}

static void PublicarConfiguracao(NSDictionary<NSString *, NSString *> *tabela, const struct stat *arquivo) {
    [trava lock];
    habilitado = tabela[@"ProductType"] != nil;
    tabelaDeSpoof = tabela;
    carregado = YES;
    tamanhoDoArquivo = arquivo->st_size;
    dataDoArquivo = arquivo->st_mtimespec;
    [trava unlock];
}

static BOOL ArquivoIgualAoCarregado(const struct stat *arquivo) {
    if (!carregado || tamanhoDoArquivo != arquivo->st_size) return NO;
    return dataDoArquivo.tv_sec == arquivo->st_mtimespec.tv_sec && dataDoArquivo.tv_nsec == arquivo->st_mtimespec.tv_nsec;
}

static NSString *TextoDoControle(NSDictionary *controle, NSString *chave) {
    id valor = controle[chave];
    return [valor isKindOfClass:[NSString class]] ? valor : nil;
}

static void AcrescentarSePreenchido(NSMutableDictionary *tabela, NSString *chave, NSString *valor) {
    if (valor.length) tabela[chave] = valor;
}

static NSDictionary *TabelaDeSpoof(NSDictionary *controle) {
    NSMutableDictionary *tabela = [NSMutableDictionary dictionary];
    AcrescentarSePreenchido(tabela, @"ProductType", TextoDoControle(controle, @"productType"));
    AcrescentarSePreenchido(tabela, @"MarketingProductName", TextoDoControle(controle, @"name"));
    AcrescentarSePreenchido(tabela, @"ProductName", TextoDoControle(controle, @"productName") ?: @"iPhone");
    AcrescentarSePreenchido(tabela, @"HWModelStr", TextoDoControle(controle, @"hwModel"));
    AcrescentarSePreenchido(tabela, @"ModelNumber", TextoDoControle(controle, @"modelNumber"));
    return tabela;
}

static void LerConfiguracaoDoArquivo(const struct stat *arquivo) {
    NSData *dados = [NSData dataWithContentsOfFile:kControle];
    NSDictionary *controle = dados ? [NSJSONSerialization JSONObjectWithData:dados options:0 error:NULL] : nil;
    NSDictionary *tabela = [controle[@"enabled"] boolValue] ? TabelaDeSpoof(controle) : [NSMutableDictionary dictionary];
    PublicarConfiguracao(tabela, arquivo);
}

static void AtualizarConfiguracao(void) {
    struct stat arquivo;
    if (stat(kControle.UTF8String, &arquivo) != 0) {
        DescartarConfiguracao();
        return;
    }
    if (ArquivoIgualAoCarregado(&arquivo)) return;
    LerConfiguracaoDoArquivo(&arquivo);
}

NSString *ValorFalsificado(NSString *chave) {
    AtualizarConfiguracao();
    [trava lock];
    NSString *valor = habilitado ? tabelaDeSpoof[chave] : nil;
    [trava unlock];
    return valor;
}
