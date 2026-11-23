#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <sys/stat.h>
#include <unistd.h>
#include <string.h>

//
//

static NSString *const kControl = @"/var/tmp/nova-model-control.json";
static NSString *const kModelsPath = @"/var/jb/usr/share/novamodel/models.json";

static NSString *realProductType(void) {
    void *mg = dlopen("/usr/lib/libMobileGestalt.dylib", RTLD_LAZY);
    if (!mg) return nil;
    CFTypeRef (*MGCopyAnswer)(CFStringRef, CFDictionaryRef) =
        (CFTypeRef (*)(CFStringRef, CFDictionaryRef))dlsym(mg, "MGCopyAnswer");
    if (!MGCopyAnswer) return nil;
    CFTypeRef v = MGCopyAnswer(CFSTR("ProductType"), NULL);
    if (!v) return nil;
    return CFBridgingRelease(v);
}

static NSArray *loadModels(void) {
    NSData *data = [NSData dataWithContentsOfFile:kModelsPath];
    if (!data) return nil;
    NSDictionary *d = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    if (![d isKindOfClass:[NSDictionary class]]) return nil;
    NSArray *models = d[@"models"];
    return [models isKindOfClass:[NSArray class]] ? models : nil;
}

static NSString *nameForProductType(NSString *pt) {
    for (NSDictionary *m in loadModels()) {
        if ([m isKindOfClass:[NSDictionary class]] && [m[@"productType"] isEqualToString:pt]) {
            NSString *n = m[@"name"];
            if ([n isKindOfClass:[NSString class]] && n.length) return n;
        }
    }
    return nil;
}

static NSDictionary *readControl(void) {
    NSData *data = [NSData dataWithContentsOfFile:kControl];
    if (!data) return nil;
    NSDictionary *d = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    return [d isKindOfClass:[NSDictionary class]] ? d : nil;
}

static int cmd_status(void) {
    NSString *real = realProductType() ?: @"?";
    NSDictionary *ctl = readControl();
    BOOL enabled = ctl && [ctl[@"enabled"] boolValue] && [ctl[@"productType"] length] > 0;
    NSString *active = enabled ? ctl[@"productType"] : real;
    NSDictionary *out = @{ @"real": real, @"active": active, @"enabled": @(enabled) };
    NSData *j = [NSJSONSerialization dataWithJSONObject:out options:0 error:NULL];
    if (!j) return 3;
    printf("%s\n", [[[NSString alloc] initWithData:j encoding:NSUTF8StringEncoding] UTF8String]);
    return 0;
}

static int cmd_set(NSString *pt) {
    NSString *name = nameForProductType(pt);
    if (!name) {
        fprintf(stderr, "erro: modelo '%s' não existe no banco (%s)\n",
                pt.UTF8String ?: "(nulo)", kModelsPath.UTF8String);
        return 2;
    }
    NSDictionary *ctl = @{ @"enabled": @YES, @"productType": pt, @"name": name };
    NSData *j = [NSJSONSerialization dataWithJSONObject:ctl options:0 error:NULL];
    if (!j || ![j writeToFile:kControl atomically:YES]) {
        fprintf(stderr, "erro: não consegui gravar %s\n", kControl.UTF8String);
        return 3;
    }
    chmod(kControl.UTF8String, 0644);
    printf("ok %s -> %s (aplicado; apps/Ajustes abertos podem precisar ser reabertos)\n",
           pt.UTF8String, name.UTF8String);
    return 0;
}

static int cmd_clear(void) {
    unlink(kControl.UTF8String);
    printf("ok cleared (modelo real restaurado)\n");
    return 0;
}

static void usage(void) {
    fprintf(stderr,
            "uso:\n"
            "  novamodel set <productType>    ex.: novamodel set iPhone14,5\n"
            "  novamodel clear\n"
            "  novamodel status\n");
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc >= 3 && strcmp(argv[1], "set") == 0) {
            return cmd_set([NSString stringWithUTF8String:argv[2]]);
        }
        if (argc >= 2 && strcmp(argv[1], "clear") == 0) return cmd_clear();
        if (argc >= 2 && strcmp(argv[1], "status") == 0) return cmd_status();
        usage();
        return 1;
    }
}
