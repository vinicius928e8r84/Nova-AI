#import "Configuracao.h"
#import "GanchosMobileGestalt.h"
#import "GanchosSysctl.h"
#import "GanchosUIDevice.h"

__attribute__((constructor)) static void IniciarNovaModel(void) {
    @autoreleasepool {
        if ([[NSProcessInfo processInfo].processName isEqualToString:@"novamodel"]) return;
        PrepararConfiguracao();
        InstalarGanchosDoMobileGestalt();
        InstalarGanchosDoSysctl();
        InstalarGanchosDoUIDevice();
    }
}
