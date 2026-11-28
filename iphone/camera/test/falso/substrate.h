#import <Foundation/Foundation.h>
#import <objc/runtime.h>

void MSHookMessageEx(Class classe, SEL seletor, IMP substituto, IMP *original);
