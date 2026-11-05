#import "SysProxy.h"
#import <CoreFoundation/CoreFoundation.h>

// SCPreferences é API de macOS: o SDK do iOS marca como indisponível, mas o
// framework exporta os símbolos (é o que o networksetup usa no macOS).
// Declaramos na mão para poder usar no iPhone com root.
typedef struct __SCPreferences *SCPreferencesRef;
extern SCPreferencesRef SCPreferencesCreate(CFAllocatorRef allocator, CFStringRef name, CFStringRef prefsID);
extern Boolean SCPreferencesLock(SCPreferencesRef prefs, Boolean wait);
extern void SCPreferencesUnlock(SCPreferencesRef prefs);
extern CFPropertyListRef SCPreferencesGetValue(SCPreferencesRef prefs, CFStringRef key);
extern Boolean SCPreferencesSetValue(SCPreferencesRef prefs, CFStringRef key, CFPropertyListRef value);
extern Boolean SCPreferencesCommitChanges(SCPreferencesRef prefs);
extern Boolean SCPreferencesApplyChanges(SCPreferencesRef prefs);

static CFStringRef kNetworkServices = CFSTR("NetworkServices");

// No iPhone o serviço Wi-Fi não usa Type=IEEE80211: vem como
// Interface.Hardware = "AirPort" e Type = "Ethernet", com nome "Wi-Fi".
static BOOL isWifiService(NSDictionary *svc) {
    if (![svc isKindOfClass:[NSDictionary class]]) return NO;
    if ([svc[@"UserDefinedName"] isEqualToString:@"Wi-Fi"]) return YES;
    NSDictionary *iface = svc[@"Interface"];
    if ([iface[@"Type"] isEqualToString:@"IEEE80211"]) return YES;
    if ([iface[@"Hardware"] isEqualToString:@"AirPort"]) return YES;
    if ([iface[@"UserDefinedName"] isEqualToString:@"Wi-Fi"]) return YES;
    return NO;
}

static NSMutableDictionary *wifiServices(SCPreferencesRef prefs, BOOL mutableCopy) {
    NSDictionary *services = (__bridge NSDictionary *)SCPreferencesGetValue(prefs, kNetworkServices);
    if (![services isKindOfClass:[NSDictionary class]]) return nil;
    if (!mutableCopy) return services.mutableCopy;
    NSData *data = [NSPropertyListSerialization dataWithPropertyList:services
                                                              format:NSPropertyListBinaryFormat_v1_0
                                                             options:0 error:nil];
    return [NSPropertyListSerialization propertyListWithData:data
                                                     options:NSPropertyListMutableContainersAndLeaves
                                                      format:NULL error:nil];
}

static BOOL commit(SCPreferencesRef prefs, NSMutableDictionary *services, NSString **error) {
    if (!SCPreferencesSetValue(prefs, kNetworkServices, (__bridge CFPropertyListRef)services)) {
        if (error) *error = @"SCPreferencesSetValue falhou";
        return NO;
    }
    if (!SCPreferencesCommitChanges(prefs)) {
        if (error) *error = @"SCPreferencesCommitChanges falhou";
        return NO;
    }
    if (!SCPreferencesApplyChanges(prefs)) {
        if (error) *error = @"SCPreferencesApplyChanges falhou";
        return NO;
    }
    return YES;
}

BOOL SysProxyApply(NSString *host, int port, NSString **error) {
    SCPreferencesRef prefs = SCPreferencesCreate(NULL, CFSTR("com.aquiles.novaproxy"), NULL);
    if (!prefs) {
        if (error) *error = @"SCPreferencesCreate falhou";
        return NO;
    }
    // No iOS o lock do SCPreferences pode não ser suportado; o iOS-ProxyTool
    // ignora o retorno e o commit funciona. Seguimos o mesmo caminho.
    BOOL locked = SCPreferencesLock(prefs, true);

    BOOL ok = NO;
    NSMutableDictionary *services = wifiServices(prefs, YES);
    if (!services) {
        if (error) *error = @"serviço Wi-Fi não encontrado no sistema";
    } else {
        BOOL found = NO;
        for (NSString *key in services) {
            NSMutableDictionary *svc = services[key];
            if (!isWifiService(svc)) continue;
            found = YES;
            NSMutableDictionary *proxies = svc[@"Proxies"];
            if (![proxies isKindOfClass:[NSMutableDictionary class]]) {
                proxies = [NSMutableDictionary dictionary];
                svc[@"Proxies"] = proxies;
            }
            proxies[@"HTTPEnable"] = @1;
            proxies[@"HTTPProxy"] = host;
            proxies[@"HTTPPort"] = @(port);
            proxies[@"HTTPSEnable"] = @1;
            proxies[@"HTTPSProxy"] = host;
            proxies[@"HTTPSPort"] = @(port);
            [proxies removeObjectForKey:@"SOCKSEnable"];
            [proxies removeObjectForKey:@"SOCKSProxy"];
            [proxies removeObjectForKey:@"SOCKSPort"];
            if (!proxies[@"ExceptionsList"]) {
                proxies[@"ExceptionsList"] = @[@"*.local", @"169.254/16"];
            }
        }
        if (!found) {
            if (error) *error = @"serviço Wi-Fi não encontrado no sistema";
        } else {
            ok = commit(prefs, services, error);
            if (!ok && error && *error && !locked) {
                *error = [*error stringByAppendingString:@" (lock também falhou)"];
            }
        }
    }

    if (locked) SCPreferencesUnlock(prefs);
    CFRelease(prefs);
    return ok;
}

BOOL SysProxyClear(NSString **error) {
    SCPreferencesRef prefs = SCPreferencesCreate(NULL, CFSTR("com.aquiles.novaproxy"), NULL);
    if (!prefs) {
        if (error) *error = @"SCPreferencesCreate falhou";
        return NO;
    }
    BOOL locked = SCPreferencesLock(prefs, true);

    BOOL ok = NO;
    NSMutableDictionary *services = wifiServices(prefs, YES);
    if (!services) {
        if (error) *error = @"serviço Wi-Fi não encontrado no sistema";
    } else {
        BOOL found = NO;
        for (NSString *key in services) {
            NSMutableDictionary *svc = services[key];
            if (!isWifiService(svc)) continue;
            found = YES;
            NSMutableDictionary *proxies = svc[@"Proxies"];
            if (![proxies isKindOfClass:[NSMutableDictionary class]]) continue;
            for (NSString *k in @[@"HTTPEnable", @"HTTPProxy", @"HTTPPort", @"HTTPSEnable",
                                  @"HTTPSProxy", @"HTTPSPort", @"SOCKSEnable", @"SOCKSProxy", @"SOCKSPort"]) {
                [proxies removeObjectForKey:k];
            }
        }
        if (!found) {
            if (error) *error = @"serviço Wi-Fi não encontrado no sistema";
        } else {
            ok = commit(prefs, services, error);
        }
    }

    if (locked) SCPreferencesUnlock(prefs);
    CFRelease(prefs);
    return ok;
}

NSDictionary *SysProxyCurrent(void) {
    SCPreferencesRef prefs = SCPreferencesCreate(NULL, CFSTR("com.aquiles.novaproxy"), NULL);
    if (!prefs) return nil;
    NSMutableDictionary *services = wifiServices(prefs, NO);
    NSDictionary *result = nil;
    if (services) {
        for (NSString *key in services) {
            NSDictionary *svc = services[key];
            if (!isWifiService(svc)) continue;
            if ([svc[@"Proxies"] isKindOfClass:[NSDictionary class]]) result = svc[@"Proxies"];
        }
    }
    CFRelease(prefs);
    return result;
}
