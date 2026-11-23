# O corte do `main.js`

Pesquisa do ticket [Pesquisa: o corte do main.js](https://github.com/vinicius928e8r84/Nova-AI/issues/127), do mapa [Nova-AI na nota 10 no CodeScene: o plano, com a fila de lotes e as regras que seguram](https://github.com/vinicius928e8r84/Nova-AI/issues/120). Alimenta o ticket [A fila dos lotes até a nota 10](https://github.com/vinicius928e8r84/Nova-AI/issues/139).

Tudo foi conferido na `main` em `1b45c3f`, o mesmo commit da análise 141 do painel (23/11, 10:00 BRT). A pesquisa não muda código.

## A resposta em poucas linhas

O `app/electron/main.js` se divide em **vinte módulos novos**, todos em `app/electron/` com o nome `main.<área>.js`, e fica com cerca de **10 KB** e zero ponto: os `require`, as chaves de linha de comando, o objeto que entrega o estado aos módulos, a lista de registros e o arranque. São **onze cortes em série**, um por lote, porque todos mexem no mesmo arquivo. Cada corte tira de 228 a 481 pontos; os onze somam os 4.149.

Três achados mudam o jeito de cortar:

1. **Quase toda a dívida é uma função só.** A catraca vê `registerHandlers` (linhas 680 a 4012) como uma função de 3.283 linhas e complexidade 657, com 3.906 dos 4.149 pontos. Os tratadores anônimos dela não são unidades para a catraca. Medido tratador por tratador, a dívida própria deles é de **406 pontos**, e o painel concorda: dá Complex Method a 18 funções e Large Method a 6, cada tratador contado como função. Os pontos de cada corte são, quase todos, linhas que saem de `registerHandlers`.
2. **O tratador precisa virar função com nome, e o canal precisa continuar escrito por extenso.** Um tratador anônimo dentro de uma função `registrar` soma a sua complexidade à dela, e o módulo novo nasceria com pontos. Uma tabela com o canal numa variável esconderia o canal do `mapa-ipc.test.js`. A forma que serve às duas regras é `ipcMain.handle('ltm:save-insight', salvarInsight)`, com `salvarInsight` declarado no topo do módulo.
3. **Os módulos ficam na mesma pasta do `main.js`.** Os tratadores usam `__dirname` em 9 lugares (`youtube_auto`, `Nova_Vault`, `webview-bridge.js`, `preload.js`, `wake_word_bg.py`, `dist/`) e fazem dezenas de `require('./services/...')`. Em `app/electron/`, nada disso muda. O nome `main.<área>.js` também já cai no glob `**/main.*.js` de `caminhos-sensiveis.json`: os módulos novos nascem com atenção ALTA, sem mudar a regra.

O empacotamento do instalador não muda (`build.files` é `**/*` e `asar` é `false`). O que muda é a cópia à mão para o app instalado no Mac: cada corte acrescenta arquivos, e copiar só o `main.js` impede o app de abrir.

## 1. Como o arquivo é hoje

### Os números

- **158.315 bytes** e 4.283 linhas no git (`git cat-file -s 1b45c3f:app/electron/main.js`). Os 162.598 bytes do ticket são o arquivo num checkout do Windows com `core.autocrlf=true`: cada linha ganha um `\r` (158.315 + 4.283 = 162.598). O teto de 20.000 bytes deve ser medido no conteúdo do git, que é o que o Mac, o CI e o painel veem.
- A linha de base do `limite-de-linhas` é 4.283, e a da catraca é 4.149 (`scripts/regras/linha-de-base.json`, linhas 3 e 13).
- **Nota no painel: 2,44** (2,4486 na resolução alta), hotspot, 21 mudanças, 3.681 linhas de código. A nota vem da API (`/api/v2/projects/2/analyses/141/files`), e o detalhe por função vem do arquivo `code_health_details/e0cc7012bcfac07f519e94b4423c929475279be7.json` da análise, lido no container `opencleancode`. A API não entrega detalhe por função; esse arquivo entrega.
- Os achados do painel no arquivo: Modularity Issue; Bumpy Road (5); Deep, Nested Complexity (1); Complex Method (18); Complex Conditional (10); Code Duplication (26 funções em 16 grupos); Large Method (6). O painel conta 300 funções, média de complexidade 3,49, e acha que 8,7% do código está duplicado.
- O Modularity Issue é um achado de tamanho do arquivo. Na lista de arquivos da análise, ele só aparece em arquivos com mais de 1.900 linhas de código (o `physicalMobileService.js`, os bundles e as cópias do `main.js`). Os arquivos de 1.500 a 1.850 linhas levam File Size Issue. Os dois somem quando o `main.js` cair para cerca de 10 KB.

### O que o painel acusa, função por função

| Função (linhas) | Achados do painel |
|---|---|
| `'system-fs-op'` (2905-2981) | complexidade 38, Bumpy Road com 5 trechos, 70 linhas, condição com 2 ramos |
| `'scan-vault-graph'` (2452-2658) | complexidade 34, aninhamento 4 (o único Deep, Nested Complexity), Bumpy Road com 3 trechos, 165 linhas |
| `'preview-voice'` (1875-1976) | complexidade 29, 87 linhas |
| `'nova-self'` (1207-1293) | complexidade 29, 85 linhas |
| `'run-youtube-pipeline'` (1783-1873) | complexidade 20, 74 linhas |
| `'search-vault-memory'` (2376-2450) | complexidade 18 |
| `'send-whatsapp-keyboard'` (3710-3806) | complexidade 16, 81 linhas |
| `'save-youtube-settings'` (1569-1631) | complexidade 16, Bumpy Road com 3 trechos |
| `'trigger-swarm'` (2661-2698) | complexidade 14, Bumpy Road com 2 trechos |
| `'screen-recorder:save'` (1052-1128) | complexidade 13 |
| `'studio:boot-engine'`, `'virtual-cam:control'` | complexidade 12 |
| `'read-file-content'` (3007-3044) | complexidade 11, condição com 3 ramos |
| `migrateStonicToNova` (146-197) | complexidade 11, Bumpy Road com 2 trechos |
| `'execute-ui-command'`, `'physical-mobile:iphone-prepare'` | complexidade 10 (o segundo com condição de 3 ramos) |
| `startWakeWordDetector`, `'remote-access-restart-tunnel'` | complexidade 9 (o primeiro com condição de 2 ramos) |
| `info`, `warn`, `error` do `autoUpdater.logger`; `'physical-mobile:start-stream'`, `'kling:convert-picture-to-video'`, `'telegram-init'` | condição com 2 ou 3 ramos |

**A duplicação.** Os 16 grupos de código repetido caem em quatro áreas: onze leitores de chave e de preferência (`get-gemini-token`, `get-groq-token`, `get-wa-api-key`, `get-openrouter-token`, `get-thinking-enabled`, `get-prefer-direct-gemini`, `get-google-token`, `get-visual-feed-enabled`, `get-child-agent-model`, `get-child-agent-key`, `get-nova-voice`), com mais um par entre `app.getGeminiToken`, dentro de `createWindow`, e `get-gemini-token`; os pares WhatsApp/Telegram (`*-get-state`, `save-*-settings`, `*-logout`) e os pares do Telegram (`send-otp`/`send-qr`, `submit-code`/`submit-password`); `open-media-dialog` com `open-audio-dialog`; e `wakeword:start` com `wakeword:stop`. A duplicação não pesa na catraca, mas pesa no painel. Mover o código sem juntar as cópias levaria o achado para o módulo novo, e ele não chegaria a 10.

### Os pontos da catraca por função

Medidos com `medirFontes` de `scripts/regras/analisador/medir.js` e `pontuar` de `pontos.js`, do mesmo jeito que `scripts/regras/regra-saude.js` mede. Total: **4.149 pontos**, igual à linha de base.

| Unidade (linha) | Pontos | O que pesa |
|---|---:|---|
| `registerHandlers` (680) | 3.906 | complexidade 657, aninhamento 4, 34 blocos aninhados, 3.283 linhas, 6 condições com 2 ou 3 operadores |
| `createWindow` (224) | 217 | complexidade 46, 4 blocos aninhados, 245 linhas |
| o topo do arquivo | 6 | complexidade 14 (os `if` e `||` do teste de fumaça, do `NODE_ENV`, da plataforma e do `NOVA_TEST_INSTANCE`) |
| `migrateStonicToNova` (146) | 4 | complexidade 11, 2 blocos aninhados |
| `startProductionServer` (470) | 4 | 73 linhas |
| `addNode` (2458, dentro de `scan-vault-graph`) | 4 | 8 argumentos |
| `info`, `warn`, `error` (119, 125, 131) | 3 | uma condição com 2 operadores em cada um |
| `startWakeWordDetector` (4016) | 2 | complexidade 9, condição com 2 operadores |
| o `then` do `whenReady` (4129) | 2 | complexidade 10 |
| o arquivo | 1 | média de complexidade 11,8 (limite: abaixo de 4) |

**Por que a catraca e o painel divergem.** O analisador (`scripts/regras/analisador/medir-js.js`, linhas 58 a 61, e `nomes-js.js`) só abre unidade nova para uma função anônima quando ela está fora de uma função com nome. Dentro de `registerHandlers`, os 237 tratadores se somam a ela. Embrulhando cada comando de `registerHandlers` numa função própria e medindo de novo, a dívida dos tratadores cai para 406 pontos: `scan-vault-graph` 137, `preview-voice` 54, `system-fs-op` 42, `nova-self` 41, `run-youtube-pipeline` 36, `search-vault-memory` 19, `send-whatsapp-keyboard` 19, `screen-recorder:save` 15, `read-file-content` 9, `save-youtube-settings` 8, `trigger-swarm` 7 e mais 19 pontos em oito tratadores pequenos. O painel enxerga os tratadores como funções desde já, e os 18 Complex Method dele são justamente esses.

### As partes do arquivo

Bytes medidos no conteúdo do git, por trecho de linhas.

| Parte (linhas) | Bytes | O que faz |
|---|---:|---|
| `require` e chaves (1-23, 45-117) | 3.829 | Electron, serviços, `autoUpdater`, as variáveis de estado (`mainWindow`, gerentes, processos) |
| teste de fumaça (24-44) | 1.132 | `NOVA_SMOKE_TEST=1`: abre a janela, tira a tela e grava `result.json` |
| `autoUpdater.logger` (118-137) | 723 | |
| migração e pastas (146-212) | 2.581 | `migrateStonicToNova` e `ensureNovaDirectories` |
| `openIphoneConsole` e `createWindow` (214-468) | 8.142 | bandeja, janela, controladores, conexão automática do WhatsApp e do Telegram |
| servidor local e permissões (470-588) | 4.054 | `startProductionServer` e `setupPermissions` |
| caminhos, backup, edição local, porta do console (590-679) | 4.661 | 26 funções `get*Path`, `syncConfigurationBackup`, `restoreConfigurationBackup`, `getLocalEditionStatus`, `novaIosConsolePortOpen` |
| `registerHandlers` (680-4012) | 123.975 | 237 canais, mais o registro do CAM LIVE, do navegador, do CDP e do farm |
| palavra de ativação, desligamento, encerramento (4013-4118) | 3.498 | `startWakeWordDetector`, `stopWindowServices`, `nova-shutdown`, `window-all-closed`, `NOVA_TEST_INSTANCE` |
| instância única e arranque (4119-4283) | 5.796 | `whenReady`: permissões, RTMP, ponte do iOS, cabeçalhos CSP, inventário, acesso remoto, registros, janela, eventos do atualizador, `activate` |

## 2. Os módulos de destino

**Onde ficam e como se chamam.** Em `app/electron/`, ao lado do `main.js`, com o nome `main.<área>.js`. Há três motivos. Os 9 `__dirname` e os `require('./services/...')` dos tratadores continuam valendo sem nenhuma troca. O glob `**/main.*.js` do grupo `ipc-e-preload` de `scripts/regras/caminhos-sensiveis.json` (linha 8) já os pega, e toda PR que mexer num deles continua sendo de atenção ALTA. E o `mapa-ipc.test.js` já varre `app/electron/` inteiro.

**A forma de cada módulo.** O módulo declara os tratadores como funções com nome no topo e exporta uma função `registrar(contexto)`, que só faz `ipcMain.handle('<canal>', <tratador>)` com o canal escrito por extenso. Isso foi conferido com o analisador da catraca, usando os três tratadores de `ltm:*`. Na forma "tratador anônimo dentro de `registrarLtm`", sai uma unidade com complexidade 8 e 29 linhas, já com 1 ponto. Na forma "tratador com nome e registro por extenso", saem quatro unidades (`salvarInsight` cc 3, `lerInsights` cc 4, `apagarInsights` cc 3, `registrarLtm` cc 1) e zero ponto. Com 20 tratadores ou mais por módulo, a primeira forma estouraria o limite.

**O estado.** Os tratadores leem `mainWindow` (79 vezes) e os gerentes, e três deles gravam: `whatsapp-init` grava `whatsappManager`; os do Telegram gravam `telegramManager` (3 vezes); `wakeword:stop` grava `wakeWordProcess`. Um módulo não consegue reatribuir um `let` do `main.js`. Do corte 1 ao 10, o `main.js` passa a cada `registrar` um objeto `contexto` com *getters* e *setters* sobre as variáveis de hoje (`get janela() { return mainWindow; }`, `set whatsapp(valor) { whatsappManager = valor; }`). Isso preserva a leitura na hora da chamada, que é o comportamento de hoje, e não obriga a mexer no resto do `main.js` em cada corte. No corte 11, junto com `createWindow`, o estado muda para `main.estado.js`.

**A ordem dos efeitos.** Alguns comandos de `registerHandlers` fazem algo na hora do registro: registram o CAM LIVE (linha 713), criam o `KlingVideoService` (1743), registram o navegador e sobem o CDP (3929), carregam o `gemini-browser-engine` (3948), leem `os.cpus()` para a primeira medida de CPU (3296) e registram o farm (4010). O `registerHandlers` que fica chama os `registrar` na mesma ordem em que esses efeitos acontecem hoje. Um `require` que hoje roda dentro de um tratador continua dentro dele: subir o `require` para o topo do módulo mudaria uma falha de "erro naquela chamada" para "o app não abre".

| Módulo | Guarda | Corte | Canais | Bytes que chegam (sem refatorar) | Tamanho estimado |
|---|---|---:|---:|---:|---:|
| `main.caminhos.js` | os 26 caminhos `get*Path`, `ensureNovaDirectories`, `migrateStonicToNova`, o backup de configuração (exportar e importar) | 1 | 0 | 6.506 | 6,5 KB |
| `main.sistema.js` | janela (`window-*`), área de transferência, notificação, `http-fetch`, métricas, informações do sistema, processos, `system-exec-command`, `open-external-url`; a palavra de ativação (`startWakeWordDetector`, `wakeword:*` e o processo) | 1 | 16 | 7.500 | 7,5 KB |
| `main.teclado.js` | `keyboard-press`, `keyboard-type` e `send-whatsapp-keyboard` (robô de teclado) | 1 | 3 | 6.900 | 7 KB |
| `main.config.js` | as chaves e preferências (Gemini, Groq, OpenRouter, Google, WhatsApp API, ElevenLabs, raciocínio, Gemini direto, visual, modelo e chave do agente filho, voz), modelos próprios, modelos do OpenRouter, `license:*`, `sync-configuration-backup` | 2 | 31 | 8.900 | 5,5 KB (as cópias viram duas fábricas: `lerPreferencia` e `gravarPreferencia`) |
| `main.atualizador.js` | a configuração do `autoUpdater`, o `logger`, os quatro canais (`check-for-update`, `download-update`, `install-update`, `get-app-version`), os eventos e a busca na abertura | 2 | 4 | 4.706 | 4,5 KB |
| `main.dados.js` | memórias, perfil, painel (com `fetch-dashboard-data`), histórico, conversas, contexto do usuário, contatos, notas, nota rápida, tarefas, `ltm:*`, `chat:get-recall-summary` | 3 | 27 | 9.382 | 9 KB |
| `main.arquivos.js` | as janelas de escolher arquivo e pasta, `open-file`, `delete-file`, `save-file`, `save-image`, `read-file-content` (PDF, DOCX, texto, imagem), `pick-and-read-files`, `system-fs-op`, `system-open` | 4 | 14 | 11.056 | 10,5 KB |
| `main.mensageria.js` | WhatsApp, Telegram e acesso remoto | 5 | 21 | 10.373 | 9 KB (os pares WhatsApp/Telegram juntados) |
| `main.midia.js` | caminhos do `webview-bridge` e do `google-stealth-preload`, `rtmp:*`, gravador de tela, câmera virtual (`virtual-cam:*`), `take-screenshot`, `get-screen-sources` | 6 | 14 | 9.755 | 9,5 KB |
| `main.voz.js` | `preview-voice` (prévia do Edge TTS com legenda) | 6 | 1 | 4.801 | 5 KB |
| `main.youtube.js` | yt-dlp (automático e manual), downloads do Nova Human, configuração e exportação do YouTube, `run-youtube-pipeline`, `kling:*` | 7 | 15 | 12.112 | 11,5 KB |
| `main.agentes.js` | Antigravity, `nova-self`, `execute-ui-command`, `trigger-system-log`, enxame (`trigger-swarm*`, `cancel-swarm`), estúdio (`studio:*` e o processo do Stable Diffusion), conta do Gemini (`gemini-account:*`), `focus-app` | 8 | 24 | 13.802 | 13 KB |
| `main.celular.js` | Android e iPhone (`physical-mobile:*`, `iphone:proxy:*`, `spoofer:*`), `live-cam-bridge:*`, `enable-physical-cameras`, o registro do CAM LIVE, `novaIosConsolePortOpen` | 9 | 56 | 12.883 | 12 KB |
| `main.cofre.js` | o cofre: caminhos de documentos e notas, `initialize-vault`, `open-vault-folder`, pastas importadas, `pick-folder`, `save-vault-md`, `search-vault-memory` | 10 | 10 | 5.400 | 5,5 KB |
| `main.cofre-grafo.js` | `scan-vault-graph`: ler o cofre, o histórico, o `MyActivity.json`, as etiquetas, e montar os nós e as ligações | 10 | 1 | 9.300 | 9,5 KB |
| `main.janela.js` | `createWindow` (bandeja, janela, controladores, conexão automática), `openIphoneConsole` e o estado (`main.estado.js`, abaixo) | 11 | 0 | 8.142 | 8 KB |
| `main.estado.js` | o estado do app: janela, gerentes, servidor, processo da palavra de ativação | 11 | 0 | — | 1 KB |
| `main.servidor.js` | `startProductionServer`, `setupPermissions`, os dois `onHeadersReceived` | 11 | 0 | 5.312 | 5 KB |
| `main.encerramento.js` | `stopWindowServices`, `shutdownExtras` e a ligação com o `nova-shutdown` | 11 | 0 | 1.937 | 2 KB |
| `main.fumaca.js` | o modo `NOVA_SMOKE_TEST` | 11 | 0 | 1.132 | 1 KB |
| `main.js` (fica) | `require`, chaves de linha de comando, o objeto `contexto`, `registerHandlers` como lista de `registrar`, instância única, `whenReady` e `activate` | — | 0 | — | ≈ 10 KB |

Os módulos são vinte, contando `main.estado.js` e as duas metades do cofre. O maior tem cerca de 13 KB. Os tamanhos incluem os comentários que estão nas linhas movidas. A [Zera os comentários de main.js e preload.js](https://github.com/vinicius928e8r84/Nova-AI/pull/148) tira 75 linhas de comentário do `main.js` antes da campanha, e os números caem um pouco.

**O que sobra no `main.js`.** Na simulação com todos os trechos tirados, sobram 7.548 bytes e zero ponto. Somando os `require` dos módulos novos, o objeto `contexto` e as linhas de `registrar`, a estimativa é de 9 a 11 KB.

## 3. Os cortes em série

Os números saem de uma simulação: tirar do `main.js` (no conteúdo do git) as linhas de cada corte, em ordem e acumulando, e medir de novo com a catraca. "Pontos que saem" é a queda do `main.js` em cada corte. Eles dependem pouco da ordem, porque a maior parte é linha e complexidade de `registerHandlers`, que acima do limite descem um a um. "Dívida que chega" é a dos tratadores medidos como funções próprias. Essa dívida o corte zera ao refatorar, porque arquivo novo nasce dentro dos limites (`regra-saude.js`, texto do `conserto`).

| # | Corte | O que tira do `main.js` | Canais | Bytes que saem | Pontos que saem | `main.js` fica com | Dívida que chega aos módulos |
|---|---|---|---:|---:|---:|---|---:|
| 1 | **a fundação e o sistema** | o objeto `contexto`; `main.caminhos.js`; `main.sistema.js` com a palavra de ativação; `main.teclado.js`; a mudança no `carregar-main.js` (ver a seção 4) | 19 | 21.016 | 446 | 3.703 pontos, 137 KB | 19 (`send-whatsapp-keyboard`) |
| 2 | **a configuração e o atualizador** | `main.config.js`, com as 11 cópias juntadas em duas fábricas (e o `app.getGeminiToken` de `createWindow` passa a usar a mesma leitura); `main.atualizador.js` com os eventos que hoje estão no `whenReady` | 35 | 13.042 | 392 | 3.311, 124 KB | 0 (e os 3 pontos do `logger`) |
| 3 | **os dados do usuário** | `main.dados.js` | 27 | 9.382 | 338 | 2.973, 114 KB | 0 |
| 4 | **os arquivos** | `main.arquivos.js` (`system-fs-op` vira tabela operação → função, e as duas janelas de mídia, uma só) | 14 | 11.056 | 369 | 2.604, 103 KB | 51 |
| 5 | **a mensageria** | `main.mensageria.js`, com os pares WhatsApp/Telegram juntados | 21 | 10.373 | 389 | 2.215, 93 KB | 2 |
| 6 | **a mídia e a voz** | `main.midia.js` e `main.voz.js` | 15 | 14.556 | 463 | 1.752, 78 KB | 73 |
| 7 | **o YouTube e o Kling** | `main.youtube.js` | 15 | 12.112 | 392 | 1.360, 66 KB | 45 |
| 8 | **os agentes** | `main.agentes.js` (`nova-self` vira tabela ação → função) | 24 | 13.802 | 481 | 879, 52 KB | 54 |
| 9 | **o celular** | `main.celular.js` e `novaIosConsolePortOpen` | 56 | 12.883 | 293 | 586, 38 KB | 6 |
| 10 | **o cofre** | `main.cofre.js` e `main.cofre-grafo.js` | 11 | 14.706 | 358 | 228, 24 KB | 156 |
| 11 | **a janela e o ciclo de vida** | `main.janela.js`, `main.estado.js`, `main.servidor.js`, `main.encerramento.js`, `main.fumaca.js` | 0 | 16.000 | 228 | **0, ≈ 10 KB** | 0 |
| | | | **237** | | **4.149** | | **406** |

**A ordem.** O corte 1 é o piloto por três motivos. É a área com mais caracterização pronta (14 dos 19 canais têm teste). É nele que o `carregar-main.js` aprende a carregar os módulos novos. E é ele que cria o `contexto` e o `main.caminhos.js`, de que todos os outros dependem (os caminhos são usados por oito áreas e por `createWindow`). Os cortes 2 a 5 mexem em arquivos e preferências do usuário, sem processo externo nem aparelho. Os cortes 6 a 9 abrem processos, rede e aparelho, e por isso pedem mais prova do dono. O cofre vem no 10 porque `scan-vault-graph` é a maior refatoração (137 pontos, a única com aninhamento 4) e roda sozinha, sem nada que dependa dela. A janela e o ciclo de vida vêm por último: eles decidem se o app abre, e é mais seguro cortá-los quando o `main.js` já tem 24 KB e se lê inteiro numa revisão.

**Por que onze e não menos.** Dá para juntar os cortes 3 e 5 (dados e mensageria, nenhum dos dois com mais de 2 pontos de dívida, 19 KB juntos) ou o 2 e o 3. Isso daria nove lotes, com PRs de 20 KB de código movido e duas áreas de prova real cada. Juntar mais do que isso faria PRs de 30 KB ou mais, com quatro ou cinco áreas, num arquivo em que cada mudança já é ALTA sozinha. A escolha é da fila.

**Por que em série.** Os onze cortes mexem no `main.js`, e um item de lote é um arquivo e um corte. O `main.js` também só deixa de travar os outros cortes grandes quando a área deles já saiu. O corte 9 (celular) e o corte do `physicalMobileService.js` não se tocam no código: o `main.js` só delega com `app.physicalMobileService.<método>`. Mas os dois pedem prova com iPhone e Android, e convém que caiam na mesma sessão do dono. O `browserFarmService.js` e o `global-spoof-service.js` não são tocados por nenhum corte: o `main.js` só cria o farm (linhas 89 a 91), o liga à janela e chama `registerIPC` (4010).

## 4. Para cada corte: testes, caracterização e prova real

### O que vale para todos os cortes

**Os testes de hoje que tocam o `main.js`.** Rodados nesta máquina (Windows, Node 24.15), com `node --test` sobre os oito arquivos que leem ou carregam o `main.js`: `main-carregar-limpeza`, `main-janela-sistema`, `main-rtmp-edicao-ltm`, `main-teclado-area-de-transferencia`, `mapa-ipc`, `idioma-registro`, `paridade-b` e `python-runtime`. Deram **50 de 52 verdes**. Os dois vermelhos são de `paridade-b` (os dois testes de `pkill` do Mac) e falham por plataforma: criam links simbólicos e processos com nome de Mac, o que não roda no Windows. O CI roda em Ubuntu (`.github/workflows/regras.yml`, linha 115). Os testes cobrem **30 dos 237 canais**: 27 por invocação no `carregar-main.js` e os 3 do atualizador, só pelo texto.

**O palco do `main.js` já existe e precisa mudar no corte 1.** O `app/test/ajuda/carregar-main.js` carrega o `main.js` com Electron falso, `child_process` proibido e um "dublê" para todo `require` que não é do Node (linhas 12 a 18). Hoje ele só intercepta o `require` quando quem pede é o próprio `main.js` (`pai?.filename === atual.caminho`, linha 14). Sem mudança, o `require('./main.sistema')` voltaria um dublê, os canais não se registrariam e os testes falhariam com `canal sem handle`. E se o módulo carregasse de verdade, os `require('electron')` e `require('child_process')` dele passariam pelo carregador normal: o Electron de verdade (que fora dele é só um caminho) e processos de verdade. A mudança do corte 1 é a seguinte: carregar de verdade todo `./main.<área>` pedido pelo `main.js`, e interceptar os pedidos desses módulos do mesmo jeito que os do `main.js`. Com isso, os 31 testes de hoje continuam valendo para o código que mudou de arquivo, e o teste `main.js registra 226 canais handle e 11 on` continua contando 226 e 11.

**Os testes que leem o texto do `main.js`.** Eles quebram quando o trecho muda de arquivo. Cada corte troca o arquivo que o teste lê, sem mudar o que ele confere:

- `app/test/python-runtime.test.js:50` (`spawn(pythonRuntime.python(), [scriptPath], { windowsHide: true })`) passa a ler `main.sistema.js` no corte 1. A linha 51 (`exec(cmd, { cwd: ytDir, windowsHide: true })`) passa a ler `main.youtube.js` no corte 7;
- `app/test/paridade-b.test.js:97` (o atualizador sem ramo por sistema) passa a ler `main.atualizador.js` no corte 2;
- `app/tests/idioma-registro.test.js:17` continua lendo o `main.js`, se o registro do `idioma-ipc` ficar nele (ele fica: é um `require(...).register(app, ipcMain)` de uma linha);
- `MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs:103` confere que o `main.js` **não** tem `if (playErr)`. Ele continua verde depois de qualquer corte, mas deixa de conferir alguma coisa. Precisa passar a ler todos os `main*.js`.

**O mapa de canais.** O `app/test/mapa-ipc.json` guarda os canais por arquivo (`registrados`). Cada corte muda as chaves e precisa regravar o mapa com `ATUALIZAR_MAPA_IPC=1 node --test app/test/mapa-ipc.test.js`. A diferença tem de ser só "`- app/electron/main.js: handle X`" e "`+ app/electron/main.<área>.js: handle X`", com `dinamicos` vazio e `consumidos` igual. **Recomendação para o corte 1:** acrescentar ao `mapa-ipc.test.js` uma verificação de que o conjunto de todos os canais, sem olhar o arquivo, não muda. Assim o revisor não precisa ler o diff do JSON para saber que nenhum canal sumiu.

**A caracterização de cada corte** usa o `carregar-main.js`, como os quatro testes `main-*.test.js` de hoje: `carregarMain({ electron, modulos })` com os falsos do corte e `main.invocar(canal, ...)`. Ela é gravada num commit antes do corte e roda verde no código antigo.

**A prova real, para todos os cortes, sem aparelho (o agente, numa máquina de prova Mac e numa Windows):**

1. `NOVA_SMOKE_TEST=1 NOVA_SMOKE_DIR=<pasta> npm start` no head da PR. O modo existe no `main.js` (linhas 24 a 44) e está descrito no `app/README.md`, linha 38. Ele grava `result.json` e `screen.png` e sai com 0 se a interface carregou, com `api: "object"` (o `window.electronAPI` do preload). Isso pega um módulo faltando, um `require` quebrado e um canal registrado duas vezes (o `ipcMain.handle` repetido lança erro na abertura).
2. **Antes e depois pelos canais.** O preload expõe `electronAPI.invoke(canal, ...args)` genérico (`app/electron/preload.js`, linha 13). Com o app aberto com `NOVA_TEST_INSTANCE=1` (que isola `userData` numa pasta temporária, linhas 4110 a 4115) e `--remote-debugging-port`, um roteiro fora do produto chama os canais de leitura do corte, no commit base e no head, e compara os JSON. Os canais que gravam rodam numa conta de teste da máquina de prova, porque `Documentos/Nova Data` e `Nova_Vault` não são isolados por `NOVA_TEST_INSTANCE`.
3. O mesmo roteiro no app instalado do Mac, depois da cópia à mão (seção 5), para provar que a lista de arquivos copiados está completa.

### Corte 1: a fundação e o sistema

- **Testes de hoje:** 14 dos 19 canais, em `main-janela-sistema.test.js` e `main-teclado-area-de-transferencia.test.js`: `window-minimize`, `window-restore`, `window-control`, `get-realtime-system-metrics` (2 testes), `get-detailed-system-info`, `get-processes`, `kill-process`, `open-external-url`, `send-notification`, `system-exec-command`, `clipboard-read`, `clipboard-write`, `set-clipboard` e `keyboard-press` (no Mac e fora dele, com o erro). O texto do `spawn` da palavra de ativação é conferido em `python-runtime.test.js`.
- **Caracterização que falta:**
  - `main.caminhos.js`: os 26 caminhos com um `userData` falso; `ensureNovaDirectories` com e sem a pasta; `migrateStonicToNova` com cada combinação de `Stonic Data`/`Nova Data`, `Stonic_Vault`/`Nova_Vault`, perfil `Stonic AI` com arquivos já existentes no novo (não sobrescreve), e o erro engolido; `syncConfigurationBackup` e `restoreConfigurationBackup` com arquivos faltando e com JSON quebrado;
  - `wakeword:start` (o processo sobe pelo `spawn` falso, a saída do Python vira `wake-word-detected` na janela, linha inválida é ignorada) e `wakeword:stop` (com e sem processo); `startWakeWordDetector` não sobe em `NOVA_SMOKE_TEST`, nem durante o desligamento, nem com um processo já rodando;
  - `http-fetch` com resposta, erro e tempo esgotado (`axios` falso);
  - `keyboard-type` no Mac e fora dele; `send-whatsapp-keyboard` com nome e mensagem vazios, no Mac e no Windows, com o `@jitsi/robotjs` falso registrando a ordem das teclas e os tempos no relógio falso.
- **Risco: ALTA** pelo caminho (`ipc-e-preload`) e pelo conteúdo (processos e teclado). O perigo real está na migração: ela copia e renomeia pastas do usuário na abertura, e não pode mudar de ordem.
- **Prova real:**
  1. o agente: o teste de fumaça e o roteiro de antes e depois (`get-realtime-system-metrics`, `get-detailed-system-info`, `get-processes`, `clipboard-read`, `window-control` com `minimize` e `restore`), no Mac e no Windows;
  2. o agente: numa conta de teste com uma pasta `Stonic_Vault` e um perfil `Stonic AI`, abrir o app e conferir a migração, comparada com o mesmo teste no commit base;
  3. o agente: `keyboard-press` e `keyboard-type` num editor de texto aberto, no Mac e no Windows (pede uma sessão com tela, sem aparelho);
  4. **o dono:** `send-whatsapp-keyboard` com o WhatsApp Desktop aberto e um contato de teste, e a palavra de ativação com microfone de verdade. Esta junta-se à [Prova real: palavra de ativação com microfone de verdade (PR 65)](https://github.com/vinicius928e8r84/Nova-AI/issues/82).

### Corte 2: a configuração e o atualizador

- **Testes de hoje:** os três `license:*` (`main-rtmp-edicao-ltm.test.js`); o atualizador só pelo texto (`paridade-b.test.js:97`).
- **Caracterização que falta:**
  - os 11 leitores de chave e de preferência, cada um com: sem arquivo, arquivo sem o campo, arquivo com o campo, JSON quebrado e a variável de ambiente presente. Os padrões não são iguais, e a fábrica que juntar as cópias precisa manter cada um como está: `get-groq-token` cai em `GROQ_API_KEY` só sem arquivo, mas devolve `null` com arquivo sem chave; `get-wa-api-key` nunca lê variável; `get-thinking-enabled` devolve `true` por padrão e no erro; `get-gemini-token` lê `apiKey`, depois `geminiKey`, depois `GEMINI_API_KEY`;
  - os 11 gravadores: o JSON gravado (com `updatedAt` do relógio falso) e o `false` no erro; `save-gemini-token` (linhas 2719 a 2734) é diferente: lê o `secret_key.json` que já existe, grava a chave em `apiKey` e em `geminiKey` e mantém os outros campos;
  - `get-openrouter-models` sem chave, com resposta e com erro (`axios` falso); `get-custom-models` e `save-custom-models`;
  - `sync-configuration-backup` com `export`, `import` e ação inválida;
  - o atualizador: os quatro canais com o `autoUpdater` falso, e os cinco eventos mandando à janela o que mandam hoje (`update-available`, `update-download-progress`, `update-downloaded`, `update-error`), com e sem janela; a busca na abertura só com `app.isPackaged` e `hasUpdateConfig()`.
- **Risco: ALTA** pelo caminho. Na prática é médio: são arquivos JSON do usuário, mas uma fábrica que troque um padrão apaga a chave que o dono configurou (por exemplo, `null` em vez da variável de ambiente).
- **Prova real:**
  1. o agente: o roteiro de antes e depois com os 11 `get-*` numa pasta de dados com chaves falsas, e cada `save-*` seguido do `get-*`;
  2. o agente: `sync-configuration-backup` exportar, apagar uma chave e importar;
  3. **o dono:** a instalação de uma atualização no Mac, que é a [PR 34: provar a instalação da atualização no Mac com o certificado Apple do dono](https://github.com/vinicius928e8r84/Nova-AI/issues/93). O atualizador muda de arquivo neste corte, e a prova pendente se faz junto (regra do mapa: "a prova pendente de um arquivo que vai ser cortado se faz junto com a prova do corte").

### Corte 3: os dados do usuário

- **Testes de hoje:** os três `ltm:*` (5 testes).
- **Caracterização que falta:** cada par `load-*`/`save-*` (memórias, perfil, painel, histórico, configurações do histórico, contatos, notas, tarefas) com e sem arquivo e com JSON quebrado; `clear-history`; `load-chats` e `save-chats` com o contador `globalChatSaveSessionCount` (linhas 2117 a 2138), que muda o que é gravado a cada chamada; `save-quick-note`; `get-user-context` e `sync-user-context` com o `user-profile-manager` falso; `chat:get-recall-summary`; `fetch-dashboard-data` sem chave, com resposta e com erro do `GoogleGenerativeAI` falso.
- **Risco: ALTA** pelo caminho. Na prática é baixo: é ler e gravar JSON em `userData`.
- **Prova real** (o agente, sem aparelho): o roteiro de antes e depois com os 13 `load-*` numa pasta de dados copiada de uma instalação de teste; uma conversa nova na interface e o `chats.json` conferido; `fetch-dashboard-data` com uma chave de teste do Gemini, se a máquina de prova tiver uma (se não tiver, passa para o dono).

### Corte 4: os arquivos

- **Testes de hoje:** `system-fs-op` (2 testes, 20 chamadas, com os prefixos e as operações).
- **Caracterização que falta:** as seis janelas de escolha (`dialog:open-file`, `open-media-dialog`, `open-audio-dialog`, `select-media-file`, `select-directory`, `select-multiple-media`), com o `dialog` falso cancelado e escolhido; `open-file` e `system-open` com o `shell` falso; `delete-file` e `save-file` (com e sem caminho, janela cancelada); `save-image`; `read-file-content` para PDF (`pdf-parse` falso), DOCX (`mammoth` falso), texto, imagem (data URL pelo `mime`) e arquivo grande (a condição de 3 ramos da linha 3032); `pick-and-read-files`. A tabela operação → função de `system-fs-op` mantém as mensagens de erro de cada operação.
- **Risco: ALTA** pelo caminho e pelo conteúdo (`system-fs-op` apaga, renomeia e copia).
- **Prova real** (o agente, numa máquina de prova com tela, sem aparelho): o roteiro de antes e depois com `system-fs-op` em `Documentos/Nova Data` de uma conta de teste (criar, listar, renomear, copiar, apagar); ler um PDF, um DOCX e uma imagem pelo anexo do chat; escolher um arquivo em cada janela de escolha pela interface.

### Corte 5: a mensageria

- **Testes de hoje:** nenhum dos 21 canais. Os testes `remote-access-avisos` e `remote-access-forca-token` cobrem o serviço, não os canais.
- **Caracterização que falta:** WhatsApp e Telegram com os gerentes falsos: `*-init` cria o gerente uma vez só e atualiza a janela depois; `*-get-state` sem gerente e com gerente; `save-*-settings` gravando e repassando ao gerente; `*-logout`; `*-send-reply`; o fluxo do Telegram (`send-otp`, `send-qr`, `submit-code`, `submit-password`) com sucesso e erro. Acesso remoto: `remote-access-status`, `regenerate`, `restart-tunnel` (a condição de 2 ramos) e os dois `broadcast-*`, com e sem serviço. O gerente criado por `whatsapp-init` tem de ser o mesmo que o `stopWindowServices` desliga, o que confere o `setter` do `contexto`.
- **Risco: ALTA** pelo caminho. O perigo real é o `contexto` gravar o gerente em outro lugar: o WhatsApp continuaria rodando depois do desligamento.
- **Prova real:**
  1. o agente: `whatsapp-get-state` e `telegram-get-state` sem conta, `remote-access-status` e `remote-access-regenerate` (que desconecta o celular antigo), no roteiro de antes e depois;
  2. o agente: abrir e fechar o app e conferir que não sobra processo do Chromium do WhatsApp (o mesmo critério de `stopWindowServices`);
  3. **o dono:** WhatsApp e Telegram com conta de teste (o código do Telegram chega num celular), no Mac e no Windows. Esta junta-se à [Prova real pós-merge: Telegram real da PR 55 (telegram-manager)](https://github.com/vinicius928e8r84/Nova-AI/issues/67);
  4. **o dono:** o acesso remoto pelo celular, com o túnel.

### Corte 6: a mídia e a voz

- **Testes de hoje:** `rtmp:start-broadcast`, `rtmp:stop-broadcast`, `rtmp:video-chunk`, `take-screenshot` e `get-screen-sources`. Os caminhos do `webview-bridge` e do `google-stealth-preload` não têm teste no `app/` (são canais `on` com `returnValue`).
- **Caracterização que falta:** os dois caminhos do preload (o `returnValue` é o caminho em `app/electron/`, o que prova que o módulo ficou na pasta certa); `screen-recorder:get-sources`; `screen-recorder:save` com a janela de salvar cancelada e escolhida, a conversão pelo `ffmpeg` (`spawn` falso) com sucesso e erro, e o arquivo temporário apagado; os seis `virtual-cam:*` com o injetor falso, cada ação de `virtual-cam:control`; `preview-voice` com o `exec` falso: o comando montado para cada voz, idioma, velocidade e tom, a legenda lida e o erro.
- **Risco: ALTA** pelo caminho e pelo conteúdo (processos `ffmpeg` e Edge TTS).
- **Prova real:**
  1. o agente: gravar 10 s da tela pela interface e conferir o MP4; a prévia de voz em português e em inglês; uma captura de tela; no Mac e no Windows;
  2. **o dono:** a câmera virtual e o RTMP com Android por USB. Esta junta-se à [Prova real pendente: PR 22 (RTMP com adb reverse do app)](https://github.com/vinicius928e8r84/Nova-AI/issues/77).

### Corte 7: o YouTube e o Kling

- **Testes de hoje:** nenhum canal; só o texto do `exec` do pipeline em `python-runtime.test.js:51`.
- **Caracterização que falta:** os canais do yt-dlp e do Nova Human com os gerentes falsos (com e sem gerente); `save-youtube-settings` (os três trechos da Bumpy Road: criar a pasta, gravar o `client_secret.json`, copiar vídeo e capa) e `get-youtube-settings`; `get-exported-files` com e sem pasta; `run-youtube-pipeline` sem `pipeline.py` (o caso do instalador de hoje), e com ele, para cada `phase` e `uploadMode`, com o `exec` falso; `open-downloader-folder`; `kling:save-video` (cópia do arquivo real) e `kling:convert-picture-to-video` com o serviço falso. O `KlingVideoService` continua sendo criado na hora do registro.
- **Risco: ALTA** pelo caminho e pelo conteúdo (processos Python e yt-dlp). Os `__dirname` de `youtube_auto` (linhas 1571, 1635, 1666 e 1787) só continuam certos com o módulo em `app/electron/`.
- **Prova real:**
  1. o agente: baixar um vídeo curto de domínio público pelo baixador manual, cancelar outro no meio, abrir a pasta; `run-youtube-pipeline` devolvendo o erro de `pipeline.py` ausente, igual ao commit base;
  2. **o dono:** o Kling com a conta dele, junto com a [Prova real pendente: PR 57 (Kling com serviço real)](https://github.com/vinicius928e8r84/Nova-AI/issues/79).

### Corte 8: os agentes

- **Testes de hoje:** `trigger-system-log`. Os controladores têm testes próprios (por exemplo, o palco do `antigravity-controller`), mas os canais não.
- **Caracterização que falta:** os seis `antigravity:*` com o controlador falso e sem ele; `nova-self` para cada ação (o `switch` das linhas 1210 a 1292) e com a janela destruída; `execute-ui-command`; `trigger-swarm-status`, `trigger-swarm-log`, `trigger-swarm` (sem controlador; com o modelo e a chave do agente filho lidos dos arquivos; delegado ou não) e `cancel-swarm`; `studio:*`: caminho inválido, sem `webui-user.bat`, a subida do processo e a espera pela porta 7860 com `axios` falso, o estado do motor; `gemini-account:*` sem o motor (falha no `require`) e com ele; `focus-app`.
- **Risco: ALTA** pelo caminho e pelo conteúdo (o estúdio sobe um processo).
- **Prova real:**
  1. o agente: `nova-self` pelas ações da interface (minimizar, maximizar, recarregar), `focus-app`, `studio:boot-engine` com uma pasta sem Stable Diffusion (o erro de hoje), `gemini-account:status`;
  2. **o dono:** o enxame com a chave dele e uma tarefa delegada; o login da conta do Gemini; o Antigravity, se ele o usa.

### Corte 9: o celular

- **Testes de hoje:** nenhum canal no `app/`. `MAC/integracao-iphone/conexao-usb/test/modal/integracao.js` usa `physical-mobile:iphone-prepare` e `ios-console-url`, mas com um `main.js` próprio de teste. O serviço tem testes próprios.
- **Caracterização que falta:** os 49 canais que só delegam: cada um chama o método certo do `physicalMobileService` (ou do `liveCamBridgeService`) com os argumentos na mesma forma. Eles variam: `(event, id)`, `(event, { id, port })` com `port || 8899`, `(event, { id, app: appName })`. Mais os sete com lógica: `start-stream` (iPhone abre o modal e manda o nome do aparelho depois; Android transmite), `iphone-prepare` (janela errada, sem id, sucesso manda `status-updated`), `ios-console-open`, `ios-console-url` (com `novaIosConsolePortOpen` falso), `trigger-lsposed-broadcast` (o `exec` falso falha uma vez e cai no `su`), `live-cam-bridge:select-spoof-video` e `enable-physical-cameras`. O registro do CAM LIVE continua acontecendo antes dos canais do celular, como na linha 713.
- **Risco: ALTA** pelo caminho e pelo conteúdo (ADB, SSH do iPhone, `exec`).
- **Prova real:**
  1. o agente: `physical-mobile:get-status` e `scan-wifi-devices` sem aparelho, e o roteiro de antes e depois com eles;
  2. **o dono:** iPhone com jailbreak (Conectar, Abrir controle, identidade simulada, proxy) e Android (transmissão, câmera falsa, `spoofer:*`). É a mesma sessão das provas do corte do `physicalMobileService.js`, e cabe junto com a [Prova real em aparelho pendente do PR 36](https://github.com/vinicius928e8r84/Nova-AI/issues/61) (`enable-physical-cameras`).

### Corte 10: o cofre

- **Testes de hoje:** nenhum.
- **Caracterização que falta:** os caminhos do cofre; `initialize-vault` com e sem pasta; as pastas importadas; `pick-folder`; `save-vault-md`; `search-vault-memory`: pedido vazio, pedido sem palavra de memória (devolve `""` sem ler nada), com palavra de memória e com o `MyActivity.json` no cofre e em `app/Nova_Vault` (o `__dirname` da linha 2397); `scan-vault-graph` num cofre de teste com notas, etiquetas, ligações, o histórico e o `MyActivity.json`: os nós e as ligações gravados por inteiro, na ordem. A tabela de etiquetas (`detectTags`) e o `addNode` de 8 argumentos são a refatoração do corte.
- **Risco: ALTA** pelo caminho. Na prática é médio: só lê, mas a saída é grande e a ordem dos nós aparece no grafo da interface.
- **Prova real** (o agente, sem aparelho): um cofre de teste em `Documentos/Nova_Vault` de uma conta de teste; o grafo pela interface e o JSON de `scan-vault-graph` comparados com o commit base; uma pergunta "o que eu fiz ontem" no chat e o texto de `search-vault-memory` comparado.

### Corte 11: a janela e o ciclo de vida

- **Testes de hoje:** nenhum confere o comportamento; `main-carregar-limpeza` confere o palco, e o `carregar-main.js` para no primeiro `show` da janela.
- **Caracterização que falta:** `createWindow`: as opções da `BrowserWindow`, a bandeja (com e sem ícone, com e sem as ferramentas do iOS), o menu por plataforma, o `close` do Mac, o `alwaysOnTop` desligado em 2 s, a recuperação do `render-process-gone`, os controladores criados uma vez e reaproveitados, a conexão automática do WhatsApp (só com `autoConnect`) e do Telegram em 5 e 6 s; `startProductionServer` com a porta ocupada (tenta a próxima) e os tipos MIME; os dois `onHeadersReceived`; `stopWindowServices` e a ordem do desligamento; `activate` sem janela recria a janela, atualiza os gerentes e sobe a palavra de ativação. O `carregar-main.js` ganha um modo que não para no `show`.
- **Risco: ALTA**, e o maior de todos: é o corte que decide se o app abre e se fecha sem deixar processo.
- **Prova real:**
  1. o agente: o teste de fumaça; abrir, minimizar para a bandeja, reabrir pela bandeja, fechar; segunda instância foca a primeira; no Mac e no Windows;
  2. o agente: a porta 45678 ocupada por outro processo, e o app abre na seguinte;
  3. **o dono:** fechar o app com iPhone e Android ligados e conferir que não sobra processo. Esta junta-se à [Prova real pendente: PR 17 (processos órfãos ao sair) com aparelho real](https://github.com/vinicius928e8r84/Nova-AI/issues/75).

## 5. O empacotamento

**O instalador não muda.** O `app/package.json` tem `"asar": false` e `build.files` começa com `"**/*"`. Qualquer arquivo novo em `app/electron/` entra no `.dmg` e no instalador do Windows. Nenhuma das exclusões (`!**/*.bak*`, `!**/*.log`, `!**/*.antes-proxy-*`, `!**/*_key.json`, entre outras) pega `main.<área>.js`. O `MAC/integracao-iphone/distribuicao/preparar-pacote.py` copia o app instalado inteiro com `shutil.copytree`, e também não precisa mudar.

**O que muda é a cópia à mão para o app instalado no Mac** (`AGENTS.md`, seção 5). Hoje o costume é copiar só os arquivos trocados para `/Applications/Nova AI Mac.app/Contents/Resources/app/electron/`. O `MAC/LEIA-ME.md` (linha 57) já registra o que acontece quando um arquivo novo fica para trás: o `live-cam-bridge.js` faz `require('./live-cam-paginas')`, e copiar só ele impede o CAM spoof de abrir (`MODULE_NOT_FOUND`). Com o `main.js`, o efeito é pior: o `require` dos módulos novos roda na abertura, e **o app não abre**. Por isso, em cada corte:

1. O corpo da PR lista, em "Arquivos do app instalado trocados", o `main.js` e **todos** os `main.*.js` que existem depois do corte, não só os novos. Assim quem aplicar um corte sem ter aplicado o anterior não fica com o app quebrado.
2. A reaplicação é uma linha só, que pega todos de uma vez:
   ```bash
   cp app/electron/main.js app/electron/main.*.js "/Applications/Nova AI Mac.app/Contents/Resources/app/electron/"
   for f in "/Applications/Nova AI Mac.app/Contents/Resources/app/electron/"main*.js; do node --check "$f"; done
   ```
   Antes, guardar o `main.js` anterior em `reservas/`, se a regra da cópia de reserva ainda valer (a [Apaga as 55 cópias de reserva](https://github.com/vinicius928e8r84/Nova-AI/pull/101) e a decisão do mapa mexem nessa regra).
3. **Para desfazer**, basta pôr o `main.js` anterior de volta. Os `main.*.js` que sobrarem não são carregados por ninguém e podem ficar, mas o corpo da PR deve dizer isso.
4. A prova real do corte inclui abrir o app instalado depois da cópia (passo 3 da prova comum, na seção 4).

**No Windows** o app instalado é o do instalador (`...\Programs\Nova AI\resources`, segundo `docs/windows.md`, seção 6), que só muda com um instalador novo gerado por `npm run dist:win`. Os arquivos novos entram sozinhos.

**Recomendação para o dono:** acrescentar uma linha ao `PULL_REQUEST_TEMPLATE.md`, na seção "Arquivos do app instalado trocados": "se a PR cria arquivo em `app/electron/`, liste-o e copie-o junto". Ela vale para os onze cortes deste arquivo e para os cortes dos serviços grandes, que também criam módulos novos.

## 6. As regras que cada corte encontra

- **`sem-comentario-novo`.** Linha movida conta como linha tocada. A [Zera os comentários de main.js e preload.js](https://github.com/vinicius928e8r84/Nova-AI/pull/148) (aberta, +5 −75 no `main.js`) entra antes da campanha, pela decisão do mapa sobre as PRs abertas. Os números de linha desta pesquisa são do `1b45c3f` e mudam depois dela.
- **`saude-do-codigo`.** Cada módulo nasce com zero ponto e média abaixo de 4. Os 406 pontos dos tratadores se refatoram no corte em que chegam: tabela no lugar da cascata (`system-fs-op`, `nova-self`, `virtual-cam:control`, as etiquetas do cofre), decidir separado de fazer (`preview-voice` e `run-youtube-pipeline`: montar o comando, depois rodar), um nome para a condição composta, e o objeto do domínio no lugar dos 8 argumentos de `addNode` (o nó do grafo).
- **`limite-de-linhas`.** O maior módulo estimado tem cerca de 350 linhas.
- **Teto de 20.000 bytes.** Todos os módulos ficam abaixo de 14 KB. O `main.js` fica abaixo do teto a partir do corte 11. Ainda não é regra de máquina.
- **As linhas de base.** Cada corte baixa o `main.js` em `saude-do-codigo` e em `limite-de-linhas` com `node scripts/regras/verificar.js --atualizar-linha-de-base`. Os módulos novos não entram nas linhas de base.
- **Atenção.** Todos os cortes são ALTA pelo glob `**/main.js`, e os módulos novos pelo glob `**/main.*.js`, que já existe. Não é preciso mudar `caminhos-sensiveis.json`.

## 7. O que não deu para conferir

- **A nota de cada módulo no painel.** A catraca em zero não garante 10: o painel mede duplicação e coesão, e a catraca não. A nota só aparece no check do CodeScene quando a PR abre. As duplicações que o painel acusa hoje estão nomeadas na seção 1, e o corte que as recebe precisa juntá-las.
- **Os tamanhos dos módulos** são somas dos trechos de hoje, mais ou menos a duplicação que some. Não escrevi os módulos.
- **O teste de fumaça e o roteiro de antes e depois** não rodaram aqui: esta máquina não tem o `app/node_modules` (o Electron e as dependências do app), e o disco não comporta a instalação. Rodei os testes de `node --test` que não precisam do Electron.
- **Se a máquina de prova Mac da frota tem tela que o agente consiga operar.** Se não tiver, os passos do Mac com tela (teclado, janelas de escolha, bandeja) passam para o dono.
- **O comportamento de `ipcMain.handle` repetido.** O Electron lança erro quando um canal recebe dois `handle`. Não conferi isso na versão do Electron do app; o teste de fumaça pega o caso de qualquer jeito.

## 8. PRs abertas que tocam o `main.js`

- [Zera os comentários de main.js e preload.js](https://github.com/vinicius928e8r84/Nova-AI/pull/148): +5 −75 no `main.js`. Entra antes do corte 1.
- Nenhuma outra PR aberta em 23/11 mexe no `main.js`, no `preload.js`, nos testes `main-*` ou no `mapa-ipc` (conferido pela lista de arquivos de cada uma das 16 PRs abertas). A [refatoracao: Lote Nova 4](https://github.com/vinicius928e8r84/Nova-AI/pull/100) cria testes em `app/test/` (`pwa-app.*`), mas não toca o `carregar-main.js`.

Os cortes dos outros arquivos grandes estão nas pesquisas irmãs: [Pesquisa: o corte do browserFarmService.js](https://github.com/vinicius928e8r84/Nova-AI/issues/129), [Pesquisa: o corte do global-spoof-service.js](https://github.com/vinicius928e8r84/Nova-AI/issues/128) e [Pesquisa: o corte do physicalMobileService.js](https://github.com/vinicius928e8r84/Nova-AI/issues/130).

## Fontes

- `app/electron/main.js` em `1b45c3f`, medido no conteúdo do git (`git show 1b45c3f:app/electron/main.js`).
- Pontos: `scripts/regras/analisador/medir.js` (`medirFontes`) e `pontos.js` (`pontuar`), sobre o arquivo inteiro, sobre cada comando de `registerHandlers` embrulhado numa função, e sobre o arquivo com os trechos de cada corte tirados em ordem. Linha de base em `scripts/regras/linha-de-base.json`. A regra que só abre unidade nova fora de função com nome está em `scripts/regras/analisador/medir-js.js` (linhas 58 a 61 e 145 a 153).
- Painel: `GET /api/v2/projects/2/analyses/141/files` (nota, achados, hotspot, frequência de mudança) e, no container `opencleancode`, `/codescene/analysis/bf7c60de594d421d9bbfe535b1dd3b45859e9e1f/analysis20261123130010/code_health_details/e0cc7012bcfac07f519e94b4423c929475279be7.json` (as funções de cada achado, as duplicações e a Bumpy Road). A análise é da revisão `1b45c3f4507fb1acea82c12e7898adfe2a72b60e`.
- Testes: `node --test app/test/main-carregar-limpeza.test.js app/test/main-janela-sistema.test.js app/test/main-rtmp-edicao-ltm.test.js app/test/main-teclado-area-de-transferencia.test.js app/test/mapa-ipc.test.js app/tests/idioma-registro.test.js app/test/paridade-b.test.js app/test/python-runtime.test.js`: 52 testes, 50 verdes, 2 vermelhos por plataforma (os de `pkill` do Mac, no Windows).
- Palco: `app/test/ajuda/carregar-main.js` (linhas 12 a 19 e a função `carregarMain`, a partir da linha 168). Mapa de canais: `app/test/mapa-ipc.test.js` e `mapa-ipc.json` (237 canais no `main.js`, 344 no total).
- Atenção: `scripts/regras/caminhos-sensiveis.json`, linha 8 (grupo `ipc-e-preload`).
- Empacotamento: `app/package.json` (`build`), `MAC/integracao-iphone/distribuicao/preparar-pacote.py`, `MAC/LEIA-ME.md` (linha 57), `docs/windows.md` (seção 6), `AGENTS.md` (seção 5), `.github/PULL_REQUEST_TEMPLATE.md`.
- Provas pendentes ligadas ao `main.js`: a pesquisa [as provas reais pendentes, arquivo por arquivo](https://github.com/vinicius928e8r84/Nova-AI/issues/137) (`pesquisas/nota-10/provas.md`, commit `231b007`).
