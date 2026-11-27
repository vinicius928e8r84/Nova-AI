# Histórico — 15 a 19/11/2026: paridade, correções do Windows e processos

## 2026-11-15 — PR-A de paridade: o iPhone não derruba o Windows

- **O que mudou:** `ios-tools.js` ganhou `tryTool()`, `has()` e `available()` (não lançam; `tool()` segue igual). `getIosDevices()` devolve `[]` se as ferramentas do iPhone faltarem ou algo lançar, então `getStatus()` não rejeita e a lista Android continua. `ios-bridge.start()` devolve `{ ok: false }` sem ferramentas (sem `iproxy`, sem `UnhandledPromiseRejection`). O item "Console do iPhone" da bandeja só aparece quando as ferramentas existem; o IPC `ios-console-url` devolve o erro em vez de abrir página vazia.
- **Arquivos:** `app/electron/main.js`, `app/electron/services/ios-tools.js`, `ios-bridge.js`, `physicalMobileService.js`, `ios-devices.js` (novo: a listagem de aparelhos saiu de `physicalMobileService.js` para o arquivo grande não crescer); teste novo `MAC/integracao-iphone/tests/ferramenta-ausente.cjs` (`node --test`).
- **Mac:** com as ferramentas empacotadas, o comportamento é o mesmo. Só num Mac sem `ios-tools` o item da bandeja some.
- **Sem testar:** Mac, Windows e iPhone reais; `getStatus()` foi testado com o `getConnectedDevices` real e um `adb` falso que lista um aparelho Android.

## 2026-11-19 — E1a: atualizador igual no Windows e no Mac

- **O que mudou:** `main.js` não desliga mais o atualizador no Mac. Saíram as duas guardas `process.platform === 'darwin'` dos IPCs de atualização, o `process.platform !== 'darwin' &&` da checagem na abertura e 4 linhas mortas no topo (flags de assinatura e `console.log`). A decisão passa só por `hasUpdateConfig()`: sem `publish`, nada muda em nenhum dos dois. `docs/windows.md` corrigido.
- **Arquivos:** `app/electron/main.js`, `docs/windows.md`. Saldo de `main.js`: −7 linhas. Teste novo em `app/test/paridade-b.test.js` trava o ramo por sistema nos IPCs de atualização.
- **Arquivos do app instalado que mudam no Mac:** `/Applications/Nova AI Mac.app/Contents/Resources/app/electron/main.js` (o app não usa `app.asar`: `asar: false`). Guarde o anterior em `~/Nova-AI-reservas/`; reaplique com `cp app/electron/main.js "/Applications/Nova AI Mac.app/Contents/Resources/app/electron/main.js"`, `node --check` e reinicie o Nova.
- **Testado:** `app/test/paridade-b.test.js` no Mac real e no Windows real; um `Nova AI.app` empacotado no Mac real sem `Contents/Resources/app-update.yml`, que abre normalmente e sem erro de atualizador no log.
- **Sem testar:** o caminho com feed, no Mac e no Windows (`check-for-update`, `download-update` e `install-update` com um `app-update.yml` de verdade); se `/Applications/Nova AI Mac.app/Contents/Resources/app-update.yml` existe no app instalado.

## 2026-11-19 — M3 de paridade: navegador no Mac procura nos mesmos lugares do Windows

- **O que mudou:** `mac-native.browser(tipo)` também procura o `.app` embutido em `<resources>/browsers/<tipo>/<Nome>.app` e na pasta `browsers` do projeto (Brave, Vivaldi, Firefox, Edge e Chrome), como o Windows. O WhatsApp no Mac respeita `PUPPETEER_EXECUTABLE_PATH` (se o arquivo existir), depois o Chromium de `<userData>/browsers` (como o Windows), depois Chrome e por fim o Edge. A limpeza do navegador órfão do perfil do WhatsApp (`MAC_BROWSER_KILL_PATTERN`) agora também mata o Microsoft Edge da sessão, como o Windows já faz com `msedge.exe`. `userData/browsers` vale só para o Chromium do WhatsApp, nos dois sistemas; a fazenda, o CAM spoof e o navegador do app não o usam em nenhum. Removido: a pasta `userData/browsers` da busca geral de navegadores do Mac (a rodada anterior do próprio PR a tinha posto).
- **Arquivos do app instalado que mudam:** `app/electron/services/mac-native.js`, `app/electron/services/whatsapp-manager.js` e `app/electron/services/paridade-utils.js` (em `/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services/`; guarde os anteriores em `~/Nova-AI-reservas/` e rode `node --check` nos três). Não muda `main.js`, `preload.js` nem o bundle da interface. Teste novo: `MAC/navegador-mac/tests/navegador.cjs` (`node --test`, isola `/Applications` e `playwright`, então passa em Mac com navegadores instalados); o teste do `pkill` em `app/test/paridade-b.test.js` ganhou o Edge. `navegador.cjs` também testa o ramo do Windows do WhatsApp (Chromium de `userData/browsers`) e zera o cache do `platform-utils` ao trocar a plataforma.
- **Sem testar:** Mac real; navegador `.app` real embutido ou em `userData`; só pastas falsas em Linux.

