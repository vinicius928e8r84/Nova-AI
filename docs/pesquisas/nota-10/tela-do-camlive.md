# O corte do `app/dist/cam-live.js`

Pesquisa do ticket [Pesquisa: o corte do app/dist/cam-live.js](https://github.com/vinicius928e8r84/Nova-AI/issues/192), do mapa [Nova-AI na nota 10 no CodeScene](https://github.com/vinicius928e8r84/Nova-AI/issues/120). Tudo foi conferido na `main` em `2eb4212`, que é o commit da análise 164 do painel (26/11, 23:12 UTC). Os números de linha citados são desse commit. Esta pesquisa não muda código de produto.

## A resposta em poucas linhas

- O arquivo sai em **oito módulos novos**, em **seis cortes em série**, um por lote, nas vagas dos lotes 11 a 16. Nenhum corte passa do limite de seis.
- O `cam-live.js` fica com a janela, o botão e a ligação entre os módulos: cerca de **14 KB e zero ponto**. Hoje ele tem 71.194 bytes e 356 pontos.
- **Hoje nenhum teste cobre o arquivo.** A caracterização tem duas partes. A primeira é um roteiro no Chromium sem janela, contra os harnesses que já existem em `MAC/integracao-camlive/test/`. A segunda são cenas de documento, que entram pelo `camlive:studio-load`. **Rodei as duas aqui, no código de hoje.** As duas deram o mesmo diário em duas rodadas e pegaram as duas quebras de propósito que testei ([tela-do-camlive-prova.md](tela-do-camlive-prova.md), seção 2).
- O agente prova sem aparelho todos os cortes, na VPS e no app do Mac de prova. O dono só é chamado para o iPhone por USB, nos cortes 1 (com [#95](https://github.com/vinicius928e8r84/Nova-AI/issues/95) e [#97](https://github.com/vinicius928e8r84/Nova-AI/issues/97)), 2 e 4.
- **Nenhuma decisão nova do dono.** O plano cabe nas regras que [A fila dos lotes até a nota 10](https://github.com/vinicius928e8r84/Nova-AI/issues/139) já fixou.

## 1. Como o arquivo é hoje

| Medida | Valor | Fonte |
|---|---|---|
| Bytes (LF) | 71.194 | `wc -c app/dist/cam-live.js` |
| Linhas | 987 (958 de código para o painel) | `wc -l`; API do painel |
| Nota | 1,65 (1,6561), a pior do painel, hotspot | `/api/v2/projects/2/analyses/latest/files`, análise 164 |
| Pontos na catraca | 356 em 41 unidades | `scripts/regras/linha-de-base.json:12`; medido de novo com `medirJs` e `pontuar` |
| Funções para o painel | 128, complexidade média 6,14 | detalhes da análise, `code_health_details/3d2708fd….json` no container |

**O que o painel acusa:**

- 30 Complex Method. Os piores são `onClick` 54, `bindCanvas.'pointermove'` 26, `modalOk` 25, `startStreaming` 23 e `normalizeDoc` 22.
- 34 Complex Conditional, em 25 funções.
- 6 Bumpy Road: `onClick` (10 lombadas), `pointermove` e `modalOk` (4 cada), `mountFile`, `startCapture` e `drawItem` (2 cada).
- 1 Deep Nested: `modalOk`, aninhamento 4.
- 3 Excess Arguments: `rescaleItems` 5, `cover` 6, `placeholder` 7.
- Many Conditionals, que é o achado do arquivo inteiro. Ele anda junto com a média de complexidade 4 ou mais (ver [catraca-e-painel.md](catraca-e-painel.md)): o `cam-live-audio.js`, com média 7,0, também o tem, e o `cam-live-modelo.js`, com 2,09, não.

O painel não acusa duplicação nem função longa: a maior é o `modalHTML`, com 37 linhas.

**Por trecho.** O trecho de `onClick` a `onDrop` (linhas 803-889) tem 6.697 bytes, 72 pontos e 4 Complex Method.

| Trecho (linhas) | Bytes | Pontos | Funções | Média |
|---|---:|---:|---:|---:|
| início, estado, cena e `save` (1-40) | 2.071 | 0 | 9 | 1,6 |
| documento: `normalizeDoc`, `load`, `restoreFiles` (41-82) | 2.374 | 23 | 3 | 12,7 |
| enquadramento: `nativeOf` a `rescaleItems` (83-124) | 2.217 | 13 | 8 | 4,9 |
| mídia: tocar, montar, `startCapture`, `reconcile` (125-190) | 3.839 | 27 | 7 | 9,1 |
| itens: adicionar, remover, `kindOfFile` (191-238) | 2.743 | 3 | 11 | 3,4 |
| `setFormat` (239-251) | 612 | 3 | 1 | 10,0 |
| desenho e laço (252-349) | 6.893 | 34 | 12 | 6,9 |
| `Encoder` e `JpegEncoder` (350-411) | 3.806 | 11 | 12 | 3,8 |
| PCM e `startUsbStreaming` (412-449) | 2.562 | 18 | 3 | 11,3 |
| `startStreaming`, parar, ouvintes do IPC (450-511) | 4.012 | 17 | 8 | 6,3 |
| host e barra de formato (512-538) | 1.553 | 0 | 4 | 3,3 |
| docas: `itemRow`, `audioRow`, `docksHTML` (539-571) | 4.686 | 21 | 4 | 10,8 |
| `modalHTML` (572-611) | 7.115 | 30 | 2 | 19,0 |
| pintar e editar o nome (612-630) | 1.172 | 2 | 6 | 3,5 |
| status, aviso e menus (631-665) | 3.182 | 4 | 8 | 4,0 |
| `bindCanvas` (666-709) | 2.985 | 50 | 2 | 23,5 |
| `openProps` e `modalOk` (710-746) | 2.654 | 21 | 4 | 9,8 |
| a janela: montar, geometria, arrastar (747-802) | 4.388 | 0 | 8 | 2,8 |
| eventos: `itemMenu` a `onDrop` (803-889) | 6.697 | 72 | 11 | 10,5 |
| ao lado do Phone Control (890-929) | 1.362 | 4 | 2 | 9,5 |
| abrir, fechar, botão e o que é exportado (930-987) | 4.271 | 1 | 8 | 3,9 |

"Funções" e "Média" são as unidades e a complexidade média da catraca. Os 2 pontos que sobram são o topo do arquivo (complexidade 9) e a média do arquivo (6,2).

**Quem usa o arquivo.**

- `app/dist/index.html:247` o carrega com `defer`, depois de `cam-live-audio`, `-dados`, `-modelo` e `-geometria`. A ordem importa.
- Os dois harnesses servem os módulos por uma lista fixa (`/^\/cam-live(-dados|-modelo|-geometria)?\.js$/`) e os põem na página.
- `MAC/traducao-interface/preparar.py:147` copia os quatro arquivos pelo nome.
- O `prototype-cam-live/gerar-site.py:9` faz o mesmo, mas sai pela [#132](https://github.com/vinicius928e8r84/Nova-AI/issues/132).
- Para fora, o arquivo só exporta `window.camLive` (`open`, `close`, `toggle`, `state`, `startStreaming`, `stopStreaming`, `addFiles`, `setFormat`, `_enc`).
- No IPC, o arquivo chama `camlive:studio-load`, `studio-save`, `start`, `stop`, `frame` e `pcm`, e também `screen-recorder:get-sources`. Ele manda `camlive:log`, `packet`, `avcc`, `aasc` e `apacket`, e escuta `camlive:status`, `stats`, `set-bitrate` e `keyframe`.

## 2. Os módulos de destino

O prefixo `cam-live-` mantém tudo dentro do glob `**/cam-live*` do grupo `ponte-do-iphone` (`scripts/regras/caminhos-sensiveis.json:10`). Assim os módulos novos já nascem com atenção ALTA, sem mexer em regra.

**Como os módulos se falam.** Os três módulos da PR #161 são funções puras num objeto (`window.CamLiveModelo`). Os novos precisam do estado (`P`, `R`, `G`, o mapa `rt`, `enc`, `shadow`) e uns das funções dos outros: o desenho chama `paintDocks`, os eventos chamam quase tudo.

A proposta é que cada módulo exporte uma fábrica, `window.CamLiveFontes = (contexto) => ({ … })`. O `cam-live.js` monta um objeto `contexto` só e chama as fábricas na ordem dos `<script>`:

- o `contexto` lê `P` por um getter, porque `load` troca o objeto inteiro;
- ele guarda `R`, `G` e `rt` por referência;
- ele também recebe as funções que cada fábrica devolve.

Um módulo chama o outro na hora do uso (`contexto.paintDocks()`), nunca na hora de carregar. Por isso a dependência circular de hoje continua funcionando sem ordem nova. O corte 1 cria esse `contexto`, e os seguintes só o usam.

| Módulo | O que leva | Corte | Tamanho estimado |
|---|---|---:|---:|
| `cam-live-documento.js` | `normalizeDoc` (vira tabela de padrões por campo), `load`, `restoreFiles`, `nativeOf` (tabela por tipo), `fitItem`, `containSize`, `captureRel`, `applyRel`, `rescaleItems` (recebe `{ de, para }` em vez de 5 argumentos), a decisão do `setFormat` | 1 | 6 KB |
| `cam-live-fontes.js` | `applyAudio`, tocar e pausar, `unmount`, `mountFile`, `startCapture` (câmera e tela em funções separadas), `reconcile`, `kindOfFile` (tabela de extensões), adicionar, mover e remover itens, `pickFiles`, olho e cadeado | 2 | 7 KB |
| `cam-live-desenho.js` | `cover` e `placeholder` (recebem um retângulo), `drawItem` (tabela por tipo: cor, padrão de teste, captura e arquivo), `renderFrame`, `fitPreview`, `drawPreview` (alças e rotação em funções próprias), medidores, `loop` e `ensureLoop` | 3 | 7 KB |
| `cam-live-codificadores.js` | `LEVELS`, `levelFor`, `Encoder` e `JpegEncoder` | 4 | 4 KB |
| `cam-live-transmissao.js` | a fila do PCM, `startUsbStreaming`, `startStreaming` (preparar, áudio e `camlive:start` separados), `stopStreaming`, `finishLocal` e os quatro ouvintes do IPC | 4 | 7 KB |
| `cam-live-docas.js` | barra de formato, `itemRow`, `audioRow`, `docksHTML` (cada doca numa função), `paintDocks`, renomear, status, aviso, menu de contexto e menu do "+" | 5 | 10 KB |
| `cam-live-modais.js` | `modalHTML` em três (erro, configurações e propriedades), `paintModal`, `openProps` e `modalOk` (configurações e propriedades separadas) | 5 | 10 KB |
| `cam-live-arraste.js` | `bindCanvas`: o `pointerdown`, e o `pointermove` dividido por modo (mover, girar e redimensionar) | 6 | 3,5 KB |
| `cam-live-eventos.js` | `onClick` como tabela `ação → função` (hoje são 30 `if` em série), `itemMenu`, `onDbl`, `onKey`, `onCtx`, `onChange`, `onInput`, `onFocusOut`, arrastar e soltar arquivos | 6 | 7,5 KB |
| `cam-live.js` (fica) | a guarda `__camLive`, o `contexto`, `save`, a janela (`buildPanel`, `renderPanel`, `applyGeom`, `bindWindow`), a posição ao lado do Phone Control, abrir e fechar, o botão, o `MutationObserver` e `window.camLive` | — | 14 KB |

Os tamanhos são a soma dos trechos de hoje mais a ligação, que dá umas centenas de bytes por módulo. Todos ficam abaixo de 1.000 linhas e de 20.000 bytes. Cada módulo novo nasce com **zero ponto** (a catraca barra o arquivo novo que nasce com pontos) e com **média de complexidade abaixo de 4**, senão o painel acusa Many Conditionals. Os cortes conferem as duas coisas.

## 3. Os cortes em série

Todos mexem no `cam-live.js`, então vão em série, um por lote. Os pontos são exatos para a catraca de hoje, somados por função. Os bytes são os dos trechos que saem.

| # | Lote | Corte | Funções com pontos que saem | Pontos | Bytes que saem | Fica no `cam-live.js` |
|---|---:|---|---|---:|---:|---:|
| 1 | 11 | **o documento** (cria o `contexto`) | `normalizeDoc` 17, `nativeOf` 11, `load` 6, `setFormat` 3, `rescaleItems` 2 | 39 | 5.200 | ~66 KB |
| 2 | 12 | **as fontes** | `reconcile` 11, `startCapture` 8, `unmount` 5, `mountFile` 3, `kindOfFile` 2, `moveItem` 1 | 30 | 6.600 | ~60 KB |
| 3 | 13 | **o desenho** | `drawItem` 15, `updateMeters` 6, `drawPreview` 4, `placeholder` 3, `loop` 3, `cover` 2, `ensureLoop` 1 | 34 | 6.900 | ~53 KB |
| 4 | 14 | **a transmissão** (dois módulos) | `startStreaming` 16, `pumpPcm` 10, `startUsbStreaming` 8, `JpegEncoder.push` 7, `Encoder.start` 4, ouvinte `camlive:status` 1 | 46 | 10.400 | ~43 KB |
| 5 | 15 | **os painéis** (dois módulos) | `modalHTML` 30, `modalOk` 19, `docksHTML` 17, `itemRow` 4, `updateStatusDom` 4, `openProps` 2, `commitEdit` 2 | 78 | 20.000 | ~24 KB |
| 6 | 16 | **a interação** (dois módulos) e o que sobra | `onClick` 58, `bindCanvas` 50, `onKey` 5, `onChange` 5, `onFocusOut` 2, `itemMenu` 2, `syncPhoneControlPosition` 2, `placeBesidePhoneControl` 2, `closeWindow` 1, o topo 1 e a média 1 | 129 | 9.700 | ~14 KB, 0 ponto |

A soma é 356 pontos. O arquivo só fica abaixo de 20.000 bytes no corte 6. O corte 6 também conserta, no próprio `cam-live.js`, o que o painel aponta no que fica: `syncPhoneControlPosition` com complexidade 10, `placeBesidePhoneControl` com 9, a condição do `closeWindow` e o topo com complexidade 9.

**Por que esta ordem.**

- **O corte 1 é o mais seguro.** Ele tem funções quase puras e testáveis pelas cenas de documento. Também cria o `contexto`, que todos os outros usam.
- **Os cortes 2, 3 e 4** seguem o caminho do quadro: a fonte, o desenho e o codificador.
- **O corte 5 só mexe em texto HTML**, e o diário da janela confere cada byte dele.
- **Os eventos vêm por último** porque chamam a API de todos os módulos. A tabela de ações só fica estável quando todos os módulos já existem.

**Se a fila precisar.** O corte 5 é o maior em bytes (são dois módulos de 10 KB). Se a revisão pedir, ele se divide em docas e modais, e a segunda metade vira o sétimo corte, num lote próprio no fim da fase do produto, como a #139 já prevê. A conta de pontos não muda.

**O que cada corte troca no app e nos harnesses.**

- `app/dist/index.html` ganha um `<script defer>` por módulo novo, antes de `cam-live.js`.
- `harness.js` e `harness-usb.js` ganham o módulo na lista e na página. Vale trocar já no corte 1 a lista fixa por `/^\/cam-live(-[a-z]+)?\.js$/`, para os cortes seguintes não mexerem nela.
- `MAC/traducao-interface/preparar.py:147` recebe o nome do módulo novo.
- A linha do arquivo desce em `scripts/regras/linha-de-base.json` (`saude-do-codigo` 356, `comentarios` 52), com `node scripts/regras/verificar.js --atualizar-linha-de-base`.

A cópia de reserva do app instalado vai para `~/Nova-AI-reservas/`, pela [#138](https://github.com/vinicius928e8r84/Nova-AI/issues/138). Cada PR troca `app/dist/cam-live*.js` e `app/dist/index.html` no app instalado.

## 4. Caracterização e prova

Estão em [tela-do-camlive-prova.md](tela-do-camlive-prova.md): a caracterização que falta, o que rodei e o que deu, a quebra de propósito e a prova real de cada corte, e os achados à parte.
