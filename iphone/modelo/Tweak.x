#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import <substrate.h>
#import <dlfcn.h>
#import <sys/stat.h>
#import <sys/sysctl.h>
#import <sys/types.h>
#import <sys/errno.h>
#import <string.h>
#import <unistd.h>

static NSString *const kControl = @"/var/tmp/nova-model-control.json";

static NSSet<NSString *> *g_mgKeys;

static NSRecursiveLock *g_lock;
static NSDictionary<NSString *, NSString *> *g_spoof;
static BOOL g_enabled;
static BOOL g_loaded;
static struct timespec g_mtime;
static off_t g_size;

static CFTypeRef (*orig_MGCopyAnswer)(CFStringRef, CFDictionaryRef);
static CFTypeRef (*orig_MGCopyAnswerWithError)(CFStringRef, CFDictionaryRef, CFErrorRef *);
static CFStringRef (*orig_MGGetStringAnswer)(CFStringRef);
static int (*orig_sysctlbyname)(const char *, void *, size_t *, void *, size_t);
static int (*orig_sysctl)(int *, u_int, void *, size_t *, const void *, size_t);
static id (*orig_uidModel)(id, SEL);
static id (*orig_uidLocalizedModel)(id, SEL);
static id (*orig_uidModelName)(id, SEL);
static id (*orig_uidModelName2)(id, SEL);

static void refreshConfig(void) {
    struct stat st;
    if (stat(kControl.UTF8String, &st) != 0) {
        [g_lock lock];
        g_enabled = NO;
        g_spoof = nil;
        g_loaded = NO;
        [g_lock unlock];
        return;
    }
    if (g_loaded && g_size == st.st_size &&
        g_mtime.tv_sec == st.st_mtimespec.tv_sec &&
        g_mtime.tv_nsec == st.st_mtimespec.tv_nsec) {
        return;
    }
    NSData *data = [NSData dataWithContentsOfFile:kControl];
    NSDictionary *d = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;
    BOOL enabled = [d[@"enabled"] boolValue];
    NSString *pt  = [d[@"productType"] isKindOfClass:[NSString class]] ? d[@"productType"] : nil;
    NSString *name = [d[@"name"] isKindOfClass:[NSString class]] ? d[@"name"] : nil;
    NSString *pn  = [d[@"productName"] isKindOfClass:[NSString class]] ? d[@"productName"] : @"iPhone";
    NSString *hw  = [d[@"hwModel"] isKindOfClass:[NSString class]] ? d[@"hwModel"] : nil;
    NSString *mn  = [d[@"modelNumber"] isKindOfClass:[NSString class]] ? d[@"modelNumber"] : nil;

    NSMutableDictionary *spoof = [NSMutableDictionary dictionary];
    if (enabled && pt.length)  spoof[@"ProductType"] = pt;
    if (enabled && name.length) spoof[@"MarketingProductName"] = name;
    if (enabled && pn.length)  spoof[@"ProductName"] = pn;
    if (enabled && hw.length)  spoof[@"HWModelStr"] = hw;
    if (enabled && mn.length)  spoof[@"ModelNumber"] = mn;

    [g_lock lock];
    g_enabled = enabled && pt.length;
    g_spoof = spoof;
    g_loaded = YES;
    g_size = st.st_size;
    g_mtime = st.st_mtimespec;
    [g_lock unlock];
}

static CFStringRef spoofMGString(CFStringRef question) {
    if (!question) return NULL;
    NSString *key = (__bridge NSString *)question;
    if (![g_mgKeys containsObject:key]) return NULL;
    refreshConfig();
    [g_lock lock];
    NSString *v = g_enabled ? g_spoof[key] : nil;
    CFStringRef out = v ? CFBridgingRetain(v) : NULL;
    [g_lock unlock];
    return out;
}

static CFTypeRef hook_MGCopyAnswer(CFStringRef question, CFDictionaryRef options) {
    CFStringRef s = spoofMGString(question);
    if (s) return s;
    return orig_MGCopyAnswer(question, options);
}

static CFTypeRef hook_MGCopyAnswerWithError(CFStringRef question, CFDictionaryRef options, CFErrorRef *error) {
    CFStringRef s = spoofMGString(question);
    if (s) return s;
    return orig_MGCopyAnswerWithError(question, options, error);
}

static CFStringRef hook_MGGetStringAnswer(CFStringRef question) {
    CFStringRef s = spoofMGString(question);
    if (s) return s;
    return orig_MGGetStringAnswer(question);
}

static BOOL emitSpoofForSysctl(NSString *key, void *oldp, size_t *oldlenp, int *result) {
    refreshConfig();
    [g_lock lock];
    NSString *v = g_enabled ? g_spoof[key] : nil;
    if (!v) { [g_lock unlock]; return NO; }
    const char *u = [v UTF8String];
    size_t need = strlen(u) + 1;
    int r = 0;
    if (oldp == NULL) {
        if (oldlenp) *oldlenp = need;
    } else if (oldlenp == NULL || *oldlenp < need) {
        if (oldlenp) *oldlenp = need;
        errno = ENOMEM;
        r = -1;
    } else {
        memcpy(oldp, u, need);
        *oldlenp = need;
    }
    [g_lock unlock];
    *result = r;
    return YES;
}

