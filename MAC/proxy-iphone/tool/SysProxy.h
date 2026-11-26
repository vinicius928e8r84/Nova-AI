#import <Foundation/Foundation.h>

BOOL SysProxyApply(NSString *host, int port, NSString **error);
BOOL SysProxyClear(NSString **error);
NSDictionary *SysProxyCurrent(void);
