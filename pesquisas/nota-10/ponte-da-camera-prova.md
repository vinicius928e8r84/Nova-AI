# O corte da ponte da câmera do iPhone: teste, retrato e ordem dos cortes

Segunda parte da pesquisa do ticket [Pesquisa: o corte da ponte da câmera do iPhone (bridge/Tweak.x) em arquivos .m](https://github.com/vinicius928e8r84/Nova-AI/issues/190). A primeira parte, [ponte-da-camera.md](ponte-da-camera.md), traz a resposta curta, as partes (seção 2), o estado compartilhado (seção 3) e as fontes. As seções seguem a mesma numeração.

## 4. Teste no Mac e retrato do pacote

### 4.1 O que se montou e se provou nesta pesquisa

Compilei, no Mac de prova, o `Tweak.x` inteiro e a divisão de teste. O `Tweak.x` só precisou de uma troca para ser lido como `.m`: o `%ctor {` virou a linha do construtor. Os dois foram compilados como `.dylib` arm64 contra o SDK do macOS, com `-fobjc-arc -Wno-unused-function`, os mesmos frameworks do `Makefile`, um `substrate.h` falso que só declara `MSHookMessageEx` e `-undefined dynamic_lookup`. O resultado:

- **Os dois compilam sem nenhum aviso**, com `-O0 -g` e com `-O2`. O código da ponte compila no macOS, o que torna possível o teste no Mac com `clang`, como já é feito no proxy e no idioma.
- **As partes do retrato ficam iguais** entre o arquivo inteiro e a divisão: os símbolos importados (`nm -u`: 164 com `-O0` e 161 com `-O2`), os exportados (`nm -gU`: 2), as bibliotecas (`otool -L`: 10), os textos (`__TEXT,__cstring`: 256) e os seletores (`__TEXT,__objc_methname`: 202).
- **O `Pipeline.h` reduzido dá o mesmo binário.** Com `-O0`, o binário do arquivo inteiro só tem `_VCPDrawFrame` e `_VCPFormatSupported`. A divisão com só essas duas funções copiadas para `Quadros.m`, e sem o `Pipeline.h`, também deu igual nas cinco medidas.

Este é o roteiro do retrato que usei. É o mesmo que o corte 1 roda sobre o `.dylib` do pacote montado com o Theos, antes e depois:

```bash
r(){ case $1 in
  imp)  nm -u "$2" | sort ;;
  exp)  nm -gU "$2" | awk '{print $3}' | sort ;;
  libs) otool -L "$2" | tail -n +3 | awk '{print $1}' | sort ;;
  *)    otool -v -s __TEXT "$1" "$2" | tail -n +3 | sed -E 's/^[0-9a-f]+[[:space:]]+//' | sort ;;
esac; }
for k in imp exp libs __cstring __objc_methname; do
  diff <(r $k antes.dylib) <(r $k depois.dylib) >/dev/null && echo "$k igual" || echo "$k DIFERE"
done
```

Para o pacote, o retrato soma `dpkg-deb -I` e `dpkg-deb -c`. A lista de arquivos e o `control` têm de ficar iguais, menos a versão, que sobe em todo corte. Esta ponte não tem `entitlements.plist`, então o `ldid -e` não entra. Os bytes de código vão mudar de qualquer jeito, porque uma variável `extern` muda o que o compilador pode supor sobre ela. Por isso o retrato compara as partes, e não o arquivo inteiro.

### 4.2 O teste no Mac de cada corte

O teste fica em `MAC/integracao-iphone/bridge/teste/`, no padrão de `proxy-iphone/tool/teste/rodar.sh`. Ele compila os `.m` da ponte com `clang`, o `substrate.h` falso (que aqui também registra as chamadas a `MSHookMessageEx`) e classes falsas com os nomes das classes privadas (`BWGraph`, `BWFunnelNode` etc.). Essas classes não existem no macOS, e a ponte as acha por `objc_getClass`. O construtor sai na hora fora do `mediaserverd`, então o teste inicia `g_lock` e as coleções por conta própria. Antes do corte 1, o teste compila uma cópia do `Tweak.x` com o `%ctor` trocado e a inclui com `#include`, para chegar às variáveis `static`. Depois do corte, ele liga os `.m` e usa as variáveis `extern`. O job macOS da CI, que o ticket [O código em Objective-C e Logos: o roteiro de corte e de prova](https://github.com/vinicius928e8r84/Nova-AI/issues/134) decidiu criar, roda esse script.

| Corte | O teste gravado antes, que tem de passar no código antigo |
| --- | --- |
| 1, divisão mecânica | Compila sem aviso com `-O0` e com `-O2`. O retrato da seção 4.1 contra a `main`. Um teste de texto na CI Linux, que lê todos os `.x` e `.m` de `bridge/` (e não uma linha fixa) e confere os 22 seletores ligados, as 14 chaves do controle, as 78 chaves do estado e a versão. Também confere `isHexTokenPath` e `isCameraSocketPath` com caminhos válidos e inválidos. |
| 2, `Estado.m` | Preenche as variáveis, chama `saveStatus`, lê `/var/tmp/obs-graph-bridge-status.json` e confere as 78 chaves e cada valor. As sessões param em 4, e `photoRoute`, `lastCommitError` e `remoteQueuePortType` têm valores padrão. Esse leitor do estado serve de observador para os testes dos cortes seguintes. |
| 3, `Controle.m` | Escreve variações do controle em `/var/tmp/obs-graph-bridge-control.json` e confere as variáveis depois de `readControl`. Cobre: injeção válida, concessão vencida, concessão acima de 120 s, modo errado, token que não é hexadecimal, socket fora de `/var/tmp` e `/var/run`, porta TCP abaixo de 1024, mais de 16 `appIDs`, `appID` da Câmera e `frameRate` fora de 1 a 30. Também testa `httpGetOverUnix` contra um servidor de socket Unix local: resposta 200, 404, corpo grande demais e resposta sem cabeçalho. |
| 4, `Audio.m` | Testa `fetchAudio` contra o mesmo servidor: `OBA1` com sequência crescente, sequência repetida, pacote acima de 8.192 bytes, pacote truncado e fila presa em 24. Testa `sampleWithAudioPacket` com uma descrição AAC real do CoreMedia e confere a cópia dos anexos. Testa `bridgeMovieSinkRender` com um nó falso e um `g_originalMovieSinkRender` falso: o silêncio quando a fila está vazia e o repasse quando a injeção está desligada. |
| 5, `Quadros.m` | Testa `imageFromJPEG` (marcador inicial, 2 MB e 4096 px), `copyFrame` pelo socket e `copySample`: tamanho, formato de pixel, `PortType`, `SynchronizedStreamsIsMaster` e `LastPortType`. Testa `produce` com fontes falsas que guardam o `processBuffer:`: os contadores de vídeo, foto e gravação, o anexo das configurações da foto e a conclusão sintética depois de 100 ms. |
| 6, `Saidas.m` | Testa o compressor, que guarda `recordCompressor` só com `1920 x 1080` e `420v`. Testa a fila remota, que troca o `PortType` com o prefixo `OBSBridge` pelo `remoteQueuePortType`. A exceção só é engolida quando o grafo foi redirecionado. |
| 7, `Foto.m` | Testa a troca de porta em `bridgeTimeMachineRender`. Testa `bridgeGNRRender` com formato compatível e incompatível. Testa `bridgeStreamPrepareStill` com configurações falsas, conferindo o pedido pendente e o `willCapture` sintético. Os bytes `0x28` e `0x2c` da conexão, e o `_captureDevice` no deslocamento 96, só a prova real cobre de verdade. Dá para criar uma classe falsa com a variável nesse deslocamento, mas isso não foi conferido. |
| 8, `CicloDoGrafo.m` | Os pools devolvem 0 quando o nó foi mapeado e a concessão está ativa, e -12780 sem o original. O semáforo troca 0 por 1. O `commit` com exceção marca a falha só no grafo redirecionado. O `stop` chama o original no grafo da Câmera e pula o original nos outros. O `start` retoma as conexões antes e liga o produtor depois. |
| 9, `Grafo.m` | Testa `redirectedConnect` com grafo, saída, entrada e nó físico falsos, e com um `g_originalConnect` que guarda as chamadas. Cobre: concessão inativa, app não permitido, os papéis vídeo, foto e metadados, o limite de 4 contextos, a fonte mestre única e o funil da gravação direta. |
| 10, `Ganchos.m` | O `substrate.h` falso guarda a sequência de chamadas (classe, seletor e substituto), e o teste confere os 22 ganchos na ordem de hoje. Falta uma das 18 assinaturas de ABI: nenhum gancho e `g_hookAttempted` falso. A fórmula de `hooksReady`. As classes falsas têm as mesmas assinaturas, porque o compilador gera as mesmas codificações de tipo no arm64 do Mac e no do iPhone. |

## 5. A ordem dos cortes e por quê

Um corte por lote, como o dono decidiu. Cada lote sobe a versão do pacote em 4 lugares que andam juntos: `bridge/control`, a versão dentro de `saveStatus` (no `Tweak.x` até o corte 1 e em `Estado.m` depois dele), o `TARGET` do `setup.js` e o `camera.deb` do app instalado. O `ios-camera.js` aceita qualquer versão a partir de `0.1-39` e não muda.

| Corte | Arquivo | Versão | Por que nesta posição | O que o dono confere, além dos passos 1 a 11 |
| --- | --- | --- | --- | --- |
| 1 | divisão mecânica: o `Tweak.x` e o `Pipeline.h` viram os onze arquivos | 0.1-40 | Separa mover de reescrever. Mover se prova pelo retrato. Depois dele, cada corte mexe num arquivo pequeno que o painel já mede, e o teste no Mac compila um arquivo por vez. | Tudo, porque tudo mudou de lugar: `hooksReady`, a prévia da Câmera, a foto, o vídeo com som, o Safari, parar e voltar à câmera real, e nenhum `.ips` novo. |
| 2 | `Estado.m` | 0.1-41 | É o de menor risco, porque só escreve um arquivo. O teste dele lê o estado, e esse leitor serve de observador nos testes seguintes. | O app mostra a ponte pronta. O `status.json` tem as 78 chaves, e os contadores sobem durante o uso. |
| 3 | `Controle.m` | 0.1-42 | É lógica pura, que dá para testar inteira no Mac. Todos os outros dependem da concessão. | Liga e desliga o CAM LIVE: `enabled` vai a verdadeiro e volta a falso. Testar também o modo contínuo e a concessão que vence sozinha. |
| 4 | `Audio.m` | 0.1-43 | Dá para testar quase inteiro no Mac, e é isolado: só age em amostras AAC do arquivo de filme. | Gravar vídeo com som na Câmera: `audioReplaced` sobe e `audioFetchFailures` fica parado. |
| 5 | `Quadros.m` | 0.1-44 | O teste no Mac com fontes falsas cobre a produção. É um dos três piores (`produce`). | A prévia com a imagem do Mac, a foto, e a gravação (`emittedRecord`). |
| 6 | `Saidas.m` | 0.1-45 | É pequeno. A prova dele é a prévia no Safari e a gravação. | A câmera numa página no Safari (`remoteQueueRenders` e `remoteQueuePortRemaps`) e gravar vídeo (`compressorImageSamples`). |
| 7 | `Foto.m` | 0.1-46 | É o arquivo com mais código privado (variáveis por nome, bytes por deslocamento), e o teste no Mac cobre só parte dele. Por isso vem depois que o padrão de teste está maduro. | Tirar foto: `photoStillRequests`, `emittedStill` e a foto salva no app Fotos. Tirar duas fotos seguidas. |
| 8 | `CicloDoGrafo.m` | 0.1-47 | Mexe no início, na parada e no `commit` do grafo. Uma queda ali derruba a câmera e o áudio do aparelho. | Abrir e fechar a Câmera várias vezes, trocar a câmera frontal e a traseira, parar no Nova: `graphStops`, `graphStopsSkipped` com o Safari, e nenhum `.ips`. |
| 9 | `Grafo.m` | 0.1-48 | `redirectedConnect` é a função que decide a troca e é a maior do arquivo. Vem quase no fim, com todos os outros já provados e com o teste no Mac mais completo. | O mesmo do corte 8, mais o limite de contextos (`contextCount` até 4 e `contextLimitHits` parado) e a Câmera e o Safari ao mesmo tempo. |
| 10 | `Ganchos.m` | 0.1-49 | Ele toca todos os ganchos. Como os instaladores de cada domínio já existem dos cortes 2 a 9, este corte só deixa `installHooks` curto e fecha a seção 3.2. | `hooksReady` depois de um `kickstart` do `mediaserverd` e todos os `*HookReady` verdadeiros. Repetir a Câmera, a foto e o áudio. |

**Como os cortes 2 a 9 tocam o `Ganchos.m` e o `Estado.m`.** Para fechar a seção 3.2, cada corte de domínio move dois pedaços para dentro do arquivo dele: o pedaço do estado (que sai de `Estado.m`) e a instalação dos ganchos (que sai de `installHooks`). Assim, um corte mexe no arquivo do domínio e tira linhas desses dois. É o mesmo padrão dos cortes em JavaScript, em que cada corte tira código da fachada. Se o revisor preferir um arquivo só por corte, os pedaços ficam onde estão até o corte 10, e as 93 variáveis continuam compartilhadas até lá.

**Um arquivo que já vem em 10 sai da fila.** A lista oficial se lê de novo depois de cada lote (`node scripts/painel/lista-do-painel.js`). Pela estimativa da seção 2.1, o `Runtime.m` é o único candidato a já vir em 10. Se o `CicloDoGrafo.m` ou o `Saidas.m` também vierem, os cortes deles saem da fila e as versões seguintes andam uma casa para trás.

**O que muda nas regras do repositório no corte 1.**
- A atenção ALTA vem pela regra `ponte-do-iphone` (`MAC/integracao-iphone/**`). O corte cria 11 arquivos e apaga 2, mas conta como **um item**, um corte de um arquivo. É como nos cortes do `browserFarmService.js` e do `physicalMobileService.js`, que criaram vários módulos por corte. Isso cabe no teto de 4 itens de atenção ALTA por lote.
- As entradas do `Tweak.x` e do `Pipeline.h` em `scripts/regras/linha-de-base.json` saem. Se, quando o corte 1 vier, as listas da linha de base já tiverem saído por [As regras que seguram a nota: o desenho que entra](https://github.com/vinicius928e8r84/Nova-AI/issues/136), não há o que tirar.
- Nenhum arquivo novo tem comentário, e todos ficam abaixo de 1.000 linhas.
- O filtro `*.h` sai do painel no começo da fase, conforme a decisão do dono. Com o `Pipeline.h` apagado no corte 1, o único `.h` da ponte que o painel passa a medir é o `Ponte.h`, que só tem declarações.

## 6. Custo para o dono

São até 10 sessões com o iPhone10,2, uma por lote, já que nove cortes podem sair da fila se o arquivo vier em 10. Em cada uma, o dono põe a senha de `sudo`, roda o `dpkg -i` e o `kickstart`, e faz a conferência da tabela da seção 5. O agente monta o pacote com o Theos no Mac de prova, tira o retrato e roda o teste no Mac antes de chamar o dono. A sessão do corte 1 cabe junto da Sessão 1 de [Pesquisa: as provas reais pendentes, arquivo por arquivo](https://github.com/vinicius928e8r84/Nova-AI/issues/137), como o ticket [O código em Objective-C e Logos: o roteiro de corte e de prova](https://github.com/vinicius928e8r84/Nova-AI/issues/134) já previa para a ponte.

## 7. O que não foi conferido

- **Nada foi compilado para iOS.** A divisão de teste foi compilada para macOS arm64. O Theos com o SDK do iOS 16.5 ainda não está no Mac de prova, e instalar é passo do agente na fila. O retrato real do corte 1 sai do `.dylib` montado pelo Theos.
- **Se o `tweak.mk` do Theos liga o CydiaSubstrate num tweak só de `.m`.** O retrato pega isso: o `nm -u` tem de mostrar `_MSHookMessageEx`, e o `otool -L` tem de mostrar a biblioteca do Substrate, como hoje.
- **As notas.** As regras da seção 2.1 são estimativas do lizard e da contagem de chaves. A nota de cada arquivo só existe depois que o painel analisar o corte 1.
- **Os testes no Mac da seção 4.2 não foram escritos.** O que esta pesquisa provou é que a ponte compila no macOS com um `substrate.h` falso, que é a base de todos eles.
- **A ordem das chaves no `status.json`** pode mudar quando `saveStatus` passar a juntar os pedaços. O app lê o JSON por chave, então isso não muda nada para ele, mas não testei com o app.
- **Os bugs já registrados ficam fora dos cortes:** [O Tweak.x do iPhone deixa vazar o grafo parado quando o cliente redirecionado não é a Câmera](https://github.com/vinicius928e8r84/Nova-AI/issues/143) e [O orçamento de buffers da fonte de software do iPhone é 1 por tentativa, sem medida](https://github.com/vinicius928e8r84/Nova-AI/issues/144). Os dois caem em `CicloDoGrafo.m` e são conserto de bug.
