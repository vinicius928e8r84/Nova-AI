# Histórico — 15 a 19/11/2026: paridade Mac e Windows, limpezas e plataforma

## Chave de host do iPhone: accept-new em todo lugar (SSH5) — 19/11/2026

- **O que mudou:** o ssh da câmera do iPhone (`ios-camera.js` e `cam-live-iphone.js`) usava `StrictHostKeyChecking=yes`; passou a `accept-new`, igual aos outros 5 pontos (mesmo `BatchMode=yes` e `ConnectTimeout`). `accept-new` grava a chave quando o `known_hosts` do app ainda não tem o aparelho, como os outros 5 pontos. Chave trocada (reset do jailbreak) continua recusada até o Conectar gravar a nova, igual a antes. Nenhuma linha nova de código além do teste.
- **Arquivos:** `app/electron/services/ios-camera.js`, `app/electron/services/cam-live-iphone.js` e as cópias do Mac `integracao-iphone/ios-camera.js`, `integracao-camlive/cam-live-iphone.js`, `integracao-sequestro-cam/ios-camera.patched.js`, `integracao-sequestro-cam/cam-live-iphone.patched.js`; teste novo `integracao-iphone/tests/chave-de-host.cjs` (`node --test`), que também trava `ios-bridge.js`, `idioma-ipc.js` e `physicalMobileService.js`.
- **App instalado no Mac que muda:** `Contents/Resources/app/electron/services/ios-camera.js` e `.../cam-live-iphone.js` (guardar os anteriores em `~/Nova-AI-reservas/`, copiar de `app/electron/services/ios-camera.js` e `app/electron/services/cam-live-iphone.js`, nunca das cópias em `MAC/`, que são mais velhas; reiniciar o Nova).
- **Sem testar:** iPhone, Mac e Windows reais; o teste só confere as opções nos arquivos.

## Cópias congeladas apagadas (C2, passos 1, 3 e 4 parciais) — 19/11/2026

- **O que mudou:** apagadas cópias sem consumidor: os dois `*.antes-proxy-20261104-193310` (−6.881 linhas), `MAC/controle-celular-plataformas/geo-proxy/aplicado/*`, `MAC/encerramento-nova/{main.js,original/}` (inclui o executável Mach-O e `CodeResources`), `MAC/integracao-kling/main.js`, `MAC/integracao-modelo-app/main.modelo.js`, `MAC/integracao-iphone/physicalMobileService.patched.js` e `MAC/integracao-sequestro-cam/physicalMobileService.patched.js`. O git guarda a história. Fora do escopo: `reservas/`, `backup-*`, mp4, `backup-antes-traducao/`.
- **Teste:** `MAC/integracao-modelo-app/novamodel.test.cjs` passou a exigir `app/electron/services/physicalMobileService.js` (mesmas 30 verificações). `linha-de-base.json` perdeu 8 entradas. READMEs de `MAC/` ajustados para apontar para `app/`.
- **Arquivos do app instalado no Mac que mudam:** nenhum. Nada em `app/` com efeito em execução foi alterado, só dois arquivos mortos apagados. Nada a reaplicar.
- **Sem testar:** build/empacotamento do instalador (a exclusão `!**/*.antes-proxy-*` de `app/package.json` ficou, inofensiva); Mac e Windows reais. `geo-proxy/README.md` deixou de citar `aplicado/`. A exclusão `!**/*.antes-proxy-*` fica para um PR seguinte (`package.json` é ALTA).

## LEIA-ME sem seções duplicadas (AC6 passo 1) — 19/11/2026

- **O que mudou:** removidas 98 seções que eram cópias exatas de outra já presente (resíduo de merges que colaram os mesmos blocos de novo; inclui 5 títulos `#` repetidos). Das 140 seções, ficaram 42, cada uma com texto igual ao anterior. Só mudou este arquivo (de 1.579 para cerca de 450 linhas); nenhum código.
- **Arquivos do app instalado no Mac que mudam:** nenhum.
- **Sem testar:** nada além da checagem de que todo trecho original continua presente.