static int hook_sysctlbyname(const char *name, void *oldp, size_t *oldlenp, void *newp, size_t newlen) {
    if (name && newp == NULL) {
        NSString *key = nil;
        if (strcmp(name, "hw.machine") == 0) key = @"ProductType";
        else if (strcmp(name, "hw.product") == 0) key = @"MarketingProductName";
        if (key) {
            int r = 0;
            if (emitSpoofForSysctl(key, oldp, oldlenp, &r)) return r;
        }
    }
    return orig_sysctlbyname(name, oldp, oldlenp, newp, newlen);
}

static int hook_sysctl(int *name, u_int namelen, void *oldp, size_t *oldlenp, const void *newp, size_t newlen) {
    if (name && newp == NULL && namelen >= 2 && name[0] == CTL_HW) {
        NSString *key = nil;
        if (name[1] == HW_MACHINE) key = @"ProductType";
#ifdef HW_PRODUCT
        else if (name[1] == HW_PRODUCT) key = @"MarketingProductName";
#endif
        if (key) {
            int r = 0;
            if (emitSpoofForSysctl(key, oldp, oldlenp, &r)) return r;
        }
    }
    return orig_sysctl(name, namelen, oldp, oldlenp, newp, newlen);
}

static id spoofUIDeviceValue(NSString *key) {
    refreshConfig();
    [g_lock lock];
    NSString *v = g_enabled ? g_spoof[key] : nil;
    [g_lock unlock];
    if (!v) return nil;
    return [NSString stringWithString:v];
}

static id hook_uidModel(id self, SEL sel) {
    id s = spoofUIDeviceValue(@"ProductName");
    if (s) return s;
    return orig_uidModel(self, sel);
}

static id hook_uidLocalizedModel(id self, SEL sel) {
    id s = spoofUIDeviceValue(@"MarketingProductName");
    if (s) return s;
    return orig_uidLocalizedModel(self, sel);
}

static id hook_uidModelName(id self, SEL sel) {
    id s = spoofUIDeviceValue(@"MarketingProductName");
    if (s) return s;
    return orig_uidModelName(self, sel);
}

static id hook_uidModelName2(id self, SEL sel) {
    id s = spoofUIDeviceValue(@"MarketingProductName");
    if (s) return s;
    return orig_uidModelName2(self, sel);
}

static void installHooks(void) {
    void *mg = dlopen("/usr/lib/libMobileGestalt.dylib", RTLD_LAZY);
    void *ca = mg ? dlsym(mg, "MGCopyAnswer") : NULL;
    void *caE = mg ? dlsym(mg, "MGCopyAnswerWithError") : NULL;
    void *gsa = mg ? dlsym(mg, "MGGetStringAnswer") : NULL;
    if (ca)  MSHookFunction(ca, (void *)hook_MGCopyAnswer, (void **)&orig_MGCopyAnswer);
    if (caE) MSHookFunction(caE, (void *)hook_MGCopyAnswerWithError, (void **)&orig_MGCopyAnswerWithError);
    if (gsa) MSHookFunction(gsa, (void *)hook_MGGetStringAnswer, (void **)&orig_MGGetStringAnswer);

    MSHookFunction((void *)sysctlbyname, (void *)hook_sysctlbyname, (void **)&orig_sysctlbyname);
    MSHookFunction((void *)sysctl, (void *)hook_sysctl, (void **)&orig_sysctl);

    Class uid = objc_getClass("UIDevice");
    if (!uid) return;
    MSHookMessageEx(uid, sel_registerName("model"), (IMP)hook_uidModel, (IMP *)&orig_uidModel);
    MSHookMessageEx(uid, sel_registerName("localizedModel"), (IMP)hook_uidLocalizedModel, (IMP *)&orig_uidLocalizedModel);
    if (class_getInstanceMethod(uid, sel_registerName("modelName")))
        MSHookMessageEx(uid, sel_registerName("modelName"), (IMP)hook_uidModelName, (IMP *)&orig_uidModelName);
    if (class_getInstanceMethod(uid, sel_registerName("_modelName")))
        MSHookMessageEx(uid, sel_registerName("_modelName"), (IMP)hook_uidModelName2, (IMP *)&orig_uidModelName2);
}

%ctor {
    @autoreleasepool {
        NSString *proc = [NSProcessInfo processInfo].processName;
        if ([proc isEqualToString:@"novamodel"]) return;

        g_lock = [NSRecursiveLock new];
        g_mgKeys = [NSSet setWithObjects:@"ProductType", @"HWModelStr",
            @"ModelNumber", @"ProductName", @"MarketingProductName", nil];
        installHooks();
    }
}
