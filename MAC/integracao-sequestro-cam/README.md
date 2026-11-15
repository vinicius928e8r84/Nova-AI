# Sequestro de Câmera — só o item 3 com on/off real do jailbreak

Aprovado pelo usuário em 03/11/2026 (site de teste: `prototype-sequestro-cam/`).

## O que mudou no app instalado

Aba **Sequestro de Câmera** (janela Controle do Celular – Suíte de Hardware):

- Removidos os itens 1 (Preparar módulo de câmera), 2 (Selecionar Vídeo de
  Câmera Falsa) e o bloco "Como Funciona".
- Ficou apenas o **item 3 — Ativar Sequestro de Câmera** com **Ligar /
  Desligar**, sem exigir vídeo selecionado.
- O estado LIVE/Standby do cabeçalho passa a refletir a injeção real ao abrir
  a aba (`get-cam-spoof-status` → `active`).
- Botões e mensagens em pt-BR, sem emojis.

## Como o Ligar/Desligar funciona (iPhone USB)

`electron/services/ios-camera.js` reescrito:

- **Ligar** (sem vídeo): `./phone.sh enable-photo` no
  `/Users/aquilesneri/Desktop/jailbreak/obs-camera-source/bridge` — túnel USB +
  injeção contínua de visor, foto, vídeo e áudio do OBS na Câmera nativa.
- **Desligar**: `./phone.sh disable` (equivalente: escreve `{"mode":"observe"}`
  por SSH com a chave `~/.ssh/id_iphone`) e encerra servidor/túnel locais.
- O `phone.sh` pede senha quando não há conexão-mestre SSH; o serviço abre a
  mestre com a chave `id_iphone` no mesmo ControlPath
  (`/tmp/vcampipeline-ssh-$UID/control`) que o `phone.sh` reutiliza.
- **Status**: lê `/var/tmp/obs-graph-bridge-status.json`; pronto =
  `hooksReady && !faulted` (sem travar versão — antes exigia 0.1-30 e o
  iPhone está na 0.1-38, por isso o botão antigo nunca ficava pronto).
- Fluxo antigo de vídeo local (arquivo MP4 → MJPEG 18999) preservado: se um
  caminho de vídeo for passado, usa o caminho antigo em vez do jailbreak.
- Aviso automático quando o relé do OBS (porta 8900) não responde.

O Android (módulo LSPosed) não usa essa janela de on/off do jailbreak; segue
pelo caminho ADB original quando há um vídeo.

## Teste real executado (03/11/2026, iPhone 8 Plus, ponte 0.1-38)

- `status` → pronto, ativo.
- `stop` + 4s → `active=false`.
- `start('')` (enable-photo) + 3s → `active=true`, com aviso de relé desligado.
- Estado final: injeção ligada (igual ao início do teste).

## Ajuste 04/11: corrida de reativação do CAM LIVE não derruba mais transmissão

Restava uma janela de corrida: o CAM LIVE reativa a injeção a cada 20 s
(heartbeat) e a cada quadro novo (`_maybeEnable`). Se o Ligar/Desligar do
sequestro caísse no meio dessa reativação, o CAM LIVE via o controle mudar
de dono e **encerrava a transmissão** com "Outra sessão assumiu o controle
durante a ativação".

Correção (`cam-live-iphone.js` + `ios-camera.js`):

- Todos os pontos que antes lançavam erro fatal ao perder o controle
  (ramos A/B do `_activate` e a checagem pós-confirmação) agora **pausam** a
  sessão com status "Transmissão no ar — câmera com o sequestro" quando o
  controle estranho é do próprio Nova (marcador `novaSequestroSession` ou sem
  marcador, caso do `phone.sh`). O erro fatal sobra só para uma sessão CAM
  LIVE de verdade diferente.
- `_activate` não reescreve mais o controle depois de pausado pelo sequestro.
- O Ligar/Desligar do sequestro agora espera a reativação em curso do CAM
  LIVE terminar (`activationTask`) antes de escrever o controle.
- Testes: corridas com marcador e sem marcador pausam a sessão (viva, sem
  reescrita); sessão CAM LIVE estranha continua bloqueando; ciclo real no
  aparelho com CAM LIVE simulado terminou com injeção ligada (`["*"]`) e a
  "transmissão" preservada.

## Ajuste 03/11 (madrugada): transmissão assume a câmera do sequestro

Sintoma: com o sequestro LIGADO (sem transmissão) e depois tentar iniciar uma
transmissão, o CAM LIVE falhava com "A porta de câmera do iPhone está ocupada
por outra transmissão". Motivo: o Ligar sem transmissão usa o `phone.sh`
(`enable-all`), que mantém injeção **contínua** e o encaminhamento do túnel
mestre `18999→8900`; o túnel do CAM LIVE não consegue abrir a mesma porta
18999 do iPhone.

Correção (`cam-live-iphone.js` + `ios-camera.js`):

- Ao iniciar, o CAM LIVE chama `iosCamera().liberarPortaCamera()` (cancela o
  encaminhamento do sequestro) antes de abrir o próprio túnel.
- A guarda "Outra transmissão está ativa" só bloqueia quando o controle
  carrega o marcador de **outra sessão CAM LIVE**. Controle do sequestro
  (marcador `novaSequestroSession` ou sem marcador, caso do `phone.sh` do
  Terminal) → a transmissão assume a câmera e reescreve o controle.
- No `_activate`, qualquer controle ocupado que não seja de outra sessão CAM
  LIVE gera pausa ("Transmissão no ar — câmera com o sequestro"), nunca
  morte da sessão.
