# O corte do `app/dist/cam-live.js`: caracterização e prova

Continuação de [tela-do-camlive.md](tela-do-camlive.md), que traz os módulos e os cortes. Aqui ficam a caracterização que falta, o que rodei no código de hoje (`main` em `2eb4212`), a quebra de propósito e a prova real de cada corte.

## 1. A caracterização que falta

**Nenhum teste toca o `cam-live.js` hoje.** O `git grep` acha só os dois harnesses, que são servidores para uso manual. As funções são privadas do IIFE, então um teste em Node só chega nelas pelo `window.camLive` e por um DOM falso grande. O molde `palco`/`cenas`/`esperado` serve ao diário, mas o palco tem de ser o navegador. A caracterização entra num commit antes do corte 1, passa no código de hoje e tem duas partes.

**A. O roteiro da janela, no Chromium sem janela.** É o roteiro que a PR #161 usou, agora gravado. O roteiro:

- sobe `harness-usb.js` (USB, com o `UsbMedia` de verdade validando cada JPEG) ou `harness.js` (RTMP de verdade, com o ffmpeg ouvindo);
- abre o Chromium com `--use-fake-device-for-media-stream`;
- fixa o `Math.random` com uma semente antes da página, o que deixa os `id` dos itens iguais entre as rodadas.

Os passos que rodei:

1. abrir pelo botão CAM LIVE;
2. "+" e depois Cor;
3. ocultar o Padrão de teste;
4. acrescentar `photo.png` e `tone.wav` das `fixtures/`;
5. mudo e monitor;
6. selecionar a foto e arrastá-la 40×25 px com `Input.dispatchMouseEvent`;
7. abrir as propriedades, mudar X e rotação, e aplicar;
8. Computador e depois 1080p;
9. abrir e fechar as configurações;
10. renomear com duplo clique e Enter;
11. bloquear;
12. transmitir e parar (USB, ou RTMP depois de trocar o destino nas configurações);
13. minimizar e fechar.

A cada passo o diário grava:

- o `innerHTML` da janela, sem os contadores de tempo, as larguras dos medidores e o texto de dB;
- `P`, `R` (sem estatísticas) e `G`;
- o sha256 da prévia (`#cv.toDataURL()`);
- o que o harness contou: `camlive:start` com os argumentos, `stop`, e se chegaram quadros e PCM.

**B. As cenas de documento.** Um script na página troca a resposta de `camlive:studio-load` por um documento escrito à mão. Depois ele abre a janela e grava o `P` resultante. Isso roda `normalizeDoc`, `rescaleItems`, `fitItem` e `applyRel` no código de hoje, sem mexer nele. Rodei três documentos:

- o antigo de 1920×1080, sem `fmt` nem `target`, com URL local, volume 2, tipo desconhecido, áudio com quadro e duas cenas;
- o de celular 1080 em pé, com proporção inválida e RTMP externo;
- um sem `scenes`.

Depois do corte, as funções do módulo novo ganham também um teste em Node com `vm`, como a PR #161 fez com o `calcDims`.

**Cada corte acrescenta antes os passos da parte dele**, sem regravar os anteriores:

| Corte | Passos e cenas que faltam |
|---|---|
| 1 | os documentos de `fmt` e `ratio` de cada tabela de `RATIOS`; item com `rel` e com `fitMode` `fit`, `cover` e `stretch` trocando de formato; `localStorage` sem IPC; documento que lança no `normalizeDoc` (o `ipcLog` "studio inválido") |
| 2 | câmera falsa: ligar, ocultar (a trilha tem de parar) e mostrar; tela sem `screen-recorder:get-sources` (o erro "nenhuma tela encontrada" e o aviso); arquivo de cada extensão sem `type`; arquivo ignorado; subir e descer item; remover o selecionado; restaurar do IndexedDB e o "arquivo ausente" |
| 3 | o relógio fixo (`performance.now` e `Date`) para o Padrão de teste; item girado; alças com o item bloqueado e livre; o `placeholder` de cada caso; o medidor com o áudio tocando |
| 4 | RTMP com e sem `AudioEncoder`; erro do codificador; `camlive:status` com `finished`; `set-bitrate` e `keyframe`; USB com `camlive:start` falhando; a fila do PCM passando de 100 KB |
| 5 | as configurações com cada predefinição e com o destino USB; as propriedades de cada tipo (câmera e tela com dispositivos, cor, arquivo ausente, áudio sem quadro); a janela transmitindo, preparando e sem o módulo de áudio |
| 6 | arrastar a alça de girar (com Shift e perto de 90°); redimensionar pelo canto (com e sem Shift) e pela borda; Escape e Enter nos modais; cada item do menu de contexto; soltar arquivo na janela; minimizar ao lado de um Phone Control falso |

