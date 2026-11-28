#import <sys/stat.h>
#import "roteiro.h"

static long relogio;

NSString *CaminhoDoControle(void) {
    return @(getenv("NOVAMODEL_CONTROLE"));
}

void DefinirDataDoControle(struct timespec data) {
    struct timespec datas[2] = { data, data };
    utimensat(AT_FDCWD, CaminhoDoControle().UTF8String, datas, 0);
}

struct timespec DataDoControle(void) {
    struct stat info;
    stat(CaminhoDoControle().UTF8String, &info);
    return info.st_mtimespec;
}

void GravarControle(ConteudoDoControle conteudo) {
    [conteudo writeToFile:CaminhoDoControle() atomically:NO encoding:NSUTF8StringEncoding error:nil];
    DefinirDataDoControle((struct timespec){ 1000000000 + ++relogio, 0 });
}

void ApagarControle(void) {
    unlink(CaminhoDoControle().UTF8String);
}