## 2026-11-19 — ISS14: aviso quando o WhatsApp falha 8 vezes ao iniciar

- **O que mudou:** ao atingir o limite de 8 tentativas (`reconnect-limit-reached`), o app abre um aviso com a permissão a conferir (Mac: Gerenciamento de apps e Microfone; Windows: firewall, antivírus e pasta de dados; outros: aviso genérico) e o texto vai também no campo `hint` do evento de status. Mesma detecção nos dois sistemas; só o texto muda.
- **Arquivos do app instalado no Mac que mudam:** `Contents/Resources/app/electron/services/whatsapp-manager.js` e `whatsapp-aviso.js` (novo). Guarde o `whatsapp-manager.js` anterior em `reservas/` e reaplique com `cp`.
- **Correções da revisão:** o aviso não abre mais duas vezes quando a última tentativa termina por tempo esgotado (`init-timeout`), porque a rejeição atrasada do `initialize()` de uma tentativa já abandonada pelo timeout agora é ignorada (`this.client !== cliente`) e a trava frágil por `statusReason` saiu (teste `rejeicao-tardia` em `whatsapp-limite.test.js`); falha ao exibir o aviso (síncrona ou Promise rejeitada) agora é registrada no log com `[WhatsApp]`; o número de tentativas do texto vem de `maxReconnectAttempts`. Reinício manual continua avisando de novo.
- **Teste:** `node --test app/electron/services/test/whatsapp-aviso.test.js app/electron/services/test/whatsapp-limite.test.js` (o segundo carrega o `whatsapp-manager.js` real com `whatsapp-web.js` e `electron` falsos).
- **Sem testar:** Mac e Windows reais; o aviso nunca foi exibido num app em execução, e a causa real da falha no Mac (permissão Gerenciamento de apps) segue sem prova.

## 2026-11-19 — M2 de paridade: "respondendo" real do Antigravity no Mac

- **O que mudou:** `getProcessStats()` no Mac deixou de devolver `responding:true` fixo. `macAntigravityStats()` (em `paridade-utils.js`) acha o PID com `pgrep -x Antigravity`, lê a memória com `ps -p <pid> -o rss=` e marca `responding:false` só quando o AppleScript do System Events estoura 3 s (processo morto por tempo). Outro erro do AppleScript (app aberto sem janela, falta de permissão de Automação) conta como respondendo, com título vazio. `cpu` continua `0` nos dois sistemas, como o PowerShell do Windows (`CPU:0`); ninguém lê esse valor. Sem processo, devolve `null` como o Windows.
- **Arquivos do app instalado no Mac que mudam:** `Contents/Resources/app/electron/services/antigravity-controller.js` e `Contents/Resources/app/electron/services/paridade-utils.js` (guardar os anteriores em `~/Nova-AI-reservas/` antes; depois `node --check` e reiniciar o Nova). Nenhum arquivo do bundle da interface.
- **Teste:** `app/test/paridade-b.test.js` (`node --test`), com `pgrep`, `ps` e `osascript` falsos.
- **Sem testar:** Mac real com Antigravity instalado; o nome do processo `Antigravity` no `pgrep` (se não bater, trocar por `pgrep -f '/Antigravity\.app/Contents/MacOS/'`) e o limite de 3 s do AppleScript; Windows real.

## 2026-11-19 — P8 de paridade: Python embutido e PATH iguais nos dois sistemas

- **O que mudou:** `mac-native.python()` virou `app/electron/services/python-runtime.js` (`python()` e `pathComBin()`). Mac: mesma ordem de antes (`python-runtime-portable/run-python`, `python-env/bin/python3`, `python3`). Windows: `resources\python\python.exe`, senão `python` do PATH. O PATH do processo ganha `resources\bin` também no Windows. Os três processos Python (wake word, YouTube Auto, enxame de agentes) passam `windowsHide: true` (sem efeito no Mac). `app/README.md` descreve o Python do Windows. O YouTube Auto no `main.js` passou a usar o Python resolvido em vez de `python` solto (no Mac `python` nem existia). `edgeTtsBinary` usa o Python resolvido nos dois. Removido: `python()` de `mac-native.js` e `pathForBin()` do `main.js`.
- **Arquivos do app instalado no Mac que mudam:** `Contents/Resources/app/electron/main.js`, `electron/services/python-runtime.js` (novo), `electron/services/mac-native.js`, `electron/services/paridade-utils.js`, `electron/services/agent-swarm-controller.js`. Guardar os anteriores em `~/Nova-AI-reservas/`, copiar com `cp` do repositório, `node --check` e reiniciar o Nova. Sem mudança no bundle da interface.
- **Sem testar:** Mac e Windows reais; wake word com microfone e TTS com o Python embutido; a receita do `resources\python` em `docs/windows.md` não foi executada.