## Plataforma: C1 passos 1 e 2 — 19/11/2026

- **O que mudou:** `yt-dlp`/`ffmpeg` (e `.exe`) deixam de ser decididos por `process.platform` em `ytdlp-manager.js` (10 ramos), `global-spoof-service.js` (o cálculo à mão do caminho do ffmpeg virou `tool-paths.ffmpeg()`) e `kling-video-service.js` (lista com os dois nomes); passam a usar `tool-paths.exe()`. Em `main.js`, o remux usa `tool-paths.ffmpeg()`, o ícone é escolhido uma vez (`tool-paths.iconFile()`, antes duplicado) e o fallback da pré-escuta de voz (`exec('start ...')`/`shell.openPath`) foi apagado: ele abria o arquivo depois de já apagá-lo e nunca tocava nada, nos dois sistemas. Mac e Windows mantêm o mesmo resultado; no Linux deixa de procurar `.exe`.
- **Arquivos do app instalado no Mac que mudam:** `main.js`, `services/tool-paths.js`, `services/ytdlp-manager.js`, `services/global-spoof-service.js`, `services/kling-video-service.js`. Guardar os anteriores em `~/Nova-AI-reservas/` antes de trocar; validar com `node --check` e reiniciar o Nova.
- **Testes:** `node --test MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs` simula `darwin` e `win32` (ícone, yt-dlp, ffmpeg) e confere no fonte que spoof e pré-escuta não voltaram ao caminho à mão.
- **Sem testar:** exportação com remux, download com yt-dlp e câmera virtual em Mac e Windows reais; fica para a prova real.

## Limpeza do Chrome órfão do CAM spoof no Mac (M1 da paridade) — 19/11/2026

- **O que mudou:** `startHijack` (`global-spoof-service.js`) no `darwin` agora roda `pkill -f` com `MAC_CAM_SPOOF_KILL_PATTERN` (`paridade-utils.js`) e não tenta mais `wmic`/PowerShell, que falhavam e gravavam "Failed to run Chrome cleanup". O padrão é ancorado no executável `…/Contents/MacOS/(Google Chrome|Chromium)` e exige `--use-file-for-fake-video-capture=` apontando para `…/nova_webcam_hijack/`: o Y4M do CAM spoof fica nessa pasta, enquanto o perfil fica em `farm_profiles`, então `--user-data-dir` nunca casaria. Um Chrome pessoal, um `bash`/`node` com o mesmo texto e a pasta `nova_webcam_hijack_outro` não casam. Windows não mudou.
- **Arquivos do app instalado a trocar** (guardar o anterior em `~/Nova-AI-reservas/`): `app/electron/services/global-spoof-service.js` e `app/electron/services/paridade-utils.js`, para `/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services/` (`cp`). Depois `node --check` nos dois e reiniciar o Nova. O bundle não muda.
- **Também:** o resultado do `pkill` passa a ser logado quando falha (status > 1 ou timeout); removidos `this.profileDir` e sua criação (pasta `…/nova_webcam_hijack/chrome_profile` que ninguém usava, nos dois sistemas) e o comentário que falava de `chrome.exe`.
- **Testado:** `node --test app/test/paridade-b.test.js` (processos falsos no Linux, `pkill` real) e `node --check`. **Sem testar:** Mac real com o CAM spoof aberto e um Chrome órfão de verdade.

## Limpeza de comentários em main.js e preload.js — 16/11/2026

- **O que mudou:** apagados comentários que só narram o código, banners de seção, código morto comentado (DevTools em dev, adblocker) e resíduos de edição por IA (`// ... existing apis ...`, hedges em `get-ytdl-stats` e `sendReply`). Nenhum comportamento mudou: tokens e AST de `preload.js` idênticos; em `main.js` a única diferença são dois laços de espera ativa cujo corpo `{ /* busy wait */ }` virou `;`.
- **Arquivos:** `app/electron/main.js`, `app/electron/preload.js`. Mantidos: âncoras `CAMLIVE:begin/end`, comentários de porquê, contratos e segurança.
- **Sem testar:** o app instalado não foi atualizado nem reiniciado.