## 2. O que rodei e o que deu

Tudo na VPS, no Linux, com o Chromium 153 do Playwright (`~/.cache/ms-playwright/chromium-1243`), Node 24 e ffmpeg. Os scripts ficaram fora do repositório. A versão do lote vai junto da caracterização, no corte 1.

- **O roteiro é estável.** Duas rodadas do roteiro USB deram 0 erro de console e diários iguais em todos os passos, menos dois:
  - a prévia ao abrir, porque o Padrão de teste anda sozinho e tem relógio;
  - os medidores de áudio, que depois saíram do diário.

  O harness USB contou `camlive:start` com `{ target: 'iphone', fps: 30, sampleRate: 48000 }`, quadros válidos, PCM e nenhum quadro ruim.
- **O RTMP também roda sem aparelho.** O Chromium sem janela só codifica H.264 por software (`prefer-hardware: false`, `prefer-software: true`). A janela foi a "AO VIVO" e voltou a "Pronto", e o ffprobe leu h264 Main 1920×1080.
  - Só chegaram 9 quadros em 9 s, e o áudio não foi para o arquivo.
  - A contagem de quadros e o AAC se provam no app (Electron 34). Foi lá que a PR #161 mediu 195 e 203 quadros.
- **As cenas de documento são estáveis:** as duas rodadas deram o mesmo arquivo, byte a byte.
- **Quebra 1, no evento:** troquei `it.muted = !it.muted` por `it.muted = it.muted`. O diário divergiu a partir do passo "mudo e monitor", no HTML e no `P`.
- **Quebra 2, no documento:** tirei o `Math.min(1, …)` do volume no `normalizeDoc`. A cena do documento antigo divergiu (o item `a` ficou com volume 2), e as outras duas não mudaram.
- **Uma armadilha do roteiro.** Numa rodada, a guarda do PCM (`queuePcm`, linha 414) parou a transmissão sozinha: o aviso foi "O áudio ficou atrasado…", porque o harness leva cada PCM por HTTP. O clique seguinte em "Parar" encontrou `R.streaming` falso e **começou outra transmissão**.
  - O roteiro do lote tem de esperar o estado (`R.streaming` e o status) antes de clicar, e gravar o aviso.
  - No app, o IPC é direto e a fila não deve encher. Não reproduzi lá.

## 3. A quebra de propósito de cada corte

Cada PR mostra a caracterização falhando com a quebra e passando sem ela.

| Corte | Quebra | Quem pega |
|---|---|---|
| 1 | o volume sem o limite de 1 no `normalizeDoc` (feita aqui); trocar `oW` por `oH` no `rescaleItems` | a cena do documento antigo; o roteiro no passo "Computador" (as caixas no `P`) |
| 2 | `.m4a` tratado como vídeo no `kindOfFile`; o `reconcile` deixar de desmontar a câmera oculta | a cena dos arquivos sem `type`; a cena da câmera falsa (a trilha continua `live`) |
| 3 | a ordem das cores do Padrão de teste; a alça com 12 px em vez de 10 | o sha da prévia com o relógio fixo; o sha da prévia no passo "arrastou a foto" |
| 4 | tirar o `Math.min(30, …)` do fps no USB; mandar `audio: 128` sem `AudioEncoder` | o `camlive:start` que o harness USB conta, com fps 60; o `camlive:start` do RTMP no diário |
| 5 | o rótulo "Transmitir para o iPhone" trocado; a predefinição `custom` como padrão errado nas configurações | o HTML no passo "bloqueou"; o HTML no passo "abriu configurações" |
| 6 | `it.muted` sem inverter (feita aqui); trocar subir por descer; o ímã de rotação de 3° para 5° | o roteiro no passo "mudo e monitor"; o passo de subir e descer; o passo de girar perto de 90° |

