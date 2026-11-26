# Como o arquivo é hoje e as regras que os cortes encontram

Parte da pesquisa [O corte do `global-spoof-service.js`](README.md).

## 1. Como o arquivo é hoje

### Os números

| Medida | Valor | Fonte |
|---|---|---|
| Linhas | 1.787 | `wc -l`; linha de base do `limite-de-linhas` (`scripts/regras/linha-de-base.json:5`) |
| Bytes no git (LF) | **79.789** | `git cat-file -s HEAD:app/electron/services/global-spoof-service.js` |
| Bytes no Windows (CRLF) | 81.576 | o número da issue; a diferença de 1.787 bytes são os `\r` do checkout com `core.autocrlf=true` |
| Pontos na catraca | 1.584 | `scripts/regras/linha-de-base.json:23`; medido de novo com `medirJs` e `pontuar` de `scripts/regras/analisador/` |
| Nota no painel | 3,15 (3,1514) | servidor antigo da VPS, análise 141 de 23/11; não consultado de novo |
| Nota na nuvem | ainda não existe | a Nova-AI não tem projeto no CodeScene da nuvem (seção 8, no [README](README.md)) |
| Linhas de código que o painel conta | 1.562 | servidor antigo, análise 141 |
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

Esta subseção é da primeira rodada (23/11) e vem do servidor antigo, que esta rodada não consultou. A nuvem ainda precisa confirmar que pontua o script de dentro do texto do mesmo jeito (seção 8, no [README](README.md)). O desenho dos cortes não depende disso: o corte 6 entra por decisão do dono, e ele também tira a geolocalização duplicada e os `readPixels` de 7 argumentos, que qualquer leitura como código acusaria.

O arquivo de detalhes da análise 141 lista as funções com achados. Dos achados, estes caem **dentro do texto** `deepHijackScript`, que vai das linhas 616 a 1171:

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

## 4. As regras que cada corte encontra

- **Linhas de base.** Depois de cada corte, a entrada do arquivo desce nas duas listas de `scripts/regras/linha-de-base.json`: `limite-de-linhas` (1.787) e `saude-do-codigo` (1.584). O comando é `node scripts/regras/verificar.js --atualizar-linha-de-base`.
- **Comentários.** O arquivo tem 41 comentários de código (`comentariosJs` de `scripts/regras/comentarios.js`), e **nenhum** deles fica dentro dos textos de script. Os comentários de dentro do `deepHijackScript` (`// Stealth: …`) são texto: no corte 1 eles vão junto, byte a byte, e a regra não os vê. No corte 6 eles deixam de ser texto e precisam sair, senão viram comentário novo. As PRs #147 e #149, que zeram os comentários do arquivo, estão abertas e competem entre si: as duas criam uma ADR sobre o Y4M, a `0060` numa e a `0064` na outra. A que entrar primeiro limpa o caminho dos cortes.
- **Atenção ALTA.** O arquivo está no grupo `keychain` de `scripts/regras/caminhos-sensiveis.json:6` pelo glob `**/global-spoof-service.js`. Os módulos novos não estão nesse grupo. Os que abrem processo (`global-spoof-chrome.js` e `global-spoof-y4m.js`) entram como ALTA pelo conteúdo, só nas linhas que a PR acrescenta. Os outros sairiam como BAIXA numa PR futura que não toque o serviço.
  - **Recomendação para o dono:** no corte 1, trocar o glob por `**/global-spoof-*.js`, que cobre o serviço e os módulos.
  - O motivo escrito no grupo ("keychain e preferências globais do sistema") hoje só se apoia em dois argumentos do Chrome, `--use-mock-keychain` e `--password-store=basic`. Vale reescrevê-lo como "câmera falsa e disfarce do navegador".
  - É uma mudança em `scripts/regras/`, então a PR já seria ALTA também por isso.
- **Testes que leem o texto do arquivo.** O teste "spoof e pré-escuta…" (`MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs:97-104`) procura no **texto** do `global-spoof-service.js` duas linhas: `const toolPaths = require('./tool-paths');` e `this.ffmpegPath = toolPaths.ffmpeg() || 'ffmpeg';`. As duas ficam no serviço. Se o corte 4 levar o `ffmpegPath` para `global-spoof-y4m.js`, o teste precisa apontar para o módulo novo.
- **Testes que chamam o protótipo.** Os três testes de `app/test/chromium-revisao-windows.test.js:54-70` chamam `_findChrome` num `Object.create(GlobalSpoofService.prototype)` só com `app`. O método precisa continuar no protótipo e funcionar sem `browserFarmService`.