## plutil → biblioteca JS para idioma/região (PR-E, I4) — 15/11/2026

`iosBuildLocalePlist` e `iosPlistLanguage` (`physicalMobileService.js`) deixam de chamar `/usr/bin/plutil` direto e passam por `app/electron/services/plist-prefs.js`. No `darwin` o módulo executa os mesmos comandos `plutil` de antes, na mesma ordem (o caminho do Mac não muda). No `win32` lê/grava o `.GlobalPreferences.plist` com `plist` (XML) e `bplist-parser` (binário); o arquivo gravado é XML, como o `plutil -convert xml1` já fazia. `bplist-creator` entra só para os testes. Arquivos: `app/electron/services/plist-prefs.js`, `physicalMobileService.js`, `app/package.json`, `app/package-lock.json`, testes em `app/electron/services/testes/` (`node --test app/electron/services/testes/plist-prefs.test.js`, com plist de exemplo em `fixtures/`).

**Testado:** `node --check` e 4 testes unitários isolados em Linux (XML e binário no ramo win32; comandos do ramo darwin conferidos com `execFile` simulado). **Sem teste real:** Mac, Windows e iPhone — falta aplicar/reverter idioma + fuso num aparelho nos dois sistemas. Não unificamos o Mac para JS.

## Resolvedor de ferramentas por sistema (tool-paths.js) — 15/11/2026

Novo módulo `app/electron/services/tool-paths.js`: devolve `ssh`/`scp`/`ssh-keygen` (Mac `/usr/bin/…`; Windows `%SystemRoot%\System32\OpenSSH\….exe`), `ffmpeg` (com `.exe` e `path.delimiter` no Windows), as ferramentas de `ios-tools` (com `.exe` no Windows), `GlobalKnownHostsFile` (`/dev/null` no Mac, `NUL` no Windows) e caminhos do `-i`/`UserKnownHostsFile` com `/` no Windows. No Mac o resultado é exatamente o de antes.

Trocados: `/usr/bin/ssh` fixo em `ios-bridge.js`, `ios-camera.js`, `cam-live-iphone.js`, `idioma-ipc.js`, `physicalMobileService.js` (também `/usr/bin/scp`); `/usr/bin/ssh-keygen` em `iphone-setup/setup.js`; `mac-native.tool('ffmpeg')` em `ios-camera.js`, `cam-live-iphone.js` e `rtmp-server.js` (que no Windows passa a procurar também no `PATH`, além de `resources\bin\ffmpeg.exe`); `ios-tools.js` e `iphone-ssh.js` usam o módulo. Arquivos do app instalado a trocar (guardar o anterior em `~/Nova-AI-reservas/`): esses nove mais `tool-paths.js`; reaplicar com `cp` para `/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services/`.

**Testado:** `node --check` e `MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs` (simula `darwin`/`win32` no Linux; compara `ffmpeg()` com `mac-native.tool('ffmpeg')`). **Sem teste real:** Mac com iPhone (Conectar, abrir controle, CAM LIVE, idioma), Windows e OpenSSH do Windows. Teste de regressão no Mac é obrigatório antes de unir.

## Tela "Controle de Acesso" removida (Mac e Windows) — 15/11/2026

