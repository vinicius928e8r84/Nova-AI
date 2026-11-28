#import "Varredura.h"

static NSString *const kSufixoDePlist = @".plist";

static NSArray<NSString *> *PastasDaVariavel(const char *ambiente) {
    NSMutableArray<NSString *> *pastas = [NSMutableArray array];
    for (NSString *pasta in [[NSString stringWithUTF8String:ambiente] componentsSeparatedByString:@":"]) {
        if (pasta.length) [pastas addObject:pasta];
    }
    return pastas;
}

static NSArray<NSString *> *PastasDePreferencias(void) {
    const char *ambiente = getenv("NOVALANGUAGE_PREFS_DIRS");
    if (ambiente && ambiente[0]) return PastasDaVariavel(ambiente);
    return @[ @"/var/mobile/Library/Preferences",
              @"/var/mobile/Containers/Data/Application",
              @"/var/mobile/Containers/Shared/AppGroup" ];
}

static NSArray<NSString *> *ConteudoDaPasta(CaminhoDePasta pasta) {
    return [[NSFileManager defaultManager] contentsOfDirectoryAtPath:pasta error:nil];
}

static BOOL TemArquivoDePlist(CaminhoDePasta pasta) {
    for (NomeDeArquivo arquivo in ConteudoDaPasta(pasta)) if ([arquivo hasSuffix:kSufixoDePlist]) return YES;
    return NO;
}

static BOOL EhPastaDePreferenciasPlana(CaminhoDePasta pasta) {
    if ([pasta hasSuffix:@"/Preferences"] || [pasta hasSuffix:@"/prefs"]) return YES;
    return [[NSFileManager defaultManager] fileExistsAtPath:pasta] && TemArquivoDePlist(pasta);
}

static BOOL PlistTemIdiomaProprio(CaminhoDeArquivo caminho) {
    NSDictionary *plist = [NSDictionary dictionaryWithContentsOfFile:caminho];
    return [plist isKindOfClass:[NSDictionary class]] && plist[@"AppleLanguages"];
}

static BOOL PastaTemPlistComIdiomaProprio(CaminhoDePasta pasta) {
    for (NomeDeArquivo arquivo in ConteudoDaPasta(pasta)) {
        if ([arquivo hasSuffix:kSufixoDePlist] && PlistTemIdiomaProprio([pasta stringByAppendingPathComponent:arquivo])) return YES;
    }
    return NO;
}

static void AcrescentarPastaPlana(NSMutableSet<NSString *> *achados, CaminhoDePasta pasta) {
    for (NomeDeArquivo arquivo in ConteudoDaPasta(pasta)) {
        if (![arquivo hasSuffix:kSufixoDePlist] || [arquivo hasPrefix:@"."]) continue;
        if (PlistTemIdiomaProprio([pasta stringByAppendingPathComponent:arquivo])) [achados addObject:[arquivo stringByDeletingPathExtension]];
    }
}

static NSString *IdentificadorDoContainer(NomeDeContainer container, CaminhoDePasta pastaDoContainer) {
    NSString *metadados = [pastaDoContainer stringByAppendingPathComponent:@".com.apple.mobile_container_manager.metadata.plist"];
    NSDictionary *plist = [NSDictionary dictionaryWithContentsOfFile:metadados];
    NSString *identificador = [plist isKindOfClass:[NSDictionary class]] ? plist[@"MCMMetadataIdentifier"] : nil;
    if ([identificador isKindOfClass:[NSString class]] && identificador.length) return identificador;
    return container;
}

static void AcrescentarContainers(NSMutableSet<NSString *> *achados, CaminhoDePasta pasta) {
    for (NomeDeContainer container in ConteudoDaPasta(pasta)) {
        NSString *pastaDoContainer = [pasta stringByAppendingPathComponent:container];
        if (PastaTemPlistComIdiomaProprio([pastaDoContainer stringByAppendingPathComponent:@"Library/Preferences"])) {
            [achados addObject:IdentificadorDoContainer(container, pastaDoContainer)];
        }
    }
}

NSArray<NSString *> *AppsComIdiomaProprio(void) {
    NSMutableSet<NSString *> *achados = [NSMutableSet set];
    for (CaminhoDePasta pasta in PastasDePreferencias()) {
        if (EhPastaDePreferenciasPlana(pasta)) AcrescentarPastaPlana(achados, pasta);
        else AcrescentarContainers(achados, pasta);
    }
    return [achados.allObjects sortedArrayUsingSelector:@selector(compare:)];
}
