#import "ArquivoDeControle.h"
#import "ArquivoJSON.h"
#include <sys/stat.h>
#include <unistd.h>

NSString *CaminhoDoControle(void) {
    return @"/var/tmp/nova-model-control.json";
}

NSDictionary *LerControle(void) {
    return LerDicionarioJSON(CaminhoDoControle());
}

BOOL ControleHabilitado(NSDictionary *controle) {
    if (!controle) return NO;
    return [controle[@"enabled"] boolValue] && [controle[@"productType"] length] > 0;
}

BOOL GravarControle(TipoDeProduto tipo, NSString *nome) {
    NSDictionary *controle = @{ @"enabled": @YES, @"productType": tipo, @"name": nome };
    NSData *json = [NSJSONSerialization dataWithJSONObject:controle options:0 error:NULL];
    if (!json || ![json writeToFile:CaminhoDoControle() atomically:YES]) return NO;
    chmod(CaminhoDoControle().UTF8String, 0644);
    return YES;
}

void RemoverControle(void) {
    unlink(CaminhoDoControle().UTF8String);
}