- **O que era:** modal (`VX` no bundle) que pedia a chave de API do Gemini e a gravava em `secret_key.json`. Abria sozinho na inicialização quando `get-gemini-token` voltava vazio. Não é licença: `license:verify` segue como stub local.
- **O que mudou:** no bundle, `xI||j(!0)` foi removido do callback de `get-gemini-token`. Nenhum outro caminho abre o modal (ele virou código morto); o app abre direto. Sem chave, as funções do Gemini falham até a chave ser informada em Configurações.
- **Arquivos:** `app/dist/assets/index-Dun7lr2S.js` e `MAC/integracao-iphone/conexao-usb/dist/index-Dun7lr2S.patched.js`; docs `docs/windows.md` e `app/README.md`. `main.js` não mudou.
- **Qual copiar no Mac:** `MAC/integracao-iphone/conexao-usb/dist/index-Dun7lr2S.patched.js` (tem os `<audio>` da tela de boot que o bundle de `app/dist` não tem). O de `app/dist/assets/` vale para `npm start` e `npm run dist:*`.
- **Cópias antigas que ainda trazem a tela (não copiar para o app):** `MAC/integracao-iphone/index-Dun7lr2S.patched.js`, `MAC/controle-celular-plataformas/index-Dun7lr2S.patched.js`, `MAC/integracao-sequestro-cam/index-Dun7lr2S.patched.js`, `MAC/integracao-kling/index-Dun7lr2S.js`, `MAC/traducao-interface/index-Dun7lr2S.js`, `MAC/traducao-interface/backup-20261104-122239/index-Dun7lr2S.js`, `backup-antes-traducao/index-Dun7lr2S.js` e as de `reservas/`. Rodar `MAC/integracao-sequestro-cam/patch_bundle.py` com uma origem antiga também traz a tela de volta.
- **Sem testar:** abertura real do Electron (Mac/Windows) e `NOVA_SMOKE_TEST=1`; ao aplicar no Mac, abrir uma vez sem `secret_key.json`.

## Paridade Mac × Windows — correções pequenas (PR-B) — 15/11/2026

- `app/wake_word_bg.py`: o microfone por `sounddevice` deixou de ser só do Mac; vale em qualquer sistema (se `sounddevice` não carregar, cai no `sr.Microphone()` de antes). No Mac com microfone funcionando nada muda; sem microfone ou com o stream recusado, o traceback vira INFO e a escuta fica desabilitada.
- `app/electron/main.js`: o `edge-tts` do Windows passa a rodar por `python -m edge_tts` (o Mac continua com `"<python do Nova>" -m edge_tts`). O `autoUpdater` (verificação ao abrir, `check-for-update`, `download-update`, `install-update`) só é chamado se existir `resources/app-update.yml`; o Mac já não usava atualização.
- `app/electron/services/agent-swarm-controller.js`: download direto de URL (fallback sem yt-dlp) agora usa `http`/`https` do Node, sem PowerShell. Passa a funcionar no Mac; segue redirecionamentos e informa progresso.
- `app/electron/services/whatsapp-manager.js`: `killSessionBrowserProcesses()` também limpa no Mac (`pkill -f --` com o padrão `MAC_BROWSER_KILL_PATTERN` de `paridade-utils.js`, ancorado no executável `.../Contents/MacOS/Google Chrome` ou `Chromium` e em `--user-data-dir=<...>/.wwebjs_auth/session-nova-desktop-client`, aceitando espaço no caminho como `Application Support`) o Chrome que sobrou da sessão do WhatsApp; processos que não sejam Chrome/Chromium (shell, editor, grep) não casam. `wake_word_bg.py`: sem dispositivo de entrada (`sounddevice.query_devices(kind='input')` falha) ou com falha ao abrir o stream vira INFO "desabilitado" em vez de traceback (no Mac sem microfone isso também troca o traceback por INFO). Novo comportamento de limpeza no Mac.
- Novo `app/electron/services/paridade-utils.js` (`hasUpdateConfig`, `edgeTtsBinary`, `downloadFile`) e teste `app/test/paridade-b.test.js` (`node --test app/test/paridade-b.test.js`).

**Aplicar no app instalado (AGENTS §5):** copiar para `/Applications/Nova AI Mac.app/Contents/Resources/app/` (ou o `app.asar` desempacotado equivalente), guardando antes o anterior em `~/Nova-AI-reservas/`: `electron/main.js`, `electron/services/agent-swarm-controller.js`, `electron/services/whatsapp-manager.js`, **`electron/services/paridade-utils.js` (arquivo novo)** e `wake_word_bg.py`. O `main.js` faz `require('./services/paridade-utils')` no topo: copiar só o `main.js` impede o app de abrir (MODULE_NOT_FOUND). Depois: `node --check` em cada um e reiniciar o Nova.

Correção de revisão: `downloadFile` rejeita redirecionamento para protocolo que não seja `http:`/`https:` e `Location` inválida, e captura erro síncrono de `client.get`, sem exceção não capturada.

