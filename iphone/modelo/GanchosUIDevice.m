#import "GanchosUIDevice.h"
#import "Configuracao.h"
#import <objc/runtime.h>
#import <objc/message.h>
#import <substrate.h>

static id (*original_model)(id, SEL);
static id (*original_localizedModel)(id, SEL);
static id (*original_modelName)(id, SEL);
static id (*original__modelName)(id, SEL);

static id ValorDoUIDevice(NSString *chave) {
    NSString *valor = ValorFalsificado(chave);
    return valor ? [NSString stringWithString:valor] : nil;
}

static id ganchoModel(id instancia, SEL seletor) {
    return ValorDoUIDevice(@"ProductName") ?: original_model(instancia, seletor);
}

static id ganchoLocalizedModel(id instancia, SEL seletor) {
    return ValorDoUIDevice(@"MarketingProductName") ?: original_localizedModel(instancia, seletor);
}

static id ganchoModelName(id instancia, SEL seletor) {
    return ValorDoUIDevice(@"MarketingProductName") ?: original_modelName(instancia, seletor);
}

static id ganchoModelNameComSublinhado(id instancia, SEL seletor) {
    return ValorDoUIDevice(@"MarketingProductName") ?: original__modelName(instancia, seletor);
}

static void InstalarGancho(Class classe, const char *nome, IMP gancho, IMP *original) {
    MSHookMessageEx(classe, sel_registerName(nome), gancho, original);
}

static void InstalarGanchoSeExistir(Class classe, const char *nome, IMP gancho, IMP *original) {
    if (class_getInstanceMethod(classe, sel_registerName(nome))) InstalarGancho(classe, nome, gancho, original);
}

void InstalarGanchosDoUIDevice(void) {
    Class uidevice = objc_getClass("UIDevice");
    if (!uidevice) return;
    InstalarGancho(uidevice, "model", (IMP)ganchoModel, (IMP *)&original_model);
    InstalarGancho(uidevice, "localizedModel", (IMP)ganchoLocalizedModel, (IMP *)&original_localizedModel);
    InstalarGanchoSeExistir(uidevice, "modelName", (IMP)ganchoModelName, (IMP *)&original_modelName);
    InstalarGanchoSeExistir(uidevice, "_modelName", (IMP)ganchoModelNameComSublinhado, (IMP *)&original__modelName);
}
