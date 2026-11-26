# O corte da ponte da câmera do iPhone (`bridge/Tweak.x`) em arquivos `.m`

Esta é a pesquisa do ticket [Pesquisa: o corte da ponte da câmera do iPhone (bridge/Tweak.x) em arquivos .m](https://github.com/vinicius928e8r84/Nova-AI/issues/190), do mapa [Nova-AI na nota 10 no CodeScene: o plano, com a fila de lotes e as regras que seguram](https://github.com/vinicius928e8r84/Nova-AI/issues/120). Foi feita em 26/11/2026 sobre a `main` em `96ea7ce`, que é também a revisão da análise 161 do painel (26/11, 20:54 UTC). A `main` andou para `4b398b1` antes desta PR. No caminho da ponte, só o `Pipeline.h` mudou: perdeu os comentários, e o código ficou igual. O `Tweak.x` ficou idêntico. Ela parte do que o dono já decidiu em [O código em Objective-C e Logos: o roteiro de corte e de prova](https://github.com/vinicius928e8r84/Nova-AI/issues/134) e usa as seções 2.1, 4 e 5 de [Pesquisa: como se corta e se prova o código em Objective-C e Logos](https://github.com/vinicius928e8r84/Nova-AI/issues/133).

**Como foi feita.** Li o `Tweak.x`, o `Pipeline.h`, o `Makefile`, o `control`, os ADRs 0050 a 0055 e o `setup.js`. Li o painel só com GET, usando o token do dono, sem mudar nada. Depois montei uma divisão de teste fora do repositório: um script cortou o `Tweak.x` pelas linhas da tabela da seção 2 e gerou os arquivos. Compilei essa divisão no Mac de prova (macOS 15.6.1, Apple clang 17) contra o SDK do macOS, com um `substrate.h` falso, e comparei o binário com o do arquivo inteiro. Apaguei tudo depois. **Não compilei para iOS:** o Mac de prova ainda não tem Theos nem o SDK do iOS. Também não instalei nada no iPhone.

A pesquisa tem duas partes. Esta traz a resposta, as partes e o estado compartilhado. A outra, [ponte-da-camera-prova.md](ponte-da-camera-prova.md), traz o teste no Mac, o retrato, a ordem dos cortes, a conferência do dono e o que não foi conferido.

## Resposta curta

- **As partes.** A ponte vira dez arquivos `.m` e um cabeçalho `Ponte.h`. O maior arquivo, `Foto.m`, fica com 13.641 bytes, e todos ficam abaixo de 300 linhas. O `Tweak.x` deixa de existir. O `%ctor` vira `__attribute__((constructor))` dentro de `Ganchos.m`.
- **O `Pipeline.h` sai.** Das 12 funções dele, só `VCPDrawFrame` e `VCPFormatSupported` são usadas. As outras 10 nunca chegam ao binário, o que o `nm` confirma. As duas funções usadas passam para `Quadros.m`.
- **A ordem.** O corte 1 é a divisão mecânica: move o código sem mudar nenhuma função. Os cortes 2 a 10 refatoram um arquivo cada, nesta ordem: `Estado.m`, `Controle.m`, `Audio.m`, `Quadros.m`, `Saidas.m`, `Foto.m`, `CicloDoGrafo.m`, `Grafo.m` e `Ganchos.m`. Um arquivo que o painel já der como 10 depois do corte 1 sai da fila. O mais provável é que seja o `Runtime.m`, que por isso nem entra na lista.
- **O que passa a ser compartilhado.** O arquivo tem 100 variáveis `static` no topo (97 `g_*` e 3 `k*`). No corte 1, **93 passam a ser compartilhadas**, entre elas **os 23 ponteiros `g_original*`**, e só 7 continuam `static`. Também passam a ser compartilhadas 35 funções. No fim da fila, sobram **21 compartilhadas, todas da configuração e do núcleo do grafo**, e **nenhum `g_original*`**. Para chegar lá, cada arquivo passa a montar o seu pedaço do estado e a instalar os seus próprios ganchos.
- **O binário não muda.** A divisão de teste, compilada no Mac de prova, deu o mesmo binário que o arquivo inteiro em cinco medidas: os mesmos 164 símbolos importados, os mesmos 2 exportados, as mesmas 10 bibliotecas, os mesmos 256 textos e os mesmos 202 seletores. Deu igual com `-O0` e com `-O2`, sem nenhum aviso de compilação. Isso exige uma linha a mais no cabeçalho (`#pragma GCC visibility push(hidden)`). Sem ela, o binário passa a exportar 128 símbolos novos.
- **Teste e prova.** Antes de cada corte, grava-se um teste no Mac e um retrato do pacote. Em todo corte, o dono faz os passos 1 a 11 da prova real (seção 5 da pesquisa do ticket [Pesquisa: como se corta e se prova o código em Objective-C e Logos](https://github.com/vinicius928e8r84/Nova-AI/issues/133)), com uma conferência própria para cada corte (seções 4 e 5 da segunda parte).
- **Nenhuma decisão nova do dono.** O ticket [O código em Objective-C e Logos: o roteiro de corte e de prova](https://github.com/vinicius928e8r84/Nova-AI/issues/134) já mandou seguir "a ordem que a pesquisa nova der". A conta do custo está na seção 6 da segunda parte: são até dez sessões do dono com o iPhone.

## 1. O ponto de partida

| Medida | Valor na `main` em `96ea7ce` |
| --- | --- |
| `bridge/Tweak.x` | 1.500 linhas, 79.151 bytes, 51 funções, 1 classe (`OBSBridgeContext`) |
| `bridge/Pipeline.h` | 227 linhas, 13.466 bytes, 12 funções `static`. Depois, a [PR #156](https://github.com/vinicius928e8r84/Nova-AI/pull/156) tirou os 14 comentários: na `main` em `4b398b1` são 213 linhas e 12.429 bytes, com o mesmo código |
| Variáveis `static` no topo | 100: 97 `g_*` (23 delas são ponteiros `g_original*`) e 3 constantes `k*` |
| Ganchos | 22 chamadas a `MSHookMessageEx` e 1 ponteiro lido com `class_getMethodImplementation` (`g_originalPhysicalEmitSequence`) |
| Logos | só o `%ctor` (linha 1474) |
| Painel (análise 161) | o `Tweak.x` não aparece entre os arquivos com nota, e o filtro de exclusão do projeto ainda é `*.json;*.h;*.yml;*.sh;*.md;*.min.js;*.txt;*.html;*.css` |
| Regras do repositório | `linha-de-base.json`: o `Tweak.x` tem 1.500 linhas na base do limite de linhas e 88 comentários na base de comentários; o `Pipeline.h` tem 14 comentários na base (zerados pela PR #156) |
| Versão | `0.1-39` em `bridge/control`, em `saveStatus` e no `TARGET` de `app/electron/services/iphone-setup/setup.js` |

O que cada ADR protege, para o revisor saber onde olhar em cada corte:

| ADR | O que protege | Arquivo depois da divisão |
| --- | --- | --- |
| 0050, o `mediaserverd` aborta com nome de porta que não conhece | os nomes `OBSBridge*`, `PortTypeBack` e `LastPortType` | `Quadros.m`, `Saidas.m`, `Foto.m` |
| 0051, o nó físico de um grafo redirecionado nunca inicia | início, parada, pools, semáforo e onda de preparação suprimidos | `CicloDoGrafo.m`, `Foto.m` (`bridgeDevicePrepare`) |
| 0052, um relógio e uma fonte mestre por grafo | `masterSource` e o relógio do host | `Grafo.m`, `CicloDoGrafo.m`, `Quadros.m` |
| 0053, as amostras imitam o nó nativo | anexos e formato de `copySample` | `Quadros.m` |
| 0054, concessão curta e limite de contextos | concessão de no máximo 120 s e no máximo 4 contextos | `Controle.m`, `Grafo.m` |
| 0055, o Mac fala com a câmera por socket Unix | `isCameraSocketPath` e `httpGetOverUnix` | `Controle.m`, `Quadros.m`, `Audio.m` |

## 2. As partes

A tabela usa as linhas do `Tweak.x` na `main` em `96ea7ce`. Os bytes são os da divisão de teste, já com as linhas de `#import` e as definições de variável que cada arquivo ganha.

| Arquivo | O que tem (linhas do `Tweak.x`) | Bytes | Linhas |
| --- | --- | ---: | ---: |
| `Ponte.h` | os `#import` (1 a 10, mais CoreMedia, CoreVideo, CoreImage e ImageIO, que antes vinham pelo `Pipeline.h`), a `@interface OBSBridgeContext` (98 a 125), as 93 declarações `extern` e os 35 protótipos, entre `#pragma GCC visibility push(hidden)` e `pop` | 7.874 | 175 |
| `Runtime.m` | `hasABI`, `getObject`, `numericGetter`, `ivarObject`, `ivarNumber`, `roleForOutput` (129 a 181) | 2.454 | 54 |
| `Controle.m` | `leaseValid`, `isHexTokenPath`, `isCameraSocketPath`, `httpGetOverUnix`, `appAllowed`, `readControl` (183 a 311) | 7.369 | 143 |
| `Estado.m` | `saveStatus` (313 a 381) | 4.712 | 71 |
| `Quadros.m` | `imageFromJPEG`, `copyFrame`, `copySample`, `produce`, `emitStillSequence`, `startProducer` (383 a 537, 546 a 556, 583 a 609), mais `VCPFormatSupported` e `VCPDrawFrame`, vindas do `Pipeline.h` | 12.350 | 223 |
| `Grafo.m` | `@implementation OBSBridgeContext`, `contextForGraphAndPhysical`, `createVideoSourceWithFormat`, `createVideoSource`, `createMetadataSource`, `redirectedConnect` (126 e 127, 611 a 791) | 10.466 | 190 |
| `CicloDoGrafo.m` | `physicalClockOverride`, `resumeContextConnections`, `suppressedPhysicalStart`, `Stop` e `Pools`, `bridgeGraphStart`, `bridgeGraphCommit`, `bridgeInitialSemaphore`, `bridgeDeferredStartHook`, `bridgeDeferredPrepareHook`, `bridgeGraphStop` (538 a 545, 557 a 582, 792 a 894, 1332 a 1368) | 8.554 | 195 |
| `Foto.m` | `bridgeDevicePrepare`, `bridgeStreamPrepareStill`, `bridgeTimeMachineRender`, `Handle` e `Complete`, `bridgeOutputEmit`, `bridgeCoordinatorRender`, `bridgeGNRRender` (895 a 1150) | 13.641 | 280 |
| `Audio.m` | `fetchAudio`, `copyAudioAttachment`, `sampleWithAudioPacket`, `bridgeMovieSinkRender` (1176 a 1290) | 6.118 | 124 |
| `Saidas.m` | `bridgeCompressorRender`, `bridgeQueueSinkRender` (1151 a 1175, 1291 a 1331) | 3.515 | 73 |
| `Ganchos.m` | `installHooks` e o construtor (1369 a 1500) | 9.715 | 145 |

O `Makefile` passa a ter `OBSGraphBridge_FILES = Runtime.m Controle.m Estado.m Quadros.m Grafo.m CicloDoGrafo.m Foto.m Audio.m Saidas.m Ganchos.m`, e o resto fica igual. O construtor que substitui o `%ctor` é `__attribute__((constructor)) static void iniciarPonte(void)`. Pela documentação do Logos, o `%ctor` gera um construtor anônimo de prioridade padrão, que é o mesmo que esse.

**Por que essas fronteiras.** Cada arquivo corresponde a uma coisa que o dono enxerga no iPhone: o estado que o app lê, o controle que o app escreve, a imagem, a foto, o áudio, a gravação e a prévia do Safari, a troca do grafo e o ciclo dele. Isso permite que a prova real de cada corte olhe para uma coisa só. A outra divisão que considerei punha `Grafo.m` e `CicloDoGrafo.m` num arquivo só, com 17.949 bytes. Ficaria colada no teto e somaria as três funções mais arriscadas num corte só.

### 2.1 Como medem as funções (estimativa, não é o painel)

Rodei o lizard 1.26.1 sobre a divisão de teste e contei as chaves aninhadas. O painel só mede depois do corte 1, então esta tabela é uma previsão das regras que devem aparecer:

| Função | Arquivo | Linhas | Complexidade | Argumentos | Aninhamento | Regra provável no painel |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `redirectedConnect` | `Grafo.m` | 108 | 51 | 5 | 6 | Large Method, Complex Method, Deep Nested Complexity, Bumpy Road |
| `installHooks` | `Ganchos.m` | 104 | 43 | 0 | 2 | Large Method, Complex Method |
| `produce` | `Quadros.m` | 80 | 38 | 1 | 6 | Large Method, Complex Method, Deep Nested Complexity |
| `saveStatus` | `Estado.m` | 69 | 11 | 0 | 2 | Large Method |
| `readControl` | `Controle.m` | 54 | 48 | 0 | 2 | Complex Method, Complex Conditional |
| `bridgeOutputEmit` | `Foto.m` | 59 | 31 | 3 | 3 | Complex Method, Bumpy Road |
| `fetchAudio` | `Audio.m` | 53 | 21 | 0 | 4 | Complex Method, Deep Nested Complexity |
| `bridgeStreamPrepareStill` | `Foto.m` | 53 | 21 | 3 | 4 | Complex Method, Bumpy Road |
| `httpGetOverUnix` | `Controle.m` | 44 | 15 | 4 | 4 | Complex Method, Deep Nested Complexity |
| `bridgeGNRRender` | `Foto.m` | 44 | 18 | 4 | 2 | Complex Method |
| `bridgeQueueSinkRender` | `Saidas.m` | 40 | 16 | 4 | 4 | Complex Method |
| `copySample` | `Quadros.m` | 37 | 9 | 11 | 1 | Excess Number of Function Arguments |
| de `bridgeGraphStart` a `bridgeGraphStop` | `CicloDoGrafo.m` | de 13 a 31 | de 9 a 14 | de 3 a 4 | menos de 4 | Complex Method, em parte delas |
| as seis de `Runtime.m` | `Runtime.m` | até 15 | até 8 | até 3 | menos de 3 | nenhuma provável |

A armadilha que a pesquisa do ticket [Pesquisa: como se corta e se prova o código em Objective-C e Logos](https://github.com/vinicius928e8r84/Nova-AI/issues/133) já apontou continua valendo. As funções de gancho têm a assinatura do método original (`id self, SEL _cmd, ...`), e `redirectedConnect` recebe 5 argumentos porque o método do sistema tem 3. Um aviso de argumentos demais nessas funções não tem conserto sem mudar o gancho. Se o painel acusar, o corte reduz o resto e deixa a assinatura como está. A `copySample`, com 11 argumentos, não é gancho e pode receber uma `struct`.

## 3. O que passa a ser compartilhado

### 3.1 No corte 1 (divisão mecânica)

Medi com um script, que cruzou cada variável do topo com os arquivos que a citam. Depois o compilador confirmou, porque a divisão de teste compilou sem nenhum erro de identificador.

- **Continuam `static` (7):** `kControl` (`Controle.m`), `kStatus` (`Estado.m`), `g_softwareSourceClass` (`Grafo.m`), `g_audioFetchPending` (`Audio.m`), e `g_statusTimer`, `g_audioTimer` e `g_hookAttempted` (`Ganchos.m`).
- **Passam a ser compartilhadas (93):** todas as outras. Elas se declaram `extern` no `Ponte.h` e se definem uma vez cada, no arquivo que as escreve:
  - **Os 23 ponteiros `g_original*`.** Cada um se define no arquivo do seu gancho, porque é o gancho que chama o original. Mesmo assim, todos são compartilhados, porque `installHooks`, em `Ganchos.m`, passa `&g_original*` ao `MSHookMessageEx`. Sete deles também são lidos por `saveStatus`, nos campos `*HookReady`. O `g_originalPhysicalEmitSequence` se define em `Quadros.m`, que o chama em `emitStillSequence`.
  - **O núcleo:** `g_lock`, `g_contexts`, `g_redirectedGraphs`, `g_graphClasses`, `g_observedAppIDs`, `g_controlQueue`, `g_hooksReady`, `g_photoRoute` e `g_audioPackets`. O construtor cria esses objetos, então eles se definem em `Ganchos.m`. O `g_physicalClass` se define em `Grafo.m`.
  - **A configuração que `readControl` grava:** `kCameraApp`, `g_enabled`, `g_continuous`, `g_expires`, `g_url`, `g_socket`, `g_frameRate` (com o `= 5`), `g_previewOnly`, `g_directRecording`, `g_videoInjection`, `g_audioInjection`, `g_photoPrepareBypass`, `g_remoteQueuePortType` e `g_allowedAppIDs`. Todas se definem em `Controle.m`.
  - **Os contadores e as últimas fotografias de estado:** 42 variáveis, de `g_redirected` a `g_lastGNRFrame`. Cada uma se define no arquivo que a incrementa, e quem as lê de fora é `saveStatus`.
  - **`g_faulted`, `g_lastCommitError`, `g_audioSequence`, `g_audioSession`:** se definem em `Grafo.m` (que marca a falha na maioria dos casos), `CicloDoGrafo.m`, `Audio.m` e `Audio.m`, nessa ordem.
- **Funções compartilhadas (35):** os 6 utilitários de `Runtime.m`, `leaseValid`, `httpGetOverUnix`, `appAllowed`, `readControl`, `saveStatus`, `startProducer`, `fetchAudio` e as 22 funções de gancho. O `installHooks` precisa de todas as funções de gancho, e `redirectedConnect` compara o método instalado com `bridgeGraphStart`.

**Visibilidade.** No arquivo inteiro, tudo é `static` e o binário exporta só a classe (`_OBJC_CLASS_$_OBSBridgeContext` e a metaclasse). Sem cuidado, a divisão passa a exportar 128 símbolos a mais do `.dylib`, que são as 93 variáveis e as 35 funções. A solução é envolver as declarações do `Ponte.h` em `#pragma GCC visibility push(hidden)` e `pop`. A opção `-fvisibility=hidden` no `Makefile` não serve, porque esconde também a classe e muda a lista exportada. Com o `#pragma`, a lista exportada ficou igual (seção 4.1 da segunda parte).

### 3.2 No fim da fila

Das 93 compartilhadas, **72 só são compartilhadas por causa de dois leitores**: `saveStatus`, que lê os contadores, e `installHooks`, que lê os ponteiros. Os 23 `g_original*` estão entre essas 72. A proposta é que o corte de cada arquivo traga para dentro dele duas coisas:

1. **O seu pedaço do estado.** Uma função como `estadoDaFoto()` devolve o dicionário com as chaves da foto, e `saveStatus` junta os pedaços dentro da mesma trava. A trava é recursiva, então o comportamento não muda. A ordem das chaves no JSON pode mudar, porque o `NSJSONSerialization` sem `SortedKeys` segue a ordem do dicionário. O app lê o JSON por chave (`ios-camera.js`), então isso não muda nada para ele.
2. **A instalação dos seus ganchos.** Uma função como `instalarGanchosDaFoto(...)` usa os ponteiros, que voltam a ser `static`. O `installHooks` continua com a porta de ABI (as 18 conferências de `hasABI` antes de `g_hookAttempted`) e chama os instaladores **na mesma ordem de hoje**: o arquivo de filme (`Audio.m`), a fila remota (`Saidas.m`), as 8 da foto, o compressor (`Saidas.m`) e, por fim, o núcleo do grafo. O núcleo vai do semáforo, passa por `connect`, pelo nó físico e pelo `emitStill...`, e termina em `start`, `stop`, `commit` e na onda de preparação. Por isso, `Saidas.m` expõe dois instaladores, e não um.

Com isso, **ficam 21 compartilhadas**, todas do núcleo ou da configuração. Do núcleo: `g_lock`, `g_contexts`, `g_redirectedGraphs`, `g_controlQueue`, `g_physicalClass`, `kCameraApp`, `g_faulted` e `g_lastCommitError`. Da configuração gravada por `readControl`: `g_enabled`, `g_expires`, `g_url`, `g_socket`, `g_frameRate`, `g_previewOnly`, `g_directRecording`, `g_videoInjection`, `g_audioInjection`, `g_photoPrepareBypass`, `g_remoteQueuePortType`, `g_audioPackets` e `g_audioSequence`. As duas últimas são compartilhadas porque `readControl` esvazia a fila de áudio quando a injeção desliga. **Nenhum `g_original*` fica compartilhado.**

O teste, o retrato e a ordem dos cortes continuam em [ponte-da-camera-prova.md](ponte-da-camera-prova.md).

## Fontes

- Repositório, `main` em `96ea7ce`: `MAC/integracao-iphone/bridge/{Tweak.x,Pipeline.h,Makefile,control,OBSGraphBridge.plist}`, `app/electron/services/iphone-setup/setup.js`, `scripts/regras/{configuracao.json,linha-de-base.json}`, `docs/adr/0050` a `0055`.
- Painel, API v2, só GET: `/api/v2/projects/2/analyses/latest` (análise 161, revisão `96ea7ce`), `/api/v2/projects/2/analyses/latest/files` e `/api/v2/projects/2/export/configuration/json`.
- Mac de prova: macOS 15.6.1, Apple clang 17.0.0 (clang-1700.0.13.5), SDK do macOS das Command Line Tools; `nm` e `otool` do sistema.
- lizard 1.26.1, rodado sobre a divisão de teste, fora do repositório.
- Theos, "Logos: Syntax" (theos.dev/docs/logos-syntax), sobre o `%ctor`.