**Testado (Linux, sem Mac/Windows/iPhone):** `node --check` nos arquivos tocados; testes unitários com `app-update.yml` ausente/presente, `edge_tts` por plataforma e download com redirecionamento/404 contra servidor local; `wake_word_bg.py` carregado com `sounddevice` presente/ausente simulando `win32`/`darwin`/`linux`; `pkill -f --` com o padrão novo contra processos falsos (com caminho `~/Library/Application Support/Nova AI/.wwebjs_auth/...` com espaço, Chromium da sessão e Google Chrome da sessão morrem; Chromium de outro perfil, bash e node com o texto na linha de comando ficam vivos); `wake_word_bg.py` com `sounddevice` sem dispositivo (INFO desabilitado). **Sem teste real:** microfone/wake word no Windows, TTS no Windows, download no Mac, `pkill` no macOS (BSD), app empacotado sem `app-update.yml`.

**Fora deste PR (follow-up):** remover `*.antes-proxy-*` do git e do pacote (item vi do plano).

## Menu e encerramento no Windows (PR-C da paridade) — 15/11/2026

No Windows a janela agora tem o menu do Mac sem os itens exclusivos do macOS (Nova AI com Exit, Editar, Visualizar com Ctrl+R e DevTools); fica sem Janela de propósito, para Ctrl+W e Ctrl+M não fecharem nem minimizarem o Nova por reflexo; a barra continua escondida e aparece com Alt. Ao sair no Windows e no Linux (fechar a última janela, Exit no menu ou Sair do Nova na bandeja; a parada roda em `before-quit`, uma vez só; o app espera ela terminar por até 2 s e sai mesmo se algum serviço travar, como no Mac), além de `stopWindowServices`, também são parados `ios-bridge`, CAM LIVE (iPhone e serviço), `live-cam-bridge`, difusão e servidor RTMP e a checagem do Telegram, a mesma lista que o Mac já usava. No Mac nada muda: o menu e a lista de parada são os mesmos, só passaram para `app/electron/services/nova-desktop-parity.js`.

Arquivos: `app/electron/main.js`, `app/electron/services/nova-desktop-parity.js` (novo), `app/electron/services/test/nova-desktop-parity.test.js` (novo; `node --test app/electron/services/test/nova-desktop-parity.test.js`). Para reaplicar no app instalado do Mac: copiar `main.js` e `nova-desktop-parity.js` para `Resources/app/electron/` (guardar o anterior em `reservas/`) e reiniciar o Nova.

**Não testado:** Windows real (menu na tela, Ctrl+R, DevTools, processos `iproxy`/`ffmpeg`/Chrome no Gerenciador de Tarefas após fechar), Mac real e iPhone. No Windows não há limpeza de processos filhos por varredura como no Mac (`nova-shutdown.js` usa `/bin/ps`); só os serviços listados são parados.

## Correções do passo a passo no Windows — 15/11/2026

Teste real no Windows deu "funciona com ajustes". Corrigido: `app/package.json` (removidos `@electron/rebuild` e `@electron/packager`, que puxavam `node-gyp` via git; `postinstall` agora chama `app/scripts/postinstall.js`, que usa binários prebuilt do `better-sqlite3` se não houver compilador C++; `dist:win` com `--config.npmRebuild=false`), `app/package-lock.json` regerado sem dependência git, `docs/windows.md` (`git clone -c core.symlinks=false`, estado dos testes, Node 24.15 funcionou), `app/.gitignore` (`data/`) e removidos os 13 symlinks `.macho` de `MAC/integracao-iphone/distribuicao/inspecao-binarios/`. `postinstall.js`: no Mac a falha do `install-app-deps` continua fatal (só Windows/Linux usam o prebuilt) e erro no fallback agora sai com código ≠ 0; `inspecao-binarios/` no `.gitignore`. **Sem testar:** `npm install` + `npm start` no Mac (só `npm ci --ignore-scripts` no Linux); `ios-bridge` só no Mac e `app-update` ficam como pendência.