## 2026-11-19 — P4 de paridade: mensagens de celular sem "Mac"

- **O que mudou:** só o texto. "no Mac"/"neste Mac"/"e o Mac" viraram "neste computador" nas mensagens do iPhone e do Android (câmera, GPS, Conectar, IP da rede); a dica do `instalar-iphone.command` saiu do erro do bridge. Nada removido além dessa citação; nenhuma lógica mudou.
- **Arquivos do app instalado que mudam** (em `/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services/`; guardar o anterior em `~/Nova-AI-reservas/` antes): `ios-camera.js`, `physicalMobileService.js`, `iphone-setup/inapp.js`, `iphone-setup/setup.js`. Reaplicar com `cp` desses quatro; depois `node --check` e reiniciar o Nova. O bundle da interface não muda.
- **Teste:** `node --test app/electron/services/testes/textos-celular.test.js`.
- **Sem testar:** Mac e Windows reais; ver as mensagens na tela.

## 2026-11-19 — P10: `cloudflared` no Windows também em `resources\bin\` e no PATH

- **O que mudou:** `remote-access.js` procura o `cloudflared` com `tool-paths.tool()` nos dois sistemas (antes: Mac por `mac-native.tool`, Windows só `resources\cloudflared.exe`). `resources\cloudflared.exe` segue como último recurso no Windows. Nada foi removido além do ramo `darwin` do ternário (1 linha trocada por 2).
- **Arquivos do app instalado no Mac que mudam:** `Contents/Resources/app/electron/services/remote-access.js` (guarde o anterior em `~/Nova-AI-reservas/`; reaplicar com `cp`). Nenhum outro.
- **Mac:** mesma ordem de pastas (`resources/bin`, Homebrew, PATH); comportamento igual. O túnel segue desligado por padrão (`NOVA_REMOTE_TUNNEL=1`).
- **Teste:** `app/electron/services/testes/cloudflared-caminho.test.js` (`node --test`, com `exists` falso).
- **Sem testar:** Windows e Mac reais, túnel real da Cloudflare.

## Varredura de processos órfãos ao sair, no Windows (P7 da paridade) — 19/11/2026

No Windows, **durante a saída**, o Nova agora faz o que o Mac já fazia com os filhos: `createWindowsProcessCleanup` (em `app/electron/services/nova-shutdown.js`) lê a tabela de processos por `Get-CimInstance Win32_Process` (`ProcessId`, `ParentProcessId`, `CommandLine` e a hora de criação) uma vez antes de parar os serviços e de novo em cada rodada de `terminate` (até 3), e encerra com `taskkill /T /F /PID` só as árvores cuja raiz é uma ferramenta que o próprio Nova inicia (`ffmpeg`, `ffprobe`, `scrcpy`, `adb`, `iproxy`, `ssh`, `python`, `cmd`, `powershell`, `node`, `yt-dlp`, `cloudflared`, e `chrome`/`msedge` só com `--remote-debugging`). Navegador aberto por `shell.openExternal`, app aberto por `shell.openPath`, instalador da atualização e o Antigravity sobrevivem, como no Mac, onde esses processos nascem do `launchd`. Não há varredura periódica (um PowerShell síncrono a cada 75 ms congelaria o processo principal). Ficam de fora os helpers do Electron (`--type=`), o PowerShell da varredura e os filhos dele. A hora de criação do pai e do filho evita matar um processo alheio cujo `ParentProcessId` aponta para um PID reaproveitado. No `main.js` o Windows passa a usar `registerShutdown` com essa limpeza, no lugar de `guardBeforeQuit`; Linux segue com `guardBeforeQuit`.

**Limites:** só pega o que ainda é descendente do Nova na saída. Órfão anterior à saída (por exemplo o daemon do `adb`, que o Mac mata pelo marcador `NOVA_PROCESS_OWNER`) não é coberto no Windows. Ferramenta do Nova que não esteja na lista acima fica órfã (comportamento anterior).

