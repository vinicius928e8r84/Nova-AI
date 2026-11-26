# Os defeitos achados e as fontes

Parte da pesquisa [O corte do `global-spoof-service.js`](README.md).

## 7. Achados à parte (para consertos fora dos cortes)

Os cortes mantêm tudo isto igual, e a caracterização congela cada item como está. Cada um vira conserto de bug numa PR própria, que o mapa permite. Os seis viraram issues com o rótulo `bug`, sem dependência entre elas:

- [CAM spoof: o perfil Default derruba o startHijack com TypeError (tLocale undefined)](https://github.com/vinicius928e8r84/Nova-AI/issues/168)
- [CAM spoof: o Chrome 157 ignora --load-extension e a primeira página às vezes abre sem disfarce](https://github.com/vinicius928e8r84/Nova-AI/issues/169)
- [CAM spoof: a limpeza do Chrome órfão no Windows nunca funciona (wmic ausente e aspas do PowerShell)](https://github.com/vinicius928e8r84/Nova-AI/issues/170)
- [CAM spoof: o rótulo da câmera na lista de dispositivos não bate com o da trilha do getUserMedia](https://github.com/vinicius928e8r84/Nova-AI/issues/171)
- [CAM spoof: a proteção contra varredura de portas fica desligada quando o perfil não tem o campo](https://github.com/vinicius928e8r84/Nova-AI/issues/172)
- [CAM spoof: o áudio falso não toca sem audioPath, o WAV de ambiente chega tarde e o stopHijack chama taskkill no Mac](https://github.com/vinicius928e8r84/Nova-AI/issues/173)

O detalhe de cada um:

1. **O perfil `Default` derruba o `startHijack`.** Com `profile: 'Default'`, o perfil temporário não tem `locale` nem `timezone`. A linha 421 põe `tLocale = undefined` e a linha 445 lança `TypeError: Cannot read properties of undefined (reading 'includes')`. O `regional` não salva, porque o perfil o sobrescreve nas linhas 410 e 421. O IPC devolve o erro para a interface. Reproduzido no passo 3 do roteiro. O `Default` é o primeiro item de `listProfiles`.
2. **O Chrome 157 ignora `--load-extension`.** Testei com uma extensão mínima, que escreve `window.__extensaoRodou = true`, carregada como o serviço carrega a dele: a variável ficou `undefined`. Por isso o disfarce só chega pela via do CDP (`addScriptToEvaluateOnNewDocument` no auto-attach). Essa via corre contra a primeira página, que o Chrome já abre pela linha de comando: em 3 de 4 execuções a primeira carga ficou **sem disfarce**. Numa delas, o rótulo da câmera era o caminho `C:\Users\…\nova_webcam_hijack\fake_cam.y4m` e a GPU não estava trocada. Depois de recarregar, o disfarce estava lá nas três. Isso também torna a prova não determinística: ela tem de ler a página depois de uma navegação feita com o CDP já ligado. Não achei a nota oficial do Chromium sobre a retirada do argumento; o comportamento foi medido aqui.
3. **A limpeza de órfãos no Windows não funciona.** O `wmic` falhou e o PowerShell de reserva também, porque as aspas duplas do filtro estão dentro de um `-Command "…"` também entre aspas duplas (linhas 199-200). O log diz "Failed to run Chrome cleanup" a cada abertura.
4. **O rótulo da câmera não bate.** O `enumerateDevices` mostra o `virtualCamLabel` do perfil (por exemplo, `USB Camera`), e a trilha do `getUserMedia` mostra o rótulo fixo `FaceTime HD Camera` (`iPhone Front Camera` no iPhone, linhas 706-707).
5. **A proteção contra varredura de portas fica desligada por padrão.** O padrão `'enable'` (linha 615) só vale sem perfil ativo, e sempre há perfil ativo (no mínimo o temporário). Um perfil sem `portScanProtection` manda `"undefined"`, e o `fetch` para `localhost` passa.
6. **O áudio.** Sem `audioPath`, `settings.audioPath.replace` (linha 580) lança, o erro é engolido, e nada toca, nem o `afplay` do Mac. O WAV de ambiente é gerado sem esperar o fim (linha 571), então na primeira abertura o Chrome fica sem o áudio falso. O `stopHijack` chama `taskkill` também no Mac (linha 1492), onde o comando não existe; o efeito no Mac não foi conferido.

Uma observação de custo: o Y4M tem cerca de 112 MB por meio segundo de clipe. O `setpts` com `RTCTIME` duplica quadros. Com o disco apertado, isso pesa na prova real e nas máquinas do dono.

## Fontes

- **O código.** `app/electron/services/global-spoof-service.js`, `browserFarmService.js`, `virtual-cam-injector.js`, `mac-native.js` e `app/electron/main.js:1326-1420`, no commit `1b45c3f`; o serviço conferido de novo, sem mudança, em `f87f6ea`. Também `app/dist/assets/index-Dun7lr2S.js` (o payload do `hijack`).
- **As regras.** `scripts/regras/analisador/medir-js.js` e `pontos.js` (a catraca), `scripts/regras/linha-de-base.json:5,23`, `scripts/regras/caminhos-sensiveis.json:6`, `scripts/regras/comentarios.js` (`comentariosJs`), `CONTRIBUTING.md`, `AGENTS.md`.
- **O servidor antigo do painel (projeto 2, análise 141, revisão `1b45c3f4507fb1acea82c12e7898adfe2a72b60e`), lido só na primeira rodada.** As rotas `/api/v2/projects/2/analyses/latest`, `/analyses/latest/files` e `/analyses/141/technical-debt`, e o arquivo de detalhes `code_health_details/c85f26393484b10ab8c6cf045ffa138af706d156.json` da análise. A segunda rodada não consultou esse servidor; a nuvem ainda não tem o projeto.
- **CodeScene.**
  - [Code Health – How it works](https://codescene.io/docs/guides/technical/code-health.html), que aponta para os limites;
  - [What Are the Default Threshold Values for Different Programming Languages?](https://helpcenter.codescene.com/articles/6084507-what-are-the-default-threshold-values-for-different-programming-languages);
  - [default-rules.zip](https://codescene.com/hubfs/Technical%20Support%20Data/default-rules.zip), arquivo `code-health-rules.js.json`.
- **Testes.** `app/test/chromium-revisao-windows.test.js`, `app/test/paridade-b.test.js`, `MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs`, `scripts/regras/test/registro.test.js` e o molde de palco em `app/electron/services/test/browser-manager.*`.
- **A pesquisa irmã.** [O corte do browserFarmService.js](https://github.com/vinicius928e8r84/Nova-AI/issues/129), comentário de resolução.
- **As execuções.** Node 24.15.0, Chrome 157.0.8103.80, ffmpeg 8.1 e `chrome-remote-interface` 0.34.0 (instalado numa pasta temporária fora do repositório), no Windows 11, em 23/11. Em 25/11: a catraca de novo (`medirJs` e `pontuar`, 1.584 pontos: `startHijack` 1.435, `ensureProfileStealthSpecs` 79, `_findChrome` 66, `stopHijack` 3, o arquivo 1), as seis quebras de propósito de [juiz-e-caracterizacao.md](juiz-e-caracterizacao.md) e o `startHijack` com o perfil `Default`.
- **A decisão do dono.** D39, respondida em 23/11, 14:11 BRT, na mesa do dono.
