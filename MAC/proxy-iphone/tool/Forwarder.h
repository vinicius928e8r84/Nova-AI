#import <Foundation/Foundation.h>
#import "ProxyConfig.h"

// Sobe o proxy HTTP local (127.0.0.1:localPort) que encaminha tudo pelo
// upstream configurado (socks5, socks4 ou http, conforme config.scheme). Roda em foreground (launchd mantém vivo).
int run_forwarder(ProxyConfig *config);