Arquivos: `app/electron/main.js`, `app/electron/services/nova-shutdown.js`, `app/electron/services/test/nova-shutdown-windows.test.js` e `nova-shutdown-mac.test.js` (novos; `node --test app/electron/services/test/*.test.js`).

Arquivos do app instalado no Mac que mudam: `Resources/app/electron/main.js`, `Resources/app/electron/services/nova-shutdown.js` (só o ramo do Windows muda). Guardar os anteriores em `~/Nova-AI-reservas/`, copiar, `node --check` em cada, reiniciar o Nova. No Mac o comportamento é o mesmo; copiar é opcional.

**Sem testar:** Windows real (PowerShell, `taskkill`, a lista de ferramentas contra os `spawn` reais, Gerenciador de Tarefas, tempo de saída), Mac e iPhone. Testado no Linux só com tabela simulada.

## 2026-11-19 — E2: permissão de câmera no lugar do PnP

- **O que mudou:** o IPC `enable-physical-cameras` deixou de rodar PowerShell/`Get-PnpDevice` (só Windows, exigia administrador) e passou a conferir a permissão de câmera do sistema (`systemPreferences.getMediaAccessStatus`). Negada ou restrita: abre os Ajustes de privacidade de câmera (Mac: `Privacy_Camera`; Windows: `ms-settings:privacy-webcam`). Mac com permissão ainda não decidida: pede a permissão ao sistema. Removidos o `disableAllPhysicalCams()` do `hijack` e os dois métodos vazios `disableAllPhysicalCams`/`enableAllPhysicalCams` do `global-spoof-service.js`. Saldo: `main.js` −39 linhas, `global-spoof-service.js` −2.
- **Arquivos do app instalado no Mac que mudam** (reaplicar com `cp` dentro de `/Applications/Nova AI Mac.app/Contents/Resources/app/electron/`; guarde os antigos em `~/Nova-AI-reservas/`):
  - `main.js` ← `app/electron/main.js`
  - `services/global-spoof-service.js` ← `app/electron/services/global-spoof-service.js`
  - `services/camera-acesso.js` (novo) ← `app/electron/services/camera-acesso.js`
  - O bundle da interface não muda (ignora a resposta do IPC). Reiniciar o Nova.
- **Teste:** `node --test app/electron/services/test/camera-acesso.test.js` (estados × Mac/Windows, com mocks).
- **Sem testar:** Mac e Windows reais. Prova pendente: no Mac, negar a câmera ao Nova em Ajustes, abrir a câmera no Nova e ver os Ajustes abrirem; no Windows, desligar "apps da área de trabalho" e repetir.

## 2026-11-19 — D1 de paridade: `adb reverse` do RTMP com o `adb` do app

- **O que mudou:** `rtmp:start-broadcast` passa `app.physicalMobileService.adbPath` para `startBroadcast()`, que roda `adb reverse tcp:1935 tcp:11935` com esse binário (`execFile`, argumentos separados) em vez do `adb` do PATH. Sem caminho, ou com caminho que não existe no disco, cai no `adb` do PATH como antes. Vale para Mac e Windows, sem ramo por sistema; `windowsHide` evita a janela de console no Windows.
- **Arquivos do app instalado no Mac que mudam:** `Contents/Resources/app/electron/main.js` e `Contents/Resources/app/electron/services/rtmp-server.js` (guarde os anteriores em `~/Nova-AI-reservas/` antes de trocar; depois `node --check` e reinicie o Nova). O bundle da interface não muda.
- **Teste:** `app/test/rtmp-adb.test.js` (`node --test`).
- **Sem testar:** aparelho Android real recebendo o RTMP; Mac e Windows reais.

## 2026-11-19 — P1 de paridade: ferramentas do iPhone no Windows

- **O que mudou:** receita nova `MAC/integracao-iphone/distribuicao/empacotar-ferramentas-windows.sh` (shell MSYS2 UCRT64: instala `libimobiledevice`, `libusbmuxd` e `ideviceinstaller` com `pacman`, limpa `app/resources/ios-tools/bin/`, copia `iproxy`, `idevice_id`, `ideviceinfo`, `ideviceinstaller` `.exe` e as DLLs de `/ucrt64/bin` e grava `manifest.sha256`; falha de `ldd`, `cp` ou DLL `not found` aborta). `docs/windows.md` §4 e `app/README.md` deixaram de dizer "só Mac" e avisam que o driver USB da Apple (Apple Devices ou iTunes) precisa estar instalado no PC. Nenhum código do app mudou.
- **Arquivos do app instalado no Mac que mudam:** nenhum.
- **Sem testar:** a receita num MSYS2 real, Windows com iPhone e Apple Devices reais, Mac real.

