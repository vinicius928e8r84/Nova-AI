#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <sys/time.h>

typedef NSString *NomeDaFuncao;
typedef NSString *NomeDoSeletor;
typedef NSString *PerguntaDoMG;
typedef NSString *ConteudoDoControle;
typedef NSString *Rotulo;
typedef void *AlvoDeFuncao;

void *GanchoDaFuncao(AlvoDeFuncao alvo);
IMP GanchoDoMetodo(NomeDoSeletor seletor);
AlvoDeFuncao AlvoDoMobileGestalt(NomeDaFuncao funcao);
void MostrarInstalacao(void);

void GravarControle(ConteudoDoControle conteudo);
void ApagarControle(void);
struct timespec DataDoControle(void);
void DefinirDataDoControle(struct timespec data);
NSString *CaminhoDoControle(void);

void MostrarCenasDoMG(void);
void MostrarCenasDoSysctl(void);
void MostrarCenasDoUIDevice(void);
