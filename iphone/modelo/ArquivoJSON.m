#import "ArquivoJSON.h"

NSDictionary *LerDicionarioJSON(NSString *caminho) {
    NSData *dados = [NSData dataWithContentsOfFile:caminho];
    if (!dados) return nil;
    NSDictionary *objeto = [NSJSONSerialization JSONObjectWithData:dados options:0 error:NULL];
    return [objeto isKindOfClass:[NSDictionary class]] ? objeto : nil;
}
