# O corte do `global-spoof-service.js`

Esta é a pesquisa do ticket [Pesquisa: o corte do global-spoof-service.js](https://github.com/vinicius928e8r84/Nova-AI/issues/128), que faz parte do mapa [Nova-AI na nota 10 no CodeScene: o plano, com a fila de lotes e as regras que seguram](https://github.com/vinicius928e8r84/Nova-AI/issues/120). A irmã dela é a pesquisa [do browserFarmService.js](https://github.com/vinicius928e8r84/Nova-AI/issues/129), e as duas dividem código.

A primeira rodada foi conferida na `main` em `1b45c3f` (23/11). Esta segunda rodada (25/11) conferiu de novo na `main` em `f87f6ea`: o arquivo não mudou entre os dois commits (mesmos 79.789 bytes, nenhum commit nele), então os números de linha citados valem para os dois. A segunda rodada acrescenta, para cada corte, **o teste que julga** e **a quebra de propósito** que esse teste tem de pegar (seção 5), e registra a resposta do dono sobre o corte 6 (seção 6). As PRs #147 e #149, que tiram os comentários do arquivo, deslocam as linhas em cerca de 45, mas não mexem no texto do script injetado. Esta pesquisa não muda código de produto.

**De onde vem a nota.** A nota que vale para o mapa é a do CodeScene da nuvem, e **a Nova-AI ainda não tem projeto lá**: as PRs #161 a #166 só têm o check do servidor antigo da VPS, e não há token da nuvem. Os números de nota e os achados do painel citados aqui foram lidos em 23/11 no servidor antigo e não foram consultados de novo. Ler a nota da nuvem e conferir se a nuvem também pontua o script de dentro do texto fica para um ticket próprio (seção 8).

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

- O sexto corte não muda a catraca, mas é o que leva a 10 os dois módulos do script da página. **O servidor antigo leu como código o script que vai dentro do texto**: 5 dos 8 tipos de achado que ele apontou no arquivo estão dentro desse texto. Por isso movê-lo byte a byte não basta para a nota 10, e reescrevê-lo muda o código-fonte que a página consegue ler. **O dono decidiu (23/11) que o corte 6 entra**: o texto-fonte que a página vê pelo `toString` pode mudar; o nome, a aridade, os valores e o mascaramento das quatro funções que já se disfarçam ficam iguais e provados no Chrome real (seção 6).
- **O juiz de cada corte é a caracterização nova** (`app/electron/services/test/global-spoof-service.test.js`, com palco, cenas e diário), que a CI já roda pelo glob `app/electron/services/test*/**/*.test.js`. Os testes de hoje não servem de juiz: quebrei de propósito o script da página, as marcas de câmera do perfil, o argumento do Y4M e o envio do script pelo CDP, e os testes continuaram com o mesmo resultado. Só o `_findChrome` e a linha do `ffmpegPath` têm teste que pega ([juiz-e-caracterizacao.md](juiz-e-caracterizacao.md)).
- **Os testes de hoje cobrem 7,33% das linhas** do arquivo, e só a busca do navegador. A caracterização precisa de um palco novo, no molde `palco`/`cenas`/`esperado` que o repositório já usa, e de um roteiro no Chrome de verdade.
- **Nenhum corte pede iPhone nem Android.** Os perfis de celular são só emulados no Chrome. O agente prova no Windows, com o Chrome real (feito aqui, ver [prova-real.md](prova-real.md)). O dono prova os ramos do Mac (`pkill`, `mac-native`, `afplay`) no app instalado.
- Na execução real apareceram **seis defeitos** que os cortes precisam manter como estão e que pedem consertos à parte (seção 7, em [achados-e-fontes.md](achados-e-fontes.md)). Dois deles são graves:
  - escolher o perfil `Default` faz o `startHijack` cair com `TypeError`;
  - o Chrome 157 ignora `--load-extension`, e por isso o script de disfarce às vezes não chega à primeira página.


## Os outros arquivos desta pesquisa

- [Como o arquivo é hoje e as regras que os cortes encontram](o-arquivo-hoje.md): seções 1 e 4.
- [O juiz, a caracterização e a quebra de propósito de cada corte](juiz-e-caracterizacao.md): a primeira metade da seção 5.
- [A prova real de cada corte](prova-real.md): a segunda metade da seção 5.
- [Os defeitos achados e as fontes](achados-e-fontes.md): a seção 7 e as fontes.

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
| `global-spoof-chrome.js` | o Chrome: matar os órfãos (`pkill` no Mac; PowerShell com `Get-CimInstance` no Windows), a tabela navegador → caminhos (o `_findChrome` sem as duas cópias da lista), os argumentos, o áudio, o `spawn` e o `taskkill` do fim | 4 | 9,5 KB |
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
| 6 | **o script da página como código** | os dois módulos `global-spoof-pagina-*.js` deixam de ser texto e viram funções serializadas (`String(funcao)` mais os valores em JSON). Somem `overrideGUM`, `enumerateDevices`, os `readPixels` de 7 argumentos, a condição do `toString` e a geolocalização duplicada | 0 na catraca | 0 | ALTA; entra por decisão do dono (seção 6) |

**A ordem.**

- **O corte 1 vem primeiro** porque é o maior e o mais seguro. Ele tira 33% dos bytes e 41% dos pontos sem mudar um byte do que vai para o Chrome, e a prova é mecânica: o mesmo sha256.
- **Os cortes 2 e 3** só mexem em dados e não abrem processo.
- **O corte 4 vem antes do 5** porque o CDP precisa da porta e do processo que o 4 organiza.
- **O corte 6 vem por último**, porque é o único que muda o texto que vai para a página. Antes dele, o texto chega à página igual, byte a byte.

**Com o farm.** O corte 2 daqui usa o `farm-perfil.js` do corte 1 do farm, e o corte 5 usa o `farm-scripts-da-pagina.js` do corte 2 do farm. Se os do farm vierem antes, o spoof só importa. Se os daqui vierem antes, o corte daqui cria o módulo compartilhado com só aquela função, e o farm o completa depois. Isso é preferência, não trava. O corte 3 daqui usa o `getOptimalGeoDetails` do farm, que a #129 move no corte 4 de lá: o método continua no objeto do farm, então nada quebra.

**O que juntar, se a fila precisar de menos lotes.** Os cortes 2 e 3 cabem num lote: 17 KB, 452 pontos, nenhum processo aberto. Já o 4 e o 5 juntos seriam a PR mais arriscada do arquivo, com processo e CDP numa prova real só, e devem ficar separados.

**Depois do corte 5:** o arquivo fica com cerca de 7,5 KB e zero ponto, e as unidades que sobram têm complexidade média perto de 2. Todos os módulos novos nascem com zero ponto, menos de 1.000 linhas e menos de 20.000 bytes.

## 6. A decisão do dono sobre o corte 6

**Respondida em 23/11:** o corte 6 entra. O texto-fonte que a página vê pelo `toString` pode mudar; o nome, a aridade, os valores e o mascaramento das quatro funções que já se disfarçam ficam iguais e provados no Chrome real. É a saída B abaixo, que era a recomendação. O resto desta seção é o contexto da pergunta.

O script que vai para a página só chega a 10 se for reescrito como código de verdade. Reescrevê-lo muda o texto que a página lê quando chama `toString` em 19 das 25 funções trocadas, porque hoje só `enumerateDevices`, `getUserMedia`, `fetch` e `open` se disfarçam de nativas. Medi isso no Chrome real (passo 5).

Por exemplo, `WebGLRenderingContext.prototype.readPixels` hoje tem nome vazio, aridade 7 e mostra `function(x, y, w, h, format, type, pixels) {…`. O nome, a aridade, os valores devolvidos e o mascaramento das quatro funções dá para manter iguais e provar. Já o texto-fonte que vaza não dá.

Os sete argumentos do `readPixels` são a aridade do método nativo e precisam continuar 7: o corte declara `...argumentos` e fixa `length` em 7, e não deixa a aridade mudar.

As três saídas:

- **A. Mover byte a byte e parar aí.** O comportamento fica idêntico, mas os dois módulos do script ficam abaixo de 10.
- **B. Reescrever no corte 6.** Mantém o nome, a aridade, os valores e o mascaramento, e aceita a mudança do texto-fonte que vaza. **É a recomendação**: esse texto não é contrato de ninguém, já vaza hoje e não é o que o disfarce promete.
- **C. Pôr o script num arquivo que o painel não lê (`.txt`).** Descartada: contraria "nada sai do painel só para subir a nota".

Os cortes 1 a 5 não dependiam desta resposta.

## 8. O que fica para outros tickets

- **A nota da nuvem.** Quando a Nova-AI tiver projeto no CodeScene da nuvem, a nota do `global-spoof-service.js` sai da [Tarefa: a lista oficial do painel, arquivo por arquivo](https://github.com/vinicius928e8r84/Nova-AI/issues/125). Se a nuvem também lê como código o script de dentro do texto, é um caso da [Pesquisa: no que a catraca do repositório e o painel discordam](https://github.com/vinicius928e8r84/Nova-AI/issues/126): o script tem zero ponto na catraca e achados no servidor antigo. A resposta não muda os cortes, porque o corte 6 entra de qualquer jeito.
- **A fila.** Os seis cortes entram na [A fila dos lotes até a nota 10](https://github.com/vinicius928e8r84/Nova-AI/issues/139), um por lote, em série, todos de atenção ALTA. A caracterização (palco, cenas, diário e o teste do `vm`) vai num commit antes do corte 1, no mesmo lote.
