#import <Foundation/Foundation.h>

// Configuração do proxy upstream + porta local do forwarder.
@interface ProxyConfig : NSObject

@property (nonatomic, copy) NSString *host;      // host do SOCKS5 (ex.: premium-residential.evomi.com)
@property (nonatomic, assign) int port;          // porta do SOCKS5 (ex.: 1002)
@property (nonatomic, copy) NSString *user;      // usuário (pode ser vazio)
@property (nonatomic, copy) NSString *pass;      // senha (pode ser vazio)
@property (nonatomic, assign) int localPort;     // porta do proxy HTTP local (default 8899)

// Aceita (a string inteira tem que casar; a porta só tem dígitos, 1-65535):
//   socks5://host:porta:usuario:senha     (a senha pode ter ':' e '@')
//   socks5h://usuario:senha@host:porta
//   usuario:senha@host:porta
//   host:porta
// Qualquer outra forma (ex.: host:porta@usuario:senha) é RECUSADA com erro,
// nunca lida pela metade.
+ (instancetype)parse:(NSString *)raw error:(NSString **)error;

+ (NSString *)configPath;

+ (instancetype)load;
- (BOOL)save:(NSString **)error;
@end