- Testado com ponte simulada: sequestro contínuo sem marcador → transmissão
  inicia e libera a porta; sessão CAM LIVE estranha → continua bloqueando.

## Ajuste 03/11 (noite 3): transmissão também injeta em qualquer app

Investigação do lado do jailbreak (`bridge/Tweak.x` + READMEs): o jeito que
funciona para o Safari é o controle com `appIDs ["*"]` (modo `enable-all`),
que o tweak aceita como curinga (`appAllowed`), com o remapeamento
`remoteQueuePortType` padrão (`PortTypeBack`) já ativo na ponte 0.1-38 — o
status do aparelho mostrava `remoteQueuePortRemaps` acontecendo e
`com.apple.WebKit.GPU` entre os apps observados.

O problema real: quando o Nova AI transmitia (CAM LIVE), ele mesmo escrevia o
controle com `appIDs ["com.apple.camera"]` — só a Câmera nativa; o Safari e
outros apps ficavam de fora. Corrigido para o padrão do jailbreak:

- `cam-live-iphone.js` (`_activate`): `appIDs ["*"]` ao transmitir.
- `ios-camera.js` (`enable()` da transmissão local antiga): acrescentado
  `appIDs ["*"]` (antes não mandava `appIDs` e caía no padrão só-Câmera).
- Sequestro (item 3) já usava `["*"]` nos dois caminhos (ajuste anterior).
- Teste com ponte simulada: config do CAM LIVE sai com `appIDs ["*"]` e a
  sessão ativa em "AO VIVO".

## Ajuste 03/11 (noite 2): injeção para qualquer app, incl. Safari

O Ligar usava `enable-photo`, que só cobre o app Câmera nativa
(`appIDs ["com.apple.camera"]`) — por isso o Safari não recebia o vídeo do
OBS. Trocado para o modo geral nos dois caminhos:

- sem transmissão: `./phone.sh enable-all` → `appIDs ["*"]` (qualquer app).
- transmissão no ar: escrita direta do controle com `appIDs ["*"]`.
- Desligar inalterado (`observe`). Testado no aparelho: controle com
  `appIDs ["*"]`, ativo, transmissão preservada; estado final ligado.
- O site de teste (`prototype-sequestro-cam/servir.py`) também usa
  `enable-all` agora.
- No Safari o vídeo do OBS depende do relé 8900 ligado (OBS + relay.py),
  como na Câmera nativa.

## Ajuste 03/11 (noite): sequestro não mexe na transmissão

O Ligar/Desligar do item 3 passou a ter caminho próprio (`startCamSpoof` /
`stopCamSpoof` em `ios-camera.js`) e nunca derruba uma transmissão:

- **Transmissão no ar (vídeo local ou CAM LIVE)**: Ligar escreve o controle da
  ponte direto (`novaSequestroSession`, url `127.0.0.1:18999`), usando o túnel
  que a transmissão já mantém — a câmera passa a mostrar o conteúdo
  transmitido ("obs" interno). Desligar escreve `observe` — câmera real. Em
  ambos os casos o servidor, o túnel, o encoder e o status da transmissão
  ficam intactos; a transmissão só muda pelos controles dela.
- O renovador da transmissão local (heartbeat de 20 s) é suspenso enquanto o
  sequestro decide a fonte; ao reiniciar a transmissão ela volta a alimentar
  a câmera normalmente.
- **CAM LIVE** (`cam-live-iphone.js`): quando o sequestro assume o controle da
  ponte, a sessão pausa com o status "Transmissão no ar — câmera com o
  sequestro" em vez de morrer com "Outra sessão assumiu o controle". Parar e
  iniciar a transmissão de novo devolve o controle a ela.
- **Sem transmissão no ar**: Ligar/Desligar seguem o `phone.sh`
  (enable-photo/disable) como antes; o Desligar também libera o
  encaminhamento 18999 do túnel mestre para não bloquear uma transmissão
  futura.
- `physicalMobileService.js`: `startCamSpoof`/`stopCamSpoof` de iOS roteiam
  para os métodos dedicados; o fluxo antigo `start()/stop()` da transmissão
  permanece intacto.
- `cam-live-service.js`: expõe a instância do CAM LIVE no mobile service
  (`ms.camLiveIphone`) para o sequestro pausá-la sem brigar pelo controle.

Testes reais (iPhone, ponte 0.1-38): ligar/desligar sem transmissão;
ligar/desligar com transmissão simulada (controle com marcador, transmissão
preservada); pausa do CAM LIVE com ponte simulada (sessão viva, sem erro).

## Arquivos

- `reservas/antes-20261103-204008/` — originais do renderer + ios-camera.
- `reservas/antes-transmissao-*/` — originais dos 4 arquivos de serviço antes
  do ajuste da transmissão.
- `index-Dun7lr2S.patched.js`, `ios-camera.patched.js`,
  `physicalMobileService.patched.js`, `cam-live-service.patched.js`,
  `cam-live-iphone.patched.js` — versões aplicadas no app.
- `patch_bundle.py`, `patch_transmissao.py` — cirurgias (rodam sobre as reservas).

## Para restaurar

```sh
cp reservas/antes-20261103-204008/index-Dun7lr2S.js \
   "/Applications/Nova AI Mac.app/Contents/Resources/app/dist/assets/"
cp reservas/antes-20261103-204008/ios-camera.js \
   "/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services/"
```

e reiniciar o app.

## Site de teste (referência aprovada)

`/Users/aquilesneri/Desktop/Nova-AI/prototype-sequestro-cam/` —
`python3 servir.py` → http://127.0.0.1:8788 (mesmo on/off real via phone.sh).
