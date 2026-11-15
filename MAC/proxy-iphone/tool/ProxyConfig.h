#import <Foundation/Foundation.h>

// Configuração do proxy upstream + porta local do forwarder.
@interface ProxyConfig : NSObject

@property (nonatomic, copy) NSString *host;      // host do SOCKS5 (ex.: premium-residential.evomi.com)
@property (nonatomic, assign) int port;          // porta do SOCKS5 (ex.: 1002)
@property (nonatomic, copy) NSString *user;      // usuário (pode ser vazio)
@property (nonatomic, copy) NSString *pass;      // senha (pode ser vazio)
@property (nonatomic, assign) int localPort;     // porta do proxy HTTP local (default 8899)

// Aceita:
//   socks5://host:porta:usuario:senha
//   socks5h://usuario:senha@host:porta
//   usuario:senha@host:porta
//   host:porta
+ (instancetype)parse:(NSString *)raw error:(NSString **)error;

+ (NSString *)configPath;

+ (instancetype)load;
- (BOOL)save:(NSString **)error;
@end
