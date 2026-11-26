# No que a catraca do repositório e o painel discordam

Pesquisa do ticket [Pesquisa: no que a catraca do repositório e o painel discordam](https://github.com/vinicius928e8r84/Nova-AI/issues/126), do mapa [Nova-AI na nota 10 no CodeScene: o plano, com a fila de lotes e as regras que seguram](https://github.com/vinicius928e8r84/Nova-AI/issues/120). Feita em 26/11/2026 sobre a `main` em `96ea7ce`.

- **Painel:** disparei uma análise nova no projeto 2 para cair no mesmo commit da `main` (a 157 era de `7d094ae`, e a #152 entrou depois). É a **análise 160**, de 26/11 20:40 UTC, sobre `96ea7ce`. A nota sai de `GET /api/v2/projects/2/analyses/160/files`; a função, a linha e a medida de cada achado saem de `code_health_details/` da pasta da análise, lida com `docker exec opencleancode`.
- **Catraca:** medi de novo todos os arquivos que a regra `saude-do-codigo` cobre (265 arquivos `.js`, `.mjs`, `.cjs` e `.py`), com o mesmo medidor e os mesmos limites da regra (`scripts/regras/analisador/`). 52 arquivos têm pontos, 8.955 no total. A linha de base versionada (`scripts/regras/linha-de-base.json`) ainda lista 54 arquivos e 9.438 pontos: ela só desce quando alguém a atualiza, e 16 entradas estão acima do que o código tem hoje.
- "Pontos na catraca" abaixo é a medição de hoje. Quando a linha de base diz outra coisa, a coluna "Linha de base" mostra.

## A resposta curta

| | Arquivos |
| --- | --- |
| Abaixo de 10 no painel | 51 |
| ... e com pontos na catraca | 40 |
| ... e **sem** pontos na catraca (lista 1) | 11: dez `.m` e o `rtmp-server.js` |
| Em 10 no painel e com pontos na catraca (lista 2) | 6 medidos, mais 2 que só a linha de base velha ainda carrega |
| Com pontos na catraca e sem nota no painel | 6 |

- **Só o painel vê** dez arquivos em Objective-C, porque a catraca não mede `.m`, e um em JavaScript, `rtmp-server.js` (9,68), porque as duas contam a complexidade da mesma função de jeitos diferentes.
- **Só a catraca vê** seis arquivos em 10: ela cobra o código solto no topo do arquivo (scripts e testes de ponta a ponta) e a média de complexidade exatamente igual a 4,0, que o painel tolera.
- **Nos 40 arquivos que as duas veem**, a catraca aponta a mesma função em 314 dos 407 achados de função do painel (77%). Outros 47 caem dentro de uma função maior que a catraca já aponta; 10 a catraca não vê; e 36 são duplicação de código, que a catraca não mede.
- **O item de lote começa pela tela do arquivo no painel.** A catraca serve de conferência rápida durante o corte, mas zerar os pontos dela não leva o arquivo a 10. Detalhe em "Dá para guiar um item de lote pela catraca?".
- **O script injetado do `global-spoof-service.js` o painel lê como código** (10 achados dentro do texto); o do `browserFarmService.js`, não.

## Lista 1: abaixo de 10 no painel e sem pontos na catraca

O que o painel aponta é a função, a linha de início e a medida, lidas em `code_health_details/` da análise 160. Os nomes das regras são os do painel.

| # | Nota | Linhas | Pontos na catraca | Arquivo | O que o painel aponta |
| --- | --- | --- | --- | --- | --- |
| 1 | 5,69 | 287 | não mede `.m` | `MAC/integracao-iphone/idioma-iphone/novalanguage/main.m` | `main` linha 221: Complex Method cc 57; `ReadState` linha 169: Complex Method cc 26; `ScanOverrides` linha 44: Complex Method cc 24; `PrintJSON` linha 140: Complex Method cc 9; `main` linha 221: Large Method 119 linhas; `main` linha 221: Bumpy Road 7 lombadas; `ScanOverrides` linha 44: Bumpy Road 4 lombadas; `ReadState` linha 169: Bumpy Road 2 lombadas; `main` linha 221: Deep, Nested Complexity nível 5; `ScanOverrides` linha 44: Deep, Nested Complexity nível 4; `main` linha 308: Complex Conditional |
| 2 | 6,54 | 223 | não mede `.m` | `MAC/proxy-iphone/tool/Upstream.m` | `socks4_connect` linha 89: Complex Method cc 23; `http_connect` linha 163: Complex Method cc 13; `tcp_connect` linha 43: Complex Method cc 13; `upstream_connect` linha 220: Complex Method cc 9; `socks4_connect` linha 89: Bumpy Road 4 lombadas; `socks4_connect` linha 89: Deep, Nested Complexity nível 4; `tcp_connect` linha 43: Excess Number of Function Arguments 5 argumentos; `socks4_connect` linha 89: Excess Number of Function Arguments 8 argumentos; `http_connect` linha 163: Excess Number of Function Arguments 8 argumentos; `upstream_connect` linha 220: Excess Number of Function Arguments 9 argumentos |
| 3 | 7,47 | 199 | não mede `.m` | `MAC/proxy-iphone/tool/Forwarder.m` | `handle_client` linha 70: Complex Method cc 36; `run_forwarder` linha 176: Complex Method cc 17; `relay` linha 33: Complex Method cc 12; `handle_client` linha 70: Large Method 95 linhas; `handle_client` linha 70: Bumpy Road 5 lombadas; `relay` linha 33: Bumpy Road 3 lombadas; `split_host_port` linha 55: Excess Number of Function Arguments 5 argumentos |
| 4 | 8,33 | 143 | não mede `.m` | `MAC/proxy-iphone/tool/SysProxy.m` | `SysProxyApply` linha 58: Complex Method cc 17; `SysProxyClear` linha 111: Complex Method cc 14; `SysProxyApply` linha 58: Bumpy Road 5 lombadas; `SysProxyClear` linha 111: Bumpy Road 4 lombadas; `commit` linha 42: Bumpy Road 3 lombadas; `SysProxyApply` linha 100: Complex Conditional |
| 5 | 8,34 | 168 | não mede `.m` | `MAC/proxy-iphone/tool/teste/upstream_test.m` | `main` linha 99: Complex Method cc 27; `socks4_server` linha 66: Complex Method cc 10; `http_server` linha 39: Complex Method cc 10; `main` linha 99: Large Method 81 linhas; `main` linha 99: Bumpy Road 3 lombadas; `http_server` linha 39: Bumpy Road 2 lombadas; `main` linha 157: Complex Conditional |
| 6 | 8,45 | 128 | não mede `.m` | `MAC/proxy-iphone/tool/ProxyConfig.m` | `ProxyConfig.parse:error` linha 49: Complex Method cc 25; `ProxyConfig.load` linha 116: Complex Method cc 12; `ProxyConfig.parse:error` linha 49: Bumpy Road 6 lombadas; `ProxyConfig.parse:error` linha 56: Complex Conditional |
| 7 | 8,63 | 212 | não mede `.m` | `MAC/proxy-iphone/tool/main.m` | `main` linha 212: Complex Method cc 14; `cmd_set` linha 99: Complex Method cc 10; `main` linha 212: Bumpy Road 2 lombadas |
| 8 | 8,63 | 144 | não mede `.m` | `MAC/proxy-iphone/tool/Socks5.m` | `socks5_connect` linha 60: Complex Method cc 35; `socks5_connect` linha 60: Large Method 91 linhas; `socks5_connect` linha 60: Bumpy Road 4 lombadas; `socks5_connect` linha 60: Excess Number of Function Arguments 8 argumentos; `socks5_connect` linha 113: Complex Conditional |
| 9 | 9,38 | 92 | não mede `.m` | `MAC/integracao-modelo/main.m` | Many Conditionals |
| 10 | 9,38 | 63 | não mede `.m` | `MAC/proxy-iphone/tool/teste/parse_test.m` | `check` linha 8: Complex Method cc 9; `check` linha 8: Excess Number of Function Arguments 6 argumentos |
| 11 | 9,68 | 126 | 0 (medido) | `app/electron/services/rtmp-server.js` | `stopBroadcast` linha 92: Complex Method cc 9 |

**Por que a catraca não vê:**

- **Os dez `.m`.** A regra só mede `.js`, `.mjs`, `.cjs` e `.py` (`scripts/regras/regra-saude.js`, `EXTENSOES`). É a lacuna que o ticket já esperava; os `.x` e `.h` ficam fora das duas.
- **O `rtmp-server.js`.** O painel conta `stopBroadcast` (linha 92) com complexidade 9. A catraca conta 8, no limite, porque tira dela a função `const cleanup = () => {...}` (linha 105), que mede à parte com 2. O painel soma a função interna com nome na função de fora. As duas usam o mesmo limite (a catraca deixa até 8, o painel aponta a partir de 9); o que muda é onde a função interna conta.

## Lista 2: com pontos na catraca e já em 10 no painel

| # | Nota | Linhas | Pontos medidos | Linha de base | Arquivo | Onde estão os pontos |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 10,00 | 43 | 15 | 15 | `MAC/integracao-camlive/test/rtmp-audio-e2e.js` | (topo do arquivo): complexidade 21 (limite 8); (topo do arquivo): blocos aninhados 3 (limite 1) |
| 2 | 10,00 | 46 | 10 | 10 | `MAC/integracao-camlive/test/rtmp-e2e.js` | (topo do arquivo): complexidade 17 (limite 8); (topo do arquivo): blocos aninhados 2 (limite 1) |
| 3 | 10,00 | 36 | 6 | 6 | `MAC/integracao-iphone/distribuicao/empacotar-ferramentas.py` | (topo do arquivo): complexidade 12 (limite 8); (topo do arquivo): blocos aninhados 2 (limite 1); o arquivo: complexidade média das funções 4.0 (abaixo de 4) |
| 4 | 10,00 | 43 | 5 | 5 | `MAC/integracao-iphone/distribuicao/preparar-pacote.py` | (topo do arquivo): complexidade 11 (limite 8); (topo do arquivo): blocos aninhados 2 (limite 1); o arquivo: complexidade média das funções 4.0 (abaixo de 4) |
| 5 | 10,00 | 64 | 1 | 1 | `MAC/integracao-sequestro-cam/patch_transmissao.py` | o arquivo: complexidade média das funções 4.0 (abaixo de 4) |
| 6 | 10,00 | 152 | 1 | 1 | `MAC/traducao-interface/preparar.py` | o arquivo: complexidade média das funções 4.0 (abaixo de 4) |
| 7 | 10,00 | 539 | 0 | 166 | `app/electron/nova-grab-extension/content.js` | nenhum; a linha de base não desceu |
| 8 | 10,00 | 283 | 0 | 93 | `app/electron/services/nova-studio-controller.js` | nenhum; a linha de base não desceu |

**Por que o painel não cobra:**

- **Código solto no topo do arquivo** (itens 1 a 4). A catraca soma os `if`, `while` e `for` fora de função numa unidade "topo do arquivo" com limite 8. Nos dois testes de ponta a ponta do CAM LIVE o painel dá 0 de complexidade ao topo (`main-body-cc` 0), mesmo com laços ali. Nos dois scripts em Python o painel lê 12 e 9 e não tira ponto: no `empacotar-ferramentas.py` ele marca "Global Complexity" e mesmo assim a nota fica em 10,00. O painel só tira ponto do topo mais acima: `empacotar-python.py` (21) está em 9,68 e `aplicar.py` (18) em 8,65.
- **Média de complexidade igual a 4,0** (itens 3 a 6). A catraca cobra 1 ponto quando a média chega a 4 ("abaixo de 4"); o painel não marca nada nesses arquivos.
- **Linha de base que não desceu** (itens 7 e 8). `content.js` e `nova-studio-controller.js` medem 0 hoje, e a linha de base ainda lhes dá 166 e 93. Não é discordância de medida: falta rodar `--atualizar-linha-de-base` num commit que toque neles.

### Com pontos na catraca e sem nota no painel

Fora das duas listas, porque o painel não dá nota a eles. Os cinco `.py` estão na lista do painel sem nota (só têm código solto, sem função que ele pegue); o `.cjs` o painel nem lê.

| Pontos | Arquivo | No painel | Onde estão os pontos |
| --- | --- | --- | --- |
| 13 | `MAC/integracao-iphone/conexao-usb/aplicar-identidade.py` | sem nota | (topo do arquivo): complexidade 17 (limite 8); (topo do arquivo): blocos aninhados 5 (limite 1) |
| 12 | `MAC/integracao-iphone/conexao-usb/aplicar-idioma.py` | sem nota | (topo do arquivo): complexidade 17 (limite 8); (topo do arquivo): blocos aninhados 4 (limite 1) |
| 16 | `MAC/integracao-iphone/conexao-usb/aplicar-proxy-tipo.py` | sem nota | (topo do arquivo): complexidade 20 (limite 8); (topo do arquivo): blocos aninhados 5 (limite 1) |
| 8 | `MAC/integracao-iphone/distribuicao/verificar-binarios.py` | sem nota | (topo do arquivo): complexidade 15 (limite 8); (topo do arquivo): aninhamento 4 (limite 3) |
| 21 | `MAC/integracao-modelo-app/novamodel.test.cjs` | ausente (`.cjs`) | main: complexidade 16 (limite 8); main: linhas 81 (limite 69); o arquivo: complexidade média das funções 5.2 (abaixo de 4) |
| 2 | `scripts/regras/docstrings.py` | sem nota | (topo do arquivo): condição com 3 operadores lógicos (limite 1) |

## Os 40 arquivos que as duas veem

Para cada achado de função do painel, procurei na medição da catraca uma unidade com pontos:

- **mesma função:** a unidade começa na mesma linha (até 2 de distância) ou tem o mesmo nome e contém a linha;
- **dentro de função maior:** a linha cai dentro de uma unidade com pontos que não é a mesma função;
- **catraca não vê:** nenhuma unidade com pontos contém a linha;
- **duplicação:** "Code Duplication", que a catraca não mede.

As regras de arquivo do painel (Many Conditionals, Modularity Issue, Brain Method, File Size Issue, Overall Code Complexity, Global Complexity, High Degree of Code Duplication) não têm linha; vão na última coluna. "Many Conditionals" anda junto com a regra de média da catraca: dos 18 arquivos com Many Conditionals que a catraca mede, 17 também levam o ponto da média (a exceção é `registro-da-pr.js`, média 4,09 no painel).

A tabela arquivo por arquivo está no anexo, [catraca-e-painel-anexo.md](catraca-e-painel-anexo.md#os-40-arquivos-arquivo-por-arquivo).

Somando: 407 achados de função, 314 na mesma função (77%), 47 dentro de função maior (12%), 10 que a catraca não vê (2%) e 36 de duplicação (9%).

**Onde a catraca é mais grossa que o painel.** No `main.js`, 33 dos 66 achados caem dentro de `registerHandlers` (linhas 665 a 3897). A catraca soma numa unidade só os callbacks anônimos de `ipcMain.handle(...)`, e dá 649 pontos a `registerHandlers`; o painel separa cada um com o nome do canal (`registerHandlers.'system-fs-op'`, linha 2855, complexidade 38). No `global-spoof-service.js`, 9 caem dentro de `startHijack` (linhas 165 a 1404): 8 são funções de dentro do script injetado na página, que para a catraca é texto (seção seguinte), e 1 é o callback de `'Target.attachedToTarget'` (linha 1346). Nesses arquivos a catraca diz que o bloco está ruim, mas não diz qual handler cortar.

**Os 10 achados que a catraca não vê** (em 9 funções), mais o do `rtmp-server.js`, todos de complexidade ou de lombadas:

A tabela com cada função e as duas contagens está no [anexo](catraca-e-painel-anexo.md#os-achados-que-a-catraca-não-vê).

Três causas aparecem: a função interna com nome, que a catraca separa e o painel soma (`setCameraInjection`, `lerDoGitHub`, `ambiente`, `stopBroadcast`); a lombada ("Bumpy Road"), que a catraca não tem como regra (ela tem "blocos aninhados", que pega só parte dos casos); e três funções sem função interna em que o painel conta 3 a 4 a mais (`_openForward`, `_readState`, `parseTarget`), cuja causa não confirmei.

## O script injetado na página

O comentário do ticket pedia para conferir se o painel lê como código o texto que o `global-spoof-service.js` injeta na página (`deepHijackScript`) e o `getStealthSpoofScript` do `browserFarmService.js`. A nuvem foi descartada pelo dono (26/11), então a conferência é no servidor local, análise 160.

- **`deepHijackScript`** (texto que começa na linha 588): **o painel lê como código.** Os mesmos achados que o servidor antigo mostrava em 23/11 estão lá, com nomes de dentro do texto: `applyStealth.overrideGUM` (linha 920; complexidade 12, aninhamento 5, 2 lombadas), `applyStealth.enumerateDevices` (886; complexidade 9), os dois `readPixels` (997 e 1009; 7 argumentos cada), o condicional complexo em `applyStealth.toString` (693) e a duplicação entre `geolocation.getCurrentPosition` (794) e `watchPosition` (801). São 10 achados que a catraca não tem como ver: para ela é texto, e as linhas só caem dentro de `startHijack`.
- **`getStealthSpoofScript`** (método na linha 1743, texto de 1793 a 1994): **nenhum achado com nome de dentro do texto.** O painel aponta o método inteiro: complexidade 16 e 220 linhas. A catraca aponta o mesmo método com complexidade 28 e 253 linhas.
- Isso não muda os cortes: o corte 6 do global-spoof já reescreve o script como código. Mas confirma a classe de arquivo que a catraca não vê: código dentro de texto, que o painel às vezes lê.

## Dá para guiar um item de lote pela catraca?

**Não. O item começa pela tela do arquivo no painel**, com a lista de achados de `code_health_details/` (função, linha, medida), e termina com a nota 10 lida no painel. A catraca entra no meio, como conferência local e rápida.

- **Começar pela catraca deixa achados para trás.** Zerar os pontos dela não leva o arquivo a 10: sobram a duplicação (36 achados, em 5 arquivos), as regras de arquivo que ela não tem (Modularity Issue, Brain Method, File Size Issue, Global Complexity), as lombadas que ela não mede e as funções em que conta menos. Nos dez `.m` ela não diz nada.
- **Nos arquivos grandes ela não aponta o alvo.** No `main.js` ela dá 649 pontos a `registerHandlers`; o painel diz quais dos handlers dentro dela pesam.
- **No sentido oposto, a catraca às vezes pede mais que o painel** (lista 2): o código no topo de scripts e a média igual a 4,0. Nesses arquivos não há item de lote, porque o painel já está em 10. O ponto é outro: uma PR que toque neles tem de seguir a catraca, que barra no CI.
- **Durante o corte ela serve.** Em 77% dos achados ela aponta a mesma função e roda em segundos, sem análise do servidor. O agente corta, roda a catraca para ver a função descer e confere a nota no painel no fim: no check `CodeScene Code Health Review (main)` da PR ou numa análise nova.

**Para a fila** ([A fila dos lotes até a nota 10](https://github.com/vinicius928e8r84/Nova-AI/issues/139)): a fila sai da lista do painel (`node scripts/painel/lista-do-painel.js`), não da linha de base da catraca. Os dez `.m` só têm o painel como guia, e o roteiro deles é o da [Pesquisa: como se corta e se prova o código em Objective-C e Logos](https://github.com/vinicius928e8r84/Nova-AI/issues/133).

## O que não conferi

- Não conferi por que o painel conta de 3 a 4 a mais em `_openForward`, `_readState` e `parseTarget`. A documentação pública do CodeScene não diz como cada construção de JavaScript soma na complexidade.
- Não conferi o limite exato a partir do qual o painel tira ponto do código no topo do arquivo; só que 12 não tira e 18 e 21 tiram.
- A comparação "mesma função" casa por linha de início e nome. Uma função que muda de nome entre as duas leituras, ou um callback anônimo com outro rótulo, pode ter ficado na coluna errada.
- Não atualizei a linha de base nem mudei regra nenhuma: esta pesquisa só lê.

## Como refazer

Os passos estão no [anexo](catraca-e-painel-anexo.md#como-refazer).

## Fontes

- Painel, análise 160 (projeto 2, CodeScene 7.5.20, commit `96ea7ce`): `GET /api/v2/projects/2/analyses/160`, `.../analyses/160/files` e `GET /api/v2/metadata/code-health-rules`; `code_health_details/` em `/codescene/analysis/bf7c60de594d421d9bbfe535b1dd3b45859e9e1f/analysis20261126203935/`, lido dentro do container `opencleancode`.
- Repositório em `96ea7ce`: `scripts/regras/regra-saude.js`, `scripts/regras/analisador/pontos.js` (os limites), `scripts/regras/analisador/medir-js.js`, `scripts/regras/linha-de-base.json`, e os fontes citados (`app/electron/services/rtmp-server.js:92-134`, `app/electron/services/ios-camera.js:176`, `app/electron/main.js:2855`).
