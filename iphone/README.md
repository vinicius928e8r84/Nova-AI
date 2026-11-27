# Nova AI → iPhone USB

## Bridge 0.1-39: transporte camuflado — 04/11/2026

A câmera não lê mais `127.0.0.1:18999/frame.jpg`. O `Tweak.x` 0.1-39 aceita só `/s/<token de 32 hex>/frame.jpg` e um `socket` opcional; o Mac abre primeiro um socket Unix por SSH (`-R /var/tmp/.nb-<hex>.sock:...`) e, se o sshd recusar, usa porta TCP aleatória. O IP fixo da rede de casa foi removido do tweak. `cam-live-iphone.js` e `ios-camera.js` geram o token e atualizam o control; o sequestro pega o endereço de `CamLiveIphone.mediaEndpoint()`. O `camera.deb` 0.1-39 vai junto com o app e o `setup.js` instala essa versão. Detalhes e o que não foi testado no aparelho: `../LEIA-ME.md` (topo).

## Conexão dentro do app — 04/11/2026

Clicar em **Conectar** num iPhone não abre mais uma janela/página à parte. O modal da senha SSH, o progresso da preparação e o próprio controle do iPhone são desenhados dentro da janela do Nova (fundo escurecido, mesmo visual do Controle do Celular). A senha continua sem ser salva; o input é limpo antes do IPC e os erros nunca repetem a senha.

O console do iPhone passou a abrir num `<webview>` dentro do app, com "Abrir em janela" como alternativa. O serviço de preparação (SSH, chave deste Mac, ponte de câmera) não mudou — só a interface.

Depois de conectar, o cartão do aparelho deixa de mostrar **Conectar**: vira **Abrir controle** (ciano), que abre o console direto, sem senha. O estado vem do `iphone-hosts.json` gravado por um Conectar bem-sucedido (`iosPrepared`) e o painel é avisado na hora por `physical-mobile:status-updated`. Android continua com "Parar transmissão". No topo do controle, **Refazer conexão** reabre o quadro de senha.

Detalhes, código do `main.js`/`preload.js`, capturas e como desfazer: `interface/controle-do-celular/iphone/README.md`. Fontes: `app/electron/services/iphone-setup/inapp.js` e `app/electron/services/iphone-setup/setup.js`. Testes: `test/iphone/setup.test.cjs` e harness Electron em `test/iphone/modal/` (modal aberto pelo preload real, senha enviada e limpa do campo, `<webview>` do console). **Aplicado no app instalado; reinicie o Nova. O DMG não foi regenerado.**

## Estado em 02/11/2026

O aplicativo instalado foi corrigido para encaminhar CAM HIJACK de IDs `ios-` para `ios-camera.js`. Android continua no serviço original; o APK empacotado agora é encontrado em `process.resourcesPath`.

A interface da aba usa textos de preparação por plataforma. A instalação iOS verifica o bridge, sem tentar instalar APK.

## Instalar no aparelho

Abra `instalar-iphone.command`. Ele transfere o pacote OBSGraphBridge 0.1-30, pede a senha de sudo do iPhone no Terminal, reserva dylib/plist/config anteriores e reinicia mediaserverd. Esse reinício interrompe câmera/áudio brevemente. Não precisa de senha de administrador do Mac.

Após instalar, feche e reabra Nova AI. Selecione o iPhone em DEVICES; em CAM HIJACK, prepare o módulo, selecione um MP4 e inicie. Feche e reabra a Câmera no aparelho.

## Funcionamento

O MP4 é decodificado pelo FFmpeg em JPEGs a 15 fps, até 1280 pixels. Um servidor HTTP escuta somente em 127.0.0.1:18999. SSH por USB encaminha a mesma porta para o loopback do iPhone. O OBSGraphBridge lê `/frame.jpg`. Nenhum túnel público ou serviço Wi-Fi é aberto.

A mudança nativa em relação a 0.1-29 aceita também `http://127.0.0.1:18999/frame.jpg`; o endereço LAN antigo continua aceito para compatibilidade. Versão passa a 0.1-30. Outros hooks e caminhos nativos foram preservados.

A ativação dura 60 segundos e o Nova renova a cada 20 segundos. Ao parar, o controle volta a observe. Se o Nova sair abruptamente, a ativação expira. Depois de parar, feche e reabra a Câmera. Quadros com mais de 1,5 segundo retornam HTTP 503.

## Limites reais

Esta integração ativa a prévia da Câmera nativa (`previewOnly`). Não afirma suporte a todas as câmeras de terceiros, fotos ou vídeos gravados. Captura nativa/recording do bridge anterior é experimental e não foi habilitada. Ainda exige validar imagem no iPhone após instalar e abrir a Câmera. O APK Android não se aplica ao iPhone.

## Verificações executadas

- Regressão: o ID de iPhone não consulta ADB/APK.
- Relé: HTTP 503 sem quadro; 200 com JPEG; 503 com quadro antigo; fechamento da porta.
- Túnel reverso real confirmado por SSH no iPhone conectado.
- Sintaxe do serviço e do bundle JavaScript.
- Compilação arm64/rootless do OBSGraphBridge 0.1-30.

## Reservas

A pasta `reservas/` foi apagada; os originais do serviço e do bundle estão em `git show 1b45c3f:MAC/integracao-iphone/reservas/<arquivo>`. `reservas/experimento-nao-utilizado` era um protótipo descartado da abordagem VCamCaptura: não foi instalado nem fazia parte da integração ativa. Os projetos originais em Desktop/jailbreak e Projects não foram alterados.

O DMG antigo não foi reconstruído. Ele não contém esta atualização. Os arquivos corrigidos também estão nesta pasta para reaplicação/revisão.