## 4. A prova real de cada corte

**O agente, sem aparelho, em todos os cortes:**

- o roteiro USB e o RTMP iguais antes e depois, na VPS;
- `node --check` e as regras (`verificar.js --base origin/main`);
- a nota lida no painel depois da análise;
- no Mac de prova, o app rodando pelo código com o Electron 34, como a PR #161 fez: abrir o CAM LIVE, a fonte Cor, arrastar e o RTMP para um ffmpeg local, com o ffprobe e o console sem erro nos dois lados.

| Corte | O que o agente prova a mais | O que pede o dono | Provas pendentes |
|---|---|---|---|
| 1 | as cenas de documento com o `camlive-studio.json` de verdade do app (cópia), e o app abrindo o estúdio salvo; `electron-builder --mac dir --arm64` na base e no head, comparando o que foi empacotado | iPhone com jailbreak no cabo: "Transmitir para o iPhone" com o Padrão de teste, a imagem na Câmera do iPhone e a parada; a injeção antes da live | [#95](https://github.com/vinicius928e8r84/Nova-AI/issues/95) e [#97](https://github.com/vinicius928e8r84/Nova-AI/issues/97), no lote 11 como a fila já marca |
| 2 | no app do Mac: captura de tela de verdade (`desktopCapturer`), a câmera do Mac, o arquivo restaurado depois de reabrir o app | a mesma live curta pelo USB, com uma foto e um vídeo com áudio | nenhuma |
| 3 | no app do Mac: o sha da prévia com o relógio fixo; o quadro que chega no RTMP local igual antes e depois | nenhuma (o quadro é o mesmo que vai para o iPhone, e o caminho do USB não muda) | nenhuma |
| 4 | no app do Mac: RTMP com AAC (o ffprobe com áudio), contagem de quadros perto da base, `set-bitrate` com bitrate dinâmico | iPhone com jailbreak no cabo: transmitir com áudio das cenas, parar, transmitir de novo; o áudio chega no iPhone | nenhuma |
| 5 | no app do Mac: os prints da janela, das configurações e das propriedades iguais antes e depois | nenhuma | nenhuma |
| 6 | no app do Mac: arrastar, girar e redimensionar com o mouse de verdade; menu de contexto; soltar arquivo; minimizar; abrir ao lado do Phone Control | nenhuma, se o Phone Control abrir sem aparelho; se não abrir, o dono abre o CAM LIVE com o iPhone conectado e confere a posição | nenhuma |

A prova do dono junta os cortes 1, 2 e 4 à sessão de iPhone com jailbreak no Mac de cada lote. O lote 11 já tem essa sessão pela fila, e os lotes 12 e 14 a ganham por estes cortes.

## 5. Achados à parte

Os cortes mantêm tudo isto como está, e a caracterização congela cada item.

1. **O botão de transmitir decide pelo estado, não pelo rótulo** (`onClick`, linha 838: `R.streaming ? stopStreaming() : startStreaming()`). Quando a transmissão cai sozinha (a fila do PCM, o erro do codificador ou `finished`), o mesmo botão passa a começar outra. Para quem vê a janela, isso é o esperado, porque o rótulo muda junto. Para o roteiro, é a armadilha da seção 2. Não é defeito provado.
2. **O Padrão de teste usa o relógio do sistema** (`new Date().toLocaleTimeString()`, linha 270). A prévia nunca dá o mesmo sha entre rodadas sem relógio fixo. Isso não é defeito, mas a prova precisa saber.
