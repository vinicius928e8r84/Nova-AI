#import <Foundation/Foundation.h>
#import <objc/runtime.h>

void MSHookFunction(void *alvo, void *gancho, void **original);
void MSHookMessageEx(Class classe, SEL seletor, IMP gancho, IMP *original);
