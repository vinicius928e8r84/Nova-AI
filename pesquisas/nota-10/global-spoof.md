# O corte do `global-spoof-service.js`

Esta é a pesquisa do ticket [Pesquisa: o corte do global-spoof-service.js](https://github.com/vinicius928e8r84/Nova-AI/issues/128), que faz parte do mapa [Nova-AI na nota 10 no CodeScene: o plano, com a fila de lotes e as regras que seguram](https://github.com/vinicius928e8r84/Nova-AI/issues/120). A irmã dela é a pesquisa [do browserFarmService.js](https://github.com/vinicius928e8r84/Nova-AI/issues/129), e as duas dividem código.

Tudo foi conferido na `main` em `1b45c3f`, o mesmo commit da análise 141 do painel (23/11, 13:00 UTC). Os números de linha citados são desse commit. As PRs #147 e #149, que tiram os comentários do arquivo, deslocam as linhas em cerca de 45, mas não mexem no texto do script injetado. Esta pesquisa não muda código de produto.

## A resposta em poucas linhas

- O arquivo se divide em **nove módulos `global-spoof-*.js`**, e o serviço fica com uns 7,5 KB. O serviço guarda o estado, o `detectDriver`, o `startHijack` como roteiro curto, o `stopHijack`, o status e os métodos legados que o IPC chama.
- São **seis cortes em série**, porque todos mexem no mesmo arquivo. Os cinco primeiros tiram todos os 1.584 pontos da catraca:

  | Corte | Pontos que tira |
  |---|---:|
  | 1. o texto da página | cerca de 650 |
  | 2. o perfil | 215 |
  | 3. a identidade | 237 |
  | 4. o Chrome | 229 |
  | 5. o CDP | 255 |

- O sexto corte não muda a catraca, mas é o que leva a 10 os dois módulos do script da página. **O painel lê como código o script que vai dentro do texto**: 5 dos 8 tipos de achado que o painel aponta no arquivo estão dentro desse texto. Por isso movê-lo byte a byte não basta para a nota 10, e reescrevê-lo muda o código-fonte que a página consegue ler. A pergunta sobre isso foi feita ao dono (decisão D39, ver a seção 6). Os cortes 1 a 5 não dependem da resposta.
- **Os testes de hoje cobrem 7,33% das linhas** do arquivo, e só a busca do navegador. A caracterização precisa de um palco novo, no molde `palco`/`cenas`/`esperado` que o repositório já usa, e de um roteiro no Chrome de verdade.
- **Nenhum corte pede iPhone nem Android.** Os perfis de celular são só emulados no Chrome. O agente prova no Windows, com o Chrome real (feito aqui, ver a seção 5). O dono prova os ramos do Mac (`pkill`, `mac-native`, `afplay`) no app instalado.
- Na execução real apareceram **seis defeitos** que os cortes precisam manter como estão e que pedem consertos à parte (seção 7). Dois deles são graves:
  - escolher o perfil `Default` faz o `startHijack` cair com `TypeError`;
  - o Chrome 157 ignora `--load-extension`, e por isso o script de disfarce às vezes não chega à primeira página.

## 1. Como o arquivo é hoje

### Os números

| Medida | Valor | Fonte |
|---|---|---|
| Linhas | 1.787 | `wc -l`; linha de base do `limite-de-linhas` (`scripts/regras/linha-de-base.json:5`) |
| Bytes no git (LF) | **79.789** | `git cat-file -s HEAD:app/electron/services/global-spoof-service.js` |
| Bytes no Windows (CRLF) | 81.576 | o número da issue; a diferença de 1.787 bytes são os `\r` do checkout com `core.autocrlf=true` |
| Pontos na catraca | 1.584 | `scripts/regras/linha-de-base.json:23`; medido de novo com `medirJs` e `pontuar` de `scripts/regras/analisador/` |
| Nota no painel | 3,15 (3,1514) | API do painel, análise 141, `/api/v2/projects/2/analyses/latest/files` |
| Linhas de código que o painel conta | 1.562 | idem |
| Hotspot | sim, 9 mudanças | idem (`change_frequency: 9`) |

**O teto de 20.000 bytes precisa dizer em que fim de linha se mede.** O mesmo arquivo tem 1.787 bytes a mais no checkout do Windows. Esta pesquisa usa os bytes do git (LF), que são os que a CI e o painel veem (os dois rodam em Linux).

### Os pontos da catraca, por função

Total de 1.584 pontos, em 21 unidades:

| Unidade (linha) | Pontos | De onde vêm |
|---|---:|---|
| `startHijack` (183) | 1.435 | 1.259 linhas (1.190 acima de 69); complexidade 225 (217 acima de 8); aninhamento 5; 17 blocos aninhados; 8 condições com mais de um operador lógico |
| `ensureProfileStealthSpecs` (18) | 79 | complexidade 35, 119 linhas, 1 bloco aninhado, 1 condição com 2 operadores |
| `_findChrome` (1620) | 66 | complexidade 30, 112 linhas, 1 bloco aninhado |
| `stopHijack` (1477) | 3 | complexidade 11 |
| o arquivo | 1 | complexidade média das funções acima de 4 |

A catraca não entra no texto do script injetado: para ela, ele é uma string. As funções anônimas de dentro do `startHijack` (a IIFE do CDP, o `setInterval` do e-mail, os ouvintes de evento) somam à complexidade do próprio `startHijack`.

### O que o painel vê: o script injetado conta como código

O arquivo de detalhes da análise 141 no servidor do painel lista as funções com achados. O arquivo é `code_health_details/c85f2639….json`, na pasta da análise dentro do container `opencleancode`. Dos achados, estes caem **dentro do texto** `deepHijackScript`, que vai das linhas 616 a 1171:

| Achado do painel | Função | Linhas |
|---|---|---|
| Excess Number of Function Arguments (2) | `applyStealth…WebGLRenderingContext.prototype.readPixels` e `…WebGL2…readPixels`, 7 argumentos cada | 1027, 1039 |
| Complex Method | `applyStealth.overrideGUM` (complexidade 12), `applyStealth.enumerateDevices` (9) | 950, 916 |
| Deep, Nested Complexity | `applyStealth.overrideGUM` (aninhamento 5) | 950 |
| Bumpy Road | `applyStealth.overrideGUM` (2 lombadas) | 950 |
| Complex Conditional | `applyStealth.toString` (linha 723) | 723 |
| Code Duplication (só no arquivo de detalhes; não entra na lista de achados da API) | `geolocation.getCurrentPosition` e `watchPosition` | 824-840 |

Os outros achados estão no código de verdade:

- **Complex Method:** `startHijack` (185), `ensureProfileStealthSpecs` (35), `_findChrome` (30), o ouvinte `'Target.attachedToTarget'` (19) e `stopHijack` (11).
- **Large Method:** `startHijack` (429 linhas), `_findChrome` (103) e `ensureProfileStealthSpecs` (101).
- **Bumpy Road:** `startHijack` (16 lombadas), `_findChrome`, `ensureProfileStealthSpecs` e `'Target.attachedToTarget'`.
- **Complex Conditional:** 6 no `startHijack` e 1 no `ensureProfileStealthSpecs`.
- **Achados do arquivo inteiro:** File Size e Overall Code Complexity (média 8,46).

O painel conta 50 funções no arquivo, contra as 21 da catraca. O painel não acusa nada dentro do script de e-mail (linhas 1243-1291), que é outro texto mas não tem `${}`.

**Consequência.** A pesquisa irmã do farm (#129) disse que "os textos de script são strings para o analisador e para o painel". Isso vale para a catraca, mas **não vale para o painel neste arquivo**. Quem mover o `deepHijackScript` byte a byte para outro arquivo `.js` leva junto esses cinco tipos de achado, e o arquivo de destino não chega a 10. Vale conferir o mesmo no `getStealthSpoofScript` do farm antes do corte 3 de lá.

Os limites do painel são os padrões do CodeScene para JavaScript, porque o painel não tem regra própria (`custom-code-health-rules.json` é `{}` na pasta da análise). Os padrões estão no pacote oficial [default-rules.zip](https://codescene.com/hubfs/Technical%20Support%20Data/default-rules.zip), arquivo `code-health-rules.js.json`, que a página [What Are the Default Threshold Values](https://helpcenter.codescene.com/articles/6084507-what-are-the-default-threshold-values-for-different-programming-languages) aponta:

| Limite | Valor |
|---|---:|
| complexidade de função, para o aviso | 9 |
| linhas de função | 70 |
| argumentos | 4 |
| aninhamento | 4 |
| lombadas (Bumpy Road) | 2 |
| ramos de condição | 2 |
| complexidade média do arquivo | 4 |
| linhas de arquivo, para o aviso | 1.000 |
| duplicação | a partir de 10 linhas com 75% de semelhança |

### As partes do arquivo

Bytes em LF, medidos por intervalo de linhas. Os desvios foram contados com o mesmo `acorn` e o mesmo critério do analisador.

| Parte | Linhas | Bytes | Desvios |
|---|---|---:|---:|
| cabeçalho e `require` | 1-16 | 536 | 0 |
| `ensureProfileStealthSpecs` | 17-136 | 4.630 | 35 |
| construtor e `detectDriver` | 138-181 | 1.524 | 3 |
| `startHijack`: limpeza do Chrome órfão | 183-203 | 1.522 | 6 |
| `startHijack`: fuso (`getTimezoneOffset`, `getGMTLabel`) | 204-226 | 1.040 | 2 |
| `startHijack`: cria o perfil de nome livre | 227-284 | 2.950 | 24 |
| `startHijack`: carrega o perfil ativo ou o temporário | 285-327 | 1.965 | 13 |
| `startHijack`: acha o navegador | 328-337 | 388 | 2 |
| `startHijack`: lê o proxy | 338-370 | 1.415 | 12 |
| `startHijack`: pastas do perfil | 371-379 | 425 | 3 |
| `startHijack`: identidade regional | 380-450 | 3.490 | 37 |
| `startHijack`: janela e câmera | 451-497 | 1.591 | 16 |
| `startHijack`: grava o clipe e gera o Y4M | 498-516 | 822 | 4 |
| `startHijack`: argumentos do Chrome | 517-560 | 1.771 | 11 |
| `startHijack`: áudio | 561-588 | 1.445 | 6 |
| `startHijack`: valores do script | 589-614 | 1.952 | 29 |
| **`startHijack`: o texto do script da página** | 615-1171 | **23.502** | 9 (os `${}`) |
| `startHijack`: extensão | 1172-1199 | 1.174 | 1 |
| `startHijack`: `spawn` e `connectCDP` | 1200-1227 | 1.195 | 5 |
| `startHijack`: CDP, vigia de e-mail (script e gravação) | 1228-1339 | 6.279 | 20 |
| `startHijack`: CDP, autenticação do proxy | 1340-1371 | 1.693 | 4 |
| `startHijack`: CDP, auto-attach | 1372-1462 | 5.017 | 25 |
| `startHijack`: fim | 1463-1475 | 447 | 0 |
| `stopHijack` | 1476-1529 | 1.653 | 10 |
| `listProfiles` | 1530-1550 | 906 | 6 |
| `_generateY4M` | 1551-1618 | 2.793 | 4 |
| `_findChrome` | 1619-1731 | 5.904 | 29 |
| métodos legados, status e `getStatus` | 1732-1788 | 1.759 | 4 |

O texto do script da página, sozinho, já passa do teto: são 23.502 bytes. Ele precisa ir para **dois** arquivos. Por bloco:

| Bloco do script | Bytes |
|---|---:|
| preâmbulo (`cdc_`, `webdriver`, Brave, Vivaldi) | 1.228 |
| variáveis do perfil | 2.324 |
| `toString` e `frames` | 1.809 |
| fuso e `Date` | 3.250 |
| geolocalização | 906 |
| `navigator` | 967 |
| GPU do WebGL | 729 |
| `MediaStreamTrack` | 1.391 |
| `enumerateDevices` | 2.168 |
| `getUserMedia` | 1.823 |
| canvas | 1.265 |
| ruído do WebGL | 1.109 |
| ClientRects | 755 |
| áudio | 1.274 |
| vozes | 383 |
| Do Not Track | 592 |
| bloqueio de portas | 920 |
| iframes e fim | 511 |

### O código duplicado com o farm

Comparei os trechos com um script que tira os comentários e os espaços das pontas:

- `ensureProfileStealthSpecs` (linhas 18-136) é **igual linha a linha** ao de `browserFarmService.js:250`. Só os comentários diferem: são 101 linhas de código iguais.
- O script de vigia do e-mail (linhas 1244-1290) é **igual** ao miolo de `DETECT_EMAIL_SCRIPT`, em `browserFarmService.js:39-102`: 46 linhas iguais.
- A leitura do proxy **não** é igual à `parseProxy` do farm (`browserFarmService.js:194`). A do farm entende `protocolo://` e devolve `proxyRules`; a do spoof monta `proxyServer` com o que vier antes do `@`. Unificar as duas mudaria o comportamento, então cada uma fica onde está.
- As duas cascatas de navegador do `_findChrome` (linhas 1626-1634 e 1686-1690) chamam os quatro `get*ExecutablePath` do farm. As listas de caminhos do Windows (linhas 1647-1680 e 1697-1726) são a mesma lista escrita duas vezes.

### Quem usa o arquivo de fora

- `virtual-cam-injector.js` cria o serviço e repassa `detectDriver`, `startHijack`, `stopHijack`, `installOBSVirtualCam`, `getStatus`, `_emitStatus`, `writeChunk` e `isHijacking` (linhas 8-62). A dívida [#109](https://github.com/vinicius928e8r84/Nova-AI/issues/109) é tirar essa casca; ela não depende dos cortes e pode vir antes ou depois deles.
- `main.js` chama `virtualCamInjector.globalSpoof` direto em `listProfiles` (1337), `updateRegional` (1374), `broadcastTransform` (1392), `spoofRegistryName` e a marca `registrySpoofed` (1403-1404). Todos esses nomes ficam na classe.
- A interface manda em `virtual-cam:control` com `action: "hijack"` os campos `settings.profile`, `device`, `url`, `audioPath`, `rotate`, `proxy` e `regional`. O `regional` leva `timezone` e `language` como `"optimal"` quando o perfil não tem (`app/dist/assets/index-Dun7lr2S.js`).
- O serviço emite três canais para a janela: `virtual-cam:status`, `virtual-cam:install-progress` e `farm:profile-update`.
- Três métodos não têm nenhum chamador no repositório nem no bundle: `_emitInstallStatus`, `_sleep` e `revertRegistryName`. Conferido com `git grep`.

## 2. Os módulos de destino

Os nomes seguem o costume do repositório de usar prefixo em vez de subpasta (`browser-ferramentas-*`, `inventory-*` e, pela pesquisa #129, `farm-*`). O prefixo `global-spoof-` também deixa um glob só cobrir o serviço e os módulos na lista de atenção ALTA (seção 4).

Os tamanhos são a soma dos trechos de hoje, menos a duplicação que some e os comentários que a regra `sem-comentario-novo` obriga a tirar das linhas movidas. O código de ligação muda isso em algumas centenas de bytes.

| Módulo | Responsabilidade | Corte | Tamanho estimado |
|---|---|---:|---:|
| `global-spoof-pagina-ambiente.js` | a primeira metade do script da página: preâmbulo, `toString` e `frames`, fuso e `Date`, geolocalização, `navigator`, GPU do WebGL, Do Not Track, bloqueio de portas, iframes | 1 (como texto), 6 (como código) | 11 KB |
| `global-spoof-pagina-midia.js` | a segunda metade: `MediaStreamTrack`, `enumerateDevices`, `getUserMedia` e os ruídos (canvas, WebGL, ClientRects, áudio, vozes) | 1, 6 | 10,5 KB |
| `global-spoof-pagina.js` | decide os valores do disfarce a partir do perfil e do aparelho (hoje são 29 desvios de `||` e ternário, que viram tabela de padrões), monta o script e grava a extensão (`manifest.json` e `inject.js`) | 1 | 5 KB |
| `global-spoof-perfil.js` | o perfil do CAM spoof: cria o perfil de nome livre (próximo `profile_NN`), carrega o perfil ativo e completa os campos que faltam, monta o perfil temporário, `listProfiles`. Usa o `ensureProfileStealthSpecs` compartilhado | 2 | 5 KB |
| `farm-perfil.js` (compartilhado) | `ensureProfileStealthSpecs` uma vez só, por tabela de plataforma. É o módulo que a #129 propõe no corte 1 do farm; o spoof passa a usá-lo | 2 | (conta para o farm) |
| `global-spoof-identidade.js` | a identidade regional: fuso, deslocamento e rótulo GMT, latitude e longitude, idiomas e `Accept-Language`, o "ótimo" pelo `getOptimalGeoDetails` do farm, o tamanho da janela e da câmera, a leitura do proxy | 3 | 7 KB |
| `global-spoof-chrome.js` | o Chrome: matar os órfãos (`pkill` no Mac; `wmic` e depois PowerShell no Windows), a tabela navegador → caminhos (o `_findChrome` sem as duas cópias da lista), os argumentos, o áudio, o `spawn` e o `taskkill` do fim | 4 | 9,5 KB |
| `global-spoof-y4m.js` | grava o clipe da tela e gera o `fake_cam.y4m` com o ffmpeg (`_generateY4M`) | 4 | 3,5 KB |
| `global-spoof-cdp.js` | a sessão do CDP: conectar com novas tentativas, a vigia do e-mail (usando o `DETECT_EMAIL_SCRIPT` do módulo de scripts do farm), a autenticação do proxy, o auto-attach com o user agent, o fuso, a geolocalização, a emulação de celular e o script em cada alvo | 5 | 9 KB |
| `global-spoof-service.js` (fica) | o estado, o construtor (com a linha `this.ffmpegPath = toolPaths.ffmpeg() \|\| 'ffmpeg'` que um teste procura no texto), `detectDriver`, o `startHijack` como roteiro de umas 50 linhas, `stopHijack`, `_emitStatus`, `getStatus`, os métodos legados que o `main.js` chama e `_findChrome` delegando (um teste o chama pelo protótipo) | — | 7,5 KB |

O texto de vigia do e-mail vai para o módulo de scripts do farm (`farm-scripts-da-pagina.js`, pela #129) e o spoof passa a importá-lo, sem cópia.

**O estado fica no objeto do serviço:** `isHijacking`, `chromePid`, `chromeProcess`, `ffplayProcess`, `cdpClient`, `checkEmailInterval`, `activeSessions`, `registrySpoofed` e `isInstallingDriver`. O `main.js`, o `virtual-cam-injector.js` e o `stopHijack` leem esses campos direto. Os módulos de fluxo (`global-spoof-chrome.js` e `global-spoof-cdp.js`) recebem o serviço e escrevem nele; os outros são funções puras.

**Os três métodos sem chamador** (`_emitInstallStatus`, `_sleep` e `revertRegistryName`) podem sair no último corte. Apagar código morto não muda o comportamento.

## 3. Os cortes em série

Todos mexem no `global-spoof-service.js`, e um lote tem um corte por arquivo, por isso vão em série. Os pontos de cada corte vêm das linhas e dos desvios que saem do `startHijack` (1.293 linhas e 231 desvios ao todo), mais as funções que saem inteiras. São estimativas de cerca de 10%; a catraca mede o número exato depois de cada corte. O último corte leva a sobra, porque a função que fica ainda tem direito a 69 linhas e complexidade 8.

| # | Corte | O que tira | Pontos (aprox.) | Bytes que saem (aprox.) | Atenção |
|---|---|---|---:|---:|---|
| 1 | **o texto da página** | o `deepHijackScript` (557 linhas), as variáveis que o alimentam (linhas 589-614) e a gravação da extensão (1172-1199). Vão para `global-spoof-pagina*.js` **byte a byte**: o `inject.js` gravado e o texto mandado ao CDP saem com o mesmo sha256 para os mesmos dados | 650 | 26.500 | ALTA |
| 2 | **o perfil** | `ensureProfileStealthSpecs` (79 pontos; usa o de `farm-perfil.js`), a criação do perfil de nome livre, o carregamento do perfil ativo, o perfil temporário e `listProfiles` | 215 | 10.000 | ALTA |
| 3 | **a identidade** | `getTimezoneOffset` e `getGMTLabel`, a identidade regional (cascata de "ótimo" e "personalizado" → tabela de quem decide cada campo), o tamanho da janela e da câmera (tabela por plataforma), a leitura do proxy | 237 | 7.500 | ALTA |
| 4 | **o Chrome** | a limpeza de órfãos, `_findChrome` (66 pontos; uma tabela navegador → caminhos no lugar das duas cópias), as pastas, os argumentos, o áudio, o `spawn`, o `taskkill` do `stopHijack`, `_generateY4M` | 229 | 15.000 | ALTA |
| 5 | **o CDP** | `connectCDP`, a vigia do e-mail, a autenticação do proxy, o auto-attach. O `startHijack` vira o roteiro, o `stopHijack` cai a complexidade 8 ou menos e o ponto da média do arquivo some | 255 | 13.000 | ALTA |
| 6 | **o script da página como código** | os dois módulos `global-spoof-pagina-*.js` deixam de ser texto e viram funções serializadas (`String(funcao)` mais os valores em JSON). Somem `overrideGUM`, `enumerateDevices`, os `readPixels` de 7 argumentos, a condição do `toString` e a geolocalização duplicada | 0 na catraca | 0 | ALTA, e **depende da decisão D39** |

**A ordem.**

- **O corte 1 vem primeiro** porque é o maior e o mais seguro. Ele tira 33% dos bytes e 41% dos pontos sem mudar um byte do que vai para o Chrome, e a prova é mecânica: o mesmo sha256.
- **Os cortes 2 e 3** só mexem em dados e não abrem processo.
- **O corte 4 vem antes do 5** porque o CDP precisa da porta e do processo que o 4 organiza.
- **O corte 6 vem por último**, porque depende da decisão do dono e é o único que muda o texto que vai para a página.

**Com o farm.** O corte 2 daqui usa o `farm-perfil.js` do corte 1 do farm, e o corte 5 usa o `farm-scripts-da-pagina.js` do corte 2 do farm. Se os do farm vierem antes, o spoof só importa. Se os daqui vierem antes, o corte daqui cria o módulo compartilhado com só aquela função, e o farm o completa depois. Isso é preferência, não trava. O corte 3 daqui usa o `getOptimalGeoDetails` do farm, que a #129 move no corte 4 de lá: o método continua no objeto do farm, então nada quebra.

**O que juntar, se a fila precisar de menos lotes.** Os cortes 2 e 3 cabem num lote: 17 KB, 452 pontos, nenhum processo aberto. Já o 4 e o 5 juntos seriam a PR mais arriscada do arquivo, com processo e CDP numa prova real só, e devem ficar separados.

**Depois do corte 5:** o arquivo fica com cerca de 7,5 KB e zero ponto, e as unidades que sobram têm complexidade média perto de 2. Todos os módulos novos nascem com zero ponto, menos de 1.000 linhas e menos de 20.000 bytes.

## 4. As regras que cada corte encontra

- **Linhas de base.** Depois de cada corte, a entrada do arquivo desce nas duas listas de `scripts/regras/linha-de-base.json`: `limite-de-linhas` (1.787) e `saude-do-codigo` (1.584). O comando é `node scripts/regras/verificar.js --atualizar-linha-de-base`.
- **Comentários.** O arquivo tem 41 comentários de código (`comentariosJs` de `scripts/regras/comentarios.js`), e **nenhum** deles fica dentro dos textos de script. Os comentários de dentro do `deepHijackScript` (`// Stealth: …`) são texto: no corte 1 eles vão junto, byte a byte, e a regra não os vê. No corte 6 eles deixam de ser texto e precisam sair, senão viram comentário novo. As PRs #147 e #149, que zeram os comentários do arquivo, estão abertas e competem entre si: as duas criam uma ADR sobre o Y4M, a `0060` numa e a `0064` na outra. A que entrar primeiro limpa o caminho dos cortes.
- **Atenção ALTA.** O arquivo está no grupo `keychain` de `scripts/regras/caminhos-sensiveis.json:6` pelo glob `**/global-spoof-service.js`. Os módulos novos não estão nesse grupo. Os que abrem processo (`global-spoof-chrome.js` e `global-spoof-y4m.js`) entram como ALTA pelo conteúdo, só nas linhas que a PR acrescenta. Os outros sairiam como BAIXA numa PR futura que não toque o serviço.
  - **Recomendação para o dono:** no corte 1, trocar o glob por `**/global-spoof-*.js`, que cobre o serviço e os módulos.
  - O motivo escrito no grupo ("keychain e preferências globais do sistema") hoje só se apoia em dois argumentos do Chrome, `--use-mock-keychain` e `--password-store=basic`. Vale reescrevê-lo como "câmera falsa e disfarce do navegador".
  - É uma mudança em `scripts/regras/`, então a PR já seria ALTA também por isso.
- **Testes que leem o texto do arquivo.** O teste "spoof e pré-escuta…" (`MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs:97-104`) procura no **texto** do `global-spoof-service.js` duas linhas: `const toolPaths = require('./tool-paths');` e `this.ffmpegPath = toolPaths.ffmpeg() || 'ffmpeg';`. As duas ficam no serviço. Se o corte 4 levar o `ffmpegPath` para `global-spoof-y4m.js`, o teste precisa apontar para o módulo novo.
- **Testes que chamam o protótipo.** Os três testes de `app/test/chromium-revisao-windows.test.js:54-70` chamam `_findChrome` num `Object.create(GlobalSpoofService.prototype)` só com `app`. O método precisa continuar no protótipo e funcionar sem `browserFarmService`.

## 5. Para cada corte: testes, caracterização e prova real

### O que os testes de hoje cobrem

Medi com cobertura:

```
node --test --experimental-test-coverage --test-coverage-include='app/electron/services/global-spoof-service.js' app/test/chromium-revisao-windows.test.js MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs
```

O resultado foi **7,33% das linhas e 5,56% das funções**. Só as partes de `_findChrome` para Windows rodam. Os testes que tocam o serviço são:

| Teste | O que confere | Onde roda |
|---|---|---|
| `app/test/chromium-revisao-windows.test.js` (3 testes) | `_findChrome` acha o Chromium empacotado, cai nele quando o navegador pedido não existe, e devolve `null` sem nenhum | em qualquer sistema (finge `win32`); passaram aqui |
| `MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs:97` | o texto do arquivo usa `toolPaths.ffmpeg()` | em qualquer sistema; passou aqui |
| `app/test/paridade-b.test.js:133` | o padrão do `pkill` do Mac só mata o Chrome com o Y4M do `nova_webcam_hijack` (testa `paridade-utils.js`, não o serviço) | só em Unix; no Windows falha com `ENOENT` |
| `scripts/regras/test/registro.test.js:75` | o caminho conta como ALTA | em qualquer sistema |

Nada cobre o perfil, a identidade, o proxy, os argumentos do Chrome, o Y4M, o áudio, o script da página, o CDP, a vigia do e-mail nem o `stopHijack`.

### A caracterização: um palco para o spoof

A caracterização segue o molde de `app/electron/services/test/browser-manager.{palco,cenas,esperado}.js`: um diário gravado em JSON, conferido com `deepStrictEqual` e com a ordem das chaves. Ela vai num commit antes do primeiro corte e passa no código de hoje. O palco precisa fingir estas peças:

- **`child_process`:** `spawn`, `spawnSync` e `execSync` anotam os argumentos. O `spawn` do ffmpeg fecha com código 0 e escreve o Y4M, e o do Chrome devolve um PID fixo.
- **`fs`:** numa pasta temporária, com `listaEmOrdem` e `marcarCaminhos` de `caminhos-do-palco.js`.
- **`os.tmpdir`** e **`app.getPath('userData')`** apontando para essa pasta. **`process.platform`** alternando entre `win32` e `darwin`.
- **`chrome-remote-interface`:** `Version`, `CDP()`, `send`, `Fetch.authRequired`, `Fetch.requestPaused`, `on('Target.attachedToTarget')`, `Runtime.evaluate`, `Browser.grantPermissions`, `Target.setAutoAttach`, `close`. O palco dispara os eventos, anota cada `send` com o `sessionId` e guarda o texto do script pelo sha256 e pelo tamanho.
- **O sorteio e o relógio fixos:** `Math.random`, `crypto.randomBytes`, `crypto.randomUUID` e `Date.now`, e também a data que o `getTimezoneOffset` interno usa.
- **Um `mainWindow`** que anota cada `webContents.send`, e um `browserFarmService` de mentira com `profiles`, `_saveProfiles`, `getOptimalGeoDetails` e os quatro `get*ExecutablePath`. Há cenas com ele e sem ele.

As cenas, que valem para todos os cortes:

- **Perfil:**
  - `Default` sem `regional` (hoje lança `TypeError`, ver a seção 7) e `Default` com o `regional` que a interface manda;
  - nome livre, com e sem farm, com e sem `farm_profiles.json`, com IDs `profile_07` e lixo na lista;
  - `profile_NN` completo e com campos faltando (o arquivo é regravado);
  - perfil temporário de `desktop`, de Android e de `iphone`.
- **Identidade:**
  - "ótimo" com e sem farm, e o farm devolvendo `null`;
  - `locationMode` `custom` com latitude `0`;
  - fuso inválido (`getTimezoneOffset` devolve 0);
  - idioma com e sem `-`.
- **Proxy:** `user:pass@host:port`, `user@host:port`, `host:port:user:pass`, `host:port`, `host` e vazio.
- **Janela:** `412x915`, `abc`, `Based on User-Agent` e `1920x1080` com `windowMode` maximizado, para cobrir o `--start-maximized`.
- **Áudio:** com `audioPath`, sem ele com o WAV já existindo e sem ele com o WAV ainda não existindo; em `win32` e em `darwin`.
- **Clipe:** sem buffer, com falha ao gravar e com o ffmpeg saindo com código 1.
- **CDP:**
  - alvo `page`, `iframe` e `service_worker`, com e sem `waitingForDebugger` e com e sem proxy com senha;
  - `send` que falha no meio;
  - `disconnect`, que chama o `stopHijack`;
  - a vigia do e-mail achando um e-mail, com o farm e direto no arquivo, e achando o mesmo e-mail de novo (não grava).
- **Parar:** `stopHijack` parado e depois de iniciar.
- **Navegador:** `_findChrome` para os quatro navegadores, com e sem farm, nos dois sistemas.

O diário de cada cena grava:

- o que o `startHijack` e o `stopHijack` devolvem;
- os argumentos de cada processo;
- os arquivos gravados (`farm_profiles.json` inteiro, `manifest.json` inteiro, `inject.js` pelo sha256 e pelo tamanho);
- cada envio do CDP e cada envio de IPC;
- o estado final (`getStatus` e `isHijacking`).

**Cada corte adiciona as cenas da parte que ele mexe**, antes de mexer. O palco acima é o do corte 1. Os outros cortes acrescentam cenas sem regravar as anteriores, e o diário antigo tem de passar igual.

### O roteiro da prova no Chrome de verdade (sem aparelho)

Rodei este roteiro no código de hoje, no Windows desta máquina, com Chrome 157.0.8103.80 e ffmpeg 8.1. O script fica fora do repositório (`harness/prova-atual.js`); a versão do lote vai junto do palco.

1. Gerar um clipe WebM de 0,5 s com o ffmpeg (`testsrc`). Instanciar o serviço com um `app` cujo `userData` é uma pasta temporária, um `mainWindow` que anota e `browserFarmService = null`.
2. `detectDriver` → `{ mode: 'chrome-y4m', vcamExePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }`.
3. `startHijack` com o perfil `Default` e sem `regional` → **lança** `Cannot read properties of undefined (reading 'includes')`.
4. Gravar um `profile_01` (Windows, `America/Sao_Paulo`, `pt-BR`, local personalizado) e chamar `startHijack` com o `regional` que a interface manda.
   - O resultado foi `success: true` em cerca de 1,7 s.
   - Saíram 23 argumentos do Chrome, a extensão e `--remote-debugging-port`.
   - O Y4M saiu com 1080×1920 a 29,97 quadros por segundo e **112 MB para 0,5 s** de clipe.
   - O `inject.js` saiu com 22.874 a 22.890 bytes, conforme os valores sorteados.
5. Pelo CDP, na página `http://127.0.0.1:<porta>/`, primeiro conferir se o script chegou (`window.__nova_stealth_applied`). Depois recarregar, conferir de novo e ler:

   | Item | Valor lido |
   |---|---|
   | `navigator.platform` | `Win32` |
   | núcleos e memória | 8 e 8 |
   | idiomas | `pt-BR, pt, en-US, en` |
   | fuso | `America/Sao_Paulo` |
   | deslocamento | 180 |
   | GPU | `Google Inc. (NVIDIA)` / `Intel(R) Iris(R) Xe Graphics` |
   | `enumerateDevices` | `videoinput:USB Camera` |
   | trilha do `getUserMedia` | rótulo `FaceTime HD Camera`, 1920×1080, `facingMode` `user` |

   Depois, para cada uma das 25 funções que o script troca, ler o nome, a aridade e o começo do `toString`.
6. `stopHijack` → `success: true`. O Y4M foi apagado e o status saiu com `isActive: false`. O Chrome **ainda estava vivo 6 s depois** em 2 de 4 execuções (esperando 2,5 s ou 6 s) e saiu sozinho segundos depois. A prova precisa esperar a saída do processo, e não um tempo fixo.

Este roteiro roda sem aparelho e sem o app. Ele prova o serviço com o Chrome real, mas não prova a interface nem o caminho do IPC, que ficam para o app (abaixo).

### Por corte

| Corte | Teste de hoje que cobre | Caracterização que falta | Prova real sem aparelho (agente) | Prova que pede o dono |
|---|---|---|---|---|
| 1. o texto da página | nenhum | as cenas de perfil, identidade e mídia do palco, com o sha256 do `inject.js` e do texto mandado ao CDP | o palco igual antes e depois. No Chrome real, o mesmo sha256 do `inject.js` com o sorteio fixo, e a tabela de leituras do passo 5 igual | no Mac, no app instalado: abrir o CAM spoof com um perfil `profile_NN`, ver a câmera falsa num site de teste de webcam e o fuso do perfil |
| 2. o perfil | nenhum | as cenas de perfil (nome livre, `profile_NN` com campos faltando, temporário de três plataformas, `Default`), com o `farm_profiles.json` inteiro no diário e o sorteio fixo | o palco igual. No Chrome real, criar um perfil de nome livre pelo `startHijack` e conferir o `farm_profiles.json` e a leitura na página | no app: o seletor de perfis do CAM spoof lista os mesmos perfis (`listProfiles`), e criar um perfil de nome livre aparece no farm |
| 3. a identidade | nenhum | as cenas de "ótimo" com o farm de mentira, local personalizado, fuso inválido e os seis formatos de proxy; no diário, os argumentos `--proxy-server` e `--window-size` e os envios `setTimezoneOverride`, `setGeolocationOverride` e `setUserAgentOverride` | o palco igual. No Chrome real, dois perfis (Windows e Android, que é emulado), com a tabela do passo 5 igual antes e depois | no app, um perfil com proxy autenticado: a página abre pelo proxy (pede um proxy do dono) |
| 4. o Chrome | `chromium-revisao-windows.test.js` (3) e `tool-paths.test.cjs` (texto) | as cenas de `_findChrome` (quatro navegadores, com e sem farm, Windows e Mac), da limpeza (`pkill` no Mac; `wmic` que falha e depois PowerShell no Windows), do áudio nos dois sistemas e do ffmpeg que falha | o palco igual. No Chrome real, o roteiro inteiro, conferindo os 23 argumentos e o cabeçalho do Y4M iguais, e o Chrome morrendo no `stopHijack` | **no Mac**: abrir e fechar o CAM spoof duas vezes, ver o `pkill` matar o Chrome órfão e não um Chrome pessoal aberto (o ramo `darwin` só roda lá); o áudio de ambiente com e sem arquivo escolhido |
| 5. o CDP | nenhum | as cenas do CDP (alvos `page`, `iframe` e outros, `waitingForDebugger`, proxy com senha, `send` que falha, `disconnect`, vigia do e-mail com o farm e direto no arquivo) | o palco igual. No Chrome real, a tabela do passo 5 depois de recarregar, a vigia do e-mail numa página local com `data-email` (grava no `farm_profiles.json` em até 5 s) e o fechamento do Chrome parando o serviço | no app: logar numa conta Google no Chrome do spoof e ver o e-mail aparecer no cartão do perfil do farm (`farm:profile-update`) |
| 6. o script como código | nenhum | a tabela das 25 funções trocadas na página (nome, aridade, mascaramento de `toString`) e as leituras do passo 5, gravadas no código de hoje e conferidas no Chrome real | no Chrome real, as leituras iguais. O nome, a aridade e o mascaramento iguais para as 25 funções, com o texto-fonte mudando se o dono aceitar (D39). Também os valores de ruído do canvas, do WebGL e do áudio com semente fixa | no Mac, no app: um site de detecção de impressão digital mostra os mesmos valores antes e depois |

O que pede o dono é o Mac com o app instalado (`/Applications/Nova AI Mac.app`), a conta Google e um proxy. **Nenhum corte pede iPhone nem Android**: os perfis de celular são só o Chrome emulando um celular. As máquinas Windows da frota também servem para o agente repetir o roteiro.

## 6. A decisão que espera o dono (D39)

O script que vai para a página só chega a 10 se for reescrito como código de verdade. Reescrevê-lo muda o texto que a página lê quando chama `toString` em 19 das 25 funções trocadas, porque hoje só `enumerateDevices`, `getUserMedia`, `fetch` e `open` se disfarçam de nativas. Medi isso no Chrome real (passo 5).

Por exemplo, `WebGLRenderingContext.prototype.readPixels` hoje tem nome vazio, aridade 7 e mostra `function(x, y, w, h, format, type, pixels) {…`. O nome, a aridade, os valores devolvidos e o mascaramento das quatro funções dá para manter iguais e provar. Já o texto-fonte que vaza não dá.

Os sete argumentos do `readPixels` são a aridade do método nativo e precisam continuar 7: o corte declara `...argumentos` e fixa `length` em 7, e não deixa a aridade mudar.

As três saídas:

- **A. Mover byte a byte e parar aí.** O comportamento fica idêntico, mas os dois módulos do script ficam abaixo de 10.
- **B. Reescrever no corte 6.** Mantém o nome, a aridade, os valores e o mascaramento, e aceita a mudança do texto-fonte que vaza. **É a recomendação**: esse texto não é contrato de ninguém, já vaza hoje e não é o que o disfarce promete.
- **C. Pôr o script num arquivo que o painel não lê (`.txt`).** Descartada: contraria "nada sai do painel só para subir a nota".

Os cortes 1 a 5 não dependem desta resposta.

## 7. Achados à parte (para consertos fora dos cortes)

Os cortes mantêm tudo isto igual, e a caracterização congela cada item como está. Cada um vira conserto de bug numa PR própria, que o mapa permite.

1. **O perfil `Default` derruba o `startHijack`.** Com `profile: 'Default'`, o perfil temporário não tem `locale` nem `timezone`. A linha 421 põe `tLocale = undefined` e a linha 445 lança `TypeError: Cannot read properties of undefined (reading 'includes')`. O `regional` não salva, porque o perfil o sobrescreve nas linhas 410 e 421. O IPC devolve o erro para a interface. Reproduzido no passo 3 do roteiro. O `Default` é o primeiro item de `listProfiles`.
2. **O Chrome 157 ignora `--load-extension`.** Testei com uma extensão mínima, que escreve `window.__extensaoRodou = true`, carregada como o serviço carrega a dele: a variável ficou `undefined`. Por isso o disfarce só chega pela via do CDP (`addScriptToEvaluateOnNewDocument` no auto-attach). Essa via corre contra a primeira página, que o Chrome já abre pela linha de comando: em 3 de 4 execuções a primeira carga ficou **sem disfarce**. Numa delas, o rótulo da câmera era o caminho `C:\Users\…\nova_webcam_hijack\fake_cam.y4m` e a GPU não estava trocada. Depois de recarregar, o disfarce estava lá nas três. Isso também torna a prova não determinística: ela tem de ler a página depois de uma navegação feita com o CDP já ligado. Não achei a nota oficial do Chromium sobre a retirada do argumento; o comportamento foi medido aqui.
3. **A limpeza de órfãos no Windows não funciona.** O `wmic` falhou e o PowerShell de reserva também, porque as aspas duplas do filtro estão dentro de um `-Command "…"` também entre aspas duplas (linhas 199-200). O log diz "Failed to run Chrome cleanup" a cada abertura.
4. **O rótulo da câmera não bate.** O `enumerateDevices` mostra o `virtualCamLabel` do perfil (por exemplo, `USB Camera`), e a trilha do `getUserMedia` mostra o rótulo fixo `FaceTime HD Camera` (`iPhone Front Camera` no iPhone, linhas 706-707).
5. **A proteção contra varredura de portas fica desligada por padrão.** O padrão `'enable'` (linha 615) só vale sem perfil ativo, e sempre há perfil ativo (no mínimo o temporário). Um perfil sem `portScanProtection` manda `"undefined"`, e o `fetch` para `localhost` passa.
6. **O áudio.** Sem `audioPath`, `settings.audioPath.replace` (linha 580) lança, o erro é engolido, e nada toca, nem o `afplay` do Mac. O WAV de ambiente é gerado sem esperar o fim (linha 571), então na primeira abertura o Chrome fica sem o áudio falso. O `stopHijack` chama `taskkill` também no Mac (linha 1492), onde o comando não existe; o efeito no Mac não foi conferido.

Uma observação de custo: o Y4M tem cerca de 112 MB por meio segundo de clipe. O `setpts` com `RTCTIME` duplica quadros. Com o disco apertado, isso pesa na prova real e nas máquinas do dono.

## Fontes

- **O código.** `app/electron/services/global-spoof-service.js`, `browserFarmService.js`, `virtual-cam-injector.js`, `mac-native.js` e `app/electron/main.js:1326-1420`, no commit `1b45c3f`. Também `app/dist/assets/index-Dun7lr2S.js` (o payload do `hijack`).
- **As regras.** `scripts/regras/analisador/medir-js.js` e `pontos.js` (a catraca), `scripts/regras/linha-de-base.json:5,23`, `scripts/regras/caminhos-sensiveis.json:6`, `scripts/regras/comentarios.js` (`comentariosJs`), `CONTRIBUTING.md`, `AGENTS.md`.
- **O painel (projeto 2, análise 141, revisão `1b45c3f4507fb1acea82c12e7898adfe2a72b60e`).** As rotas `/api/v2/projects/2/analyses/latest`, `/analyses/latest/files` e `/analyses/141/technical-debt`, e o arquivo `code_health_details/c85f26393484b10ab8c6cf045ffa138af706d156.json` da pasta da análise no container `opencleancode`, lido pelo SSH. O token foi lido do arquivo local e não aparece aqui.
- **CodeScene.**
  - [Code Health – How it works](https://codescene.io/docs/guides/technical/code-health.html), que aponta para os limites;
  - [What Are the Default Threshold Values for Different Programming Languages?](https://helpcenter.codescene.com/articles/6084507-what-are-the-default-threshold-values-for-different-programming-languages);
  - [default-rules.zip](https://codescene.com/hubfs/Technical%20Support%20Data/default-rules.zip), arquivo `code-health-rules.js.json`.
- **Testes.** `app/test/chromium-revisao-windows.test.js`, `app/test/paridade-b.test.js`, `MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs`, `scripts/regras/test/registro.test.js` e o molde de palco em `app/electron/services/test/browser-manager.*`.
- **A pesquisa irmã.** [O corte do browserFarmService.js](https://github.com/vinicius928e8r84/Nova-AI/issues/129), comentário de resolução.
- **As execuções.** Node 24.15.0, Chrome 157.0.8103.80, ffmpeg 8.1 e `chrome-remote-interface` 0.34.0 (instalado numa pasta temporária fora do repositório), no Windows 11.
