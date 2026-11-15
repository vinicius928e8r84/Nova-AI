#import <Foundation/Foundation.h>

// Escreve/lê o proxy do serviço Wi-Fi via SystemConfiguration (mesma via do networksetup).
BOOL SysProxyApply(NSString *host, int port, NSString **error);
BOOL SysProxyClear(NSString **error);
NSDictionary *SysProxyCurrent(void);
