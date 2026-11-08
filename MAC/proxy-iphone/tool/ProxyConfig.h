#import <Foundation/Foundation.h>

// Configuração do proxy upstream + porta local do forwarder.
@interface ProxyConfig : NSObject

@property (nonatomic, copy) NSString *scheme;    // socks5 | socks5h | socks4 | socks4a | http | https
@property (nonatomic, copy) NSString *host;      // host do proxy (ex.: premium-residential.evomi.com)
@property (nonatomic, assign) int port;          // porta do proxy (ex.: 1002)
@property (nonatomic, copy) NSString *user;      // usuário (pode ser vazio)
@property (nonatomic, copy) NSString *pass;      // senha (pode ser vazio)
@property (nonatomic, assign) int localPort;     // porta do proxy HTTP local (default 8899)
@property (nonatomic, assign) BOOL schemeGuessed; // YES quando o esquema veio da porta, não da string

// Extrai só o que é necessário (esquema, host, porta, usuário, senha) e ignora
// o resto do enfeite da string. Aceita, nesta ordem de prioridade:
//
//   esquema://host:porta:usuario:senha    (formato do painel da Evomi)
//   esquema://usuario:senha@host:porta    (formato URL)
//   esquema://host:porta@usuario:senha    (ordem invertida da Evomi)
//   esquema://host:porta
//   (sem esquema) as mesmas quatro formas terminando em host:porta
//
// Esquemas aceitos: socks5, socks5h, socks4, socks4a, http, https.
// Sem esquema: usa a pista da porta (1000/3128/8080/8888 = http, 1001 = https,
// o resto = socks5) e marca schemeGuessed para quem chama avisar o usuário.
//
// Ambiguidade conhecida: "a:1@b:2" casa como usuario:senha@host:porta (ordem URL),
// que é a padrão; a ordem invertida só é usada quando a URL não fecha.
//
// Recusa (com erro) só o que é inutilizável: string vazia, sem porta, porta que
// não é 1-65535, host vazio/curto, esquema desconhecido.
+ (instancetype)parse:(NSString *)raw error:(NSString **)error;

+ (NSString *)configPath;

+ (instancetype)load;
- (BOOL)save:(NSString **)error;
@end
