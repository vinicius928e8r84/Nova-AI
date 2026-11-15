#import <Foundation/Foundation.h>
#import "ProxyConfig.h"

// Sobe o proxy HTTP local (127.0.0.1:localPort) que encaminha tudo
// pelo SOCKS5 configurado. Roda em foreground (launchd mantém vivo).
int run_forwarder(ProxyConfig *config);
