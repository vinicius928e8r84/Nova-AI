# Nova AI para macOS (Apple Silicon) — estado do projeto

## Limpeza do Chrome órfão do CAM spoof no Mac (M1 da paridade) — 19/11/2026

- **O que mudou:** `startHijack` (`global-spoof-service.js`) no `darwin` agora roda `pkill -f` com `MAC_CAM_SPOOF_KILL_PATTERN` (`paridade-utils.js`) e não tenta mais `wmic`/PowerShell, que falhavam e gravavam "Failed to run Chrome cleanup". O padrão é ancorado no executável `…/Contents/MacOS/(Google Chrome|Chromium)` e exige `--use-file-for-fake-video-capture=` apontando para `…/nova_webcam_hijack/`: o Y4M do CAM spoof fica nessa pasta, enquanto o perfil fica em `farm_profiles`, então `--user-data-dir` nunca casaria. Um Chrome pessoal, um `bash`/`node` com o mesmo texto e a pasta `nova_webcam_hijack_outro` não casam. Windows não mudou.
- **Arquivos do app instalado a trocar** (guardar o anterior em `reservas/`): `app/electron/services/global-spoof-service.js` e `app/electron/services/paridade-utils.js`, para `/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services/` (`cp`). Depois `node --check` nos dois e reiniciar o Nova. O bundle não muda.
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

Trocados: `/usr/bin/ssh` fixo em `ios-bridge.js`, `ios-camera.js`, `cam-live-iphone.js`, `idioma-ipc.js`, `physicalMobileService.js` (também `/usr/bin/scp`); `/usr/bin/ssh-keygen` em `iphone-setup/setup.js`; `mac-native.tool('ffmpeg')` em `ios-camera.js`, `cam-live-iphone.js` e `rtmp-server.js` (que no Windows passa a procurar também no `PATH`, além de `resources\bin\ffmpeg.exe`); `ios-tools.js` e `iphone-ssh.js` usam o módulo. Arquivos do app instalado a trocar (guardar o anterior em `reservas/`): esses nove mais `tool-paths.js`; reaplicar com `cp` para `/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services/`.

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

**Aplicar no app instalado (AGENTS §5):** copiar para `/Applications/Nova AI Mac.app/Contents/Resources/app/` (ou o `app.asar` desempacotado equivalente), guardando antes o anterior em `reservas/`: `electron/main.js`, `electron/services/agent-swarm-controller.js`, `electron/services/whatsapp-manager.js`, **`electron/services/paridade-utils.js` (arquivo novo)** e `wake_word_bg.py`. O `main.js` faz `require('./services/paridade-utils')` no topo: copiar só o `main.js` impede o app de abrir (MODULE_NOT_FOUND). Depois: `node --check` em cada um e reiniciar o Nova.

Correção de revisão: `downloadFile` rejeita redirecionamento para protocolo que não seja `http:`/`https:` e `Location` inválida, e captura erro síncrono de `client.get`, sem exceção não capturada.

**Testado (Linux, sem Mac/Windows/iPhone):** `node --check` nos arquivos tocados; testes unitários com `app-update.yml` ausente/presente, `edge_tts` por plataforma e download com redirecionamento/404 contra servidor local; `wake_word_bg.py` carregado com `sounddevice` presente/ausente simulando `win32`/`darwin`/`linux`; `pkill -f --` com o padrão novo contra processos falsos (com caminho `~/Library/Application Support/Nova AI/.wwebjs_auth/...` com espaço, Chromium da sessão e Google Chrome da sessão morrem; Chromium de outro perfil, bash e node com o texto na linha de comando ficam vivos); `wake_word_bg.py` com `sounddevice` sem dispositivo (INFO desabilitado). **Sem teste real:** microfone/wake word no Windows, TTS no Windows, download no Mac, `pkill` no macOS (BSD), app empacotado sem `app-update.yml`.

**Fora deste PR (follow-up):** remover `*.antes-proxy-*` do git e do pacote (item vi do plano).

## Menu e encerramento no Windows (PR-C da paridade) — 15/11/2026

No Windows a janela agora tem o menu do Mac sem os itens exclusivos do macOS (Nova AI com Exit, Editar, Visualizar com Ctrl+R e DevTools); fica sem Janela de propósito, para Ctrl+W e Ctrl+M não fecharem nem minimizarem o Nova por reflexo; a barra continua escondida e aparece com Alt. Ao sair no Windows e no Linux (fechar a última janela, Exit no menu ou Sair do Nova na bandeja; a parada roda em `before-quit`, uma vez só; o app espera ela terminar por até 2 s e sai mesmo se algum serviço travar, como no Mac), além de `stopWindowServices`, também são parados `ios-bridge`, CAM LIVE (iPhone e serviço), `live-cam-bridge`, difusão e servidor RTMP e a checagem do Telegram, a mesma lista que o Mac já usava. No Mac nada muda: o menu e a lista de parada são os mesmos, só passaram para `app/electron/services/nova-desktop-parity.js`.

Arquivos: `app/electron/main.js`, `app/electron/services/nova-desktop-parity.js` (novo), `app/electron/services/test/nova-desktop-parity.test.js` (novo; `node --test app/electron/services/test/nova-desktop-parity.test.js`). Para reaplicar no app instalado do Mac: copiar `main.js` e `nova-desktop-parity.js` para `Resources/app/electron/` (guardar o anterior em `reservas/`) e reiniciar o Nova.

**Não testado:** Windows real (menu na tela, Ctrl+R, DevTools, processos `iproxy`/`ffmpeg`/Chrome no Gerenciador de Tarefas após fechar), Mac real e iPhone. No Windows não há limpeza de processos filhos por varredura como no Mac (`nova-shutdown.js` usa `/bin/ps`); só os serviços listados são parados.

## Correções do passo a passo no Windows — 15/11/2026

Teste real no Windows deu "funciona com ajustes". Corrigido: `app/package.json` (removidos `@electron/rebuild` e `@electron/packager`, que puxavam `node-gyp` via git; `postinstall` agora chama `app/scripts/postinstall.js`, que usa binários prebuilt do `better-sqlite3` se não houver compilador C++; `dist:win` com `--config.npmRebuild=false`), `app/package-lock.json` regerado sem dependência git, `docs/windows.md` (`git clone -c core.symlinks=false`, estado dos testes, Node 24.15 funcionou), `app/.gitignore` (`data/`) e removidos os 13 symlinks `.macho` de `MAC/integracao-iphone/distribuicao/inspecao-binarios/`. `postinstall.js`: no Mac a falha do `install-app-deps` continua fatal (só Windows/Linux usam o prebuilt) e erro no fallback agora sai com código ≠ 0; `inspecao-binarios/` no `.gitignore`. **Sem testar:** `npm install` + `npm start` no Mac (só `npm ci --ignore-scripts` no Linux); `ios-bridge` só no Mac e `app-update` ficam como pendência.

## Rodar e gerar instalador a partir do repositório — 15/11/2026

`app/package.json` ganhou `npm start`, `npm run browsers`, `npm run dist:mac` (DMG Apple Silicon, assinatura ad hoc, `local.nova.ai.mac`) e `npm run dist:win` (NSIS x64), com `electron-builder` 26.18.0 e a configuração no campo `build`. O `postinstall` recompila os módulos nativos para o Electron e instala o `ssh2` de `electron/services/iphone-setup/`. Arquivos: `app/package.json`, `app/package-lock.json` (só adições), `app/scripts/baixar-navegador.js`, `app/requirements.txt`, `app/.gitignore` (`release/`, `resources/`, `browsers/`, `config_bak_C.dat`), `app/README.md`, `docs/windows.md`.

**Correção de segurança (16/11/2026):** o `build.files` do electron-builder não lê o `.gitignore` e empacotava `config_bak_C.dat` (chaves de API exportadas), `.env*`, `data/`, `secret_key.json`, `known_hosts`, `iphone-hosts.json`, `*.db`, `*.log` e `*.antes-proxy-*` se existissem em `app/` na hora do build. Agora todos são excluídos (`app/package.json`), e `secret_key.json`, `data/` e `Nova_Vault/` entraram no `app/.gitignore`. Prova (Linux, `electron-builder --linux dir`, arquivos falsos plantados): antes 13/13 empacotados, depois 0/13, `electron/main.js`, `package.json` e `dist/index.html` continuam. Não refeito no Mac nem no Windows (o filtro de `files` é o mesmo código nos três). `app/README.md`: corrigido o texto sobre `config_bak_C.dat` (só a ação de exportar o cria) e sobre as ferramentas do iPhone (só `Resources/ios-tools/bin/`).

**Correção de segurança, 2ª parte (16/11/2026):** as exclusões só valiam na raiz de `app/` e não cobriam o que o próprio app grava: `save-youtube-settings` cria `youtube_auto/.env` (chave Gemini) e `youtube_auto/client_secret.json` (OAuth do Google). Agora `build.files` exclui `.env*`, `config_bak_C.dat`, `secret_key.json`, `*_key.json`, `remote_tokens.json`, `id_iphone*`, `known_hosts`, `iphone-hosts.json` em qualquer pasta, mais `youtube_auto/client_secret.json`, `youtube_auto/token*.json` e `youtube_auto/exports/` (6 vídeos de exemplo, 7,3 MB, que o app recria). `app/.gitignore` ganhou `client_secret.json`, `token*.json`, `*_key.json`. Prova (Linux, `electron-builder --linux dir`, 19 arquivos falsos plantados): antes 11 empacotados, depois 0. Não refeito no Mac nem no Windows.

**Comparação:** o `app/` do repositório é idêntico ao app do pacote `Nova-AI-Mac-AppleSilicon-2026-11-10.dmg` (só difere a chave do Google neutralizada em `admin.html`). O app Windows instalado (`app.asar`, 30/10/2026) difere em 27 de 115 arquivos; detalhes em `docs/windows.md`. O código só do Windows (licença Firebase com chave embutida) não foi trazido.

**Testado no Mac (Node 22.23, macOS 15):** `npm install` do zero, `npm start` (`NOVA_SMOKE_TEST=1`: interface carregou), `npm run dist:mac` gerou o `.dmg` (1,06 GB com Chromium embutido), `codesign --verify --deep --strict` passou no `.app` copiado do DMG, e o `.app` copiado abriu e carregou a interface. **Não testado:** `npm run dist:win` em Windows (no Mac falha por compilação cruzada dos módulos nativos); `npm install` com Python 3.11+ de verdade (foi usado `YOUTUBE_DL_SKIP_PYTHON_CHECK=1`); recursos fora do git (`ffmpeg`, `adb`, `.deb`) no instalador gerado.

## Regras automáticas de qualidade nas PRs — 15/11/2026 (revisão corrigida em 16/11/2026)

Toda PR passa a ser conferida por três checks do GitHub Actions: `Regras de revisão` (nenhum comentário novo, no máximo 1000 linhas por arquivo de código com uma linha de base que só encolhe, sem segredo, sem binário ou instalador, sem `console.log` novo, sintaxe válida, ESLint nas linhas novas), `Registro da PR` (linha `Atenção:`, prova real com o SHA do head quando ALTA, revisão independente no head exato, caminhos sensíveis contam como ALTA) e `Auditoria de dependências` (`npm audit` só do que a PR introduz). Arquivos: `scripts/regras/`, `.github/workflows/regras.yml`, `.github/workflows/registro-da-pr.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `CONTRIBUTING.md`, `AGENTS.md` (uma linha corrigida). Nenhum arquivo do app foi alterado. **16/11/2026, depois da revisão independente:** `git diff --text` (um `.gitattributes` com `-diff` não desliga mais as regras de linha); os workflows rodam as regras da branch-alvo e não as da PR (a PR que cria as regras usa as próprias); `.github/CODEOWNERS`; ações presas por SHA; `Registro da PR` também roda em `pull_request_review`, o veredito que não é CLEAN no head é definitivo e a prova exige explicação; cópia idêntica de backup falha; `eslint-disable` não vale e o ESLint ignora diretiva em linha; ESLint com globais do navegador completos; só `app/dist/`, `MAC/**/dist|reservas|fixtures`, `backup-antes-traducao/`, os bundles `index-Dun7lr2S*.js` e `marked.min.js` ficam fora das regras de código (pasta com o mesmo nome em outro lugar é cobrada); `@generated` não isenta do limite (a linha de base caiu de 25 para 20 arquivos: os 5 bundles saíram); comentário em C/Obj-C/Swift/Logos/YAML/TOML/plist/shebang; segredo: hash hexadecimal, URL de exemplo e linhas longas por janela; `console['log']`; `i++ / n`; arquivos com espaço, aspas ou tab no nome; tempos lineares. Arquivos novos: `scripts/regras/globais.json`, `scripts/regras/checks-obrigatorios.json`, `.github/CODEOWNERS`, `scripts/regras/test/correcoes.test.js`. **16/11/2026, segunda revisão:** os testes das regras rodam depois das regras (um teste da PR não troca mais `REGRAS_DIR`); arquivo em UTF-16 (com ou sem BOM, big endian ou `working-tree-encoding`) é decodificado e passa pelas regras de conteúdo; arquivo binário sem assinatura conhecida é varrido atrás de segredo (texto legível em 8 e 16 bits); arquivo modificado (`M`) passa pela regra de binário (vira executável, gzip ou cruza o limite de tamanho); cópia ou renomeação de pasta isenta para código cobra comentário; comentário em `Makefile`, `Dockerfile`, `.cmd`, `.bat`, `.go` e `.rs`; `o.return / 2; // x` não esconde comentário; segredo em linha longa na fronteira da janela e token do Telegram em URL `bot<token>`; título de seção com `\r` solto sem tempo quadrático. Proteção da `main` por decisão do dono: 3 checks obrigatórios, sem aprovação, sem Code Owners, sem exceção para administrador (`CONTRIBUTING.md`). Arquivo novo: `scripts/regras/test/endurecimento.test.js`. Ficam de fora (documentado): isenções `MAC/**` em qualquer profundidade. **16/11/2026, terceira revisão:** arquivo de código com byte nulo (novo, renomeado ou modificado) falha em `sem-binario-nem-lixo`, porque as regras de linha não o leem; UTF-16 com BOM é decodificado mesmo sem byte nulo no começo; `<!--`, `-->` no começo de linha e shebang com texto dentro de JS contam como comentário; `@rem` e `& rem` em `.bat`; um `NOT CLEAN` cuja linha `Head:` cita o head com texto extra continua definitivo; URL de proxy de exemplo (`host:porta@usuario:senha`, host `*.exemplo.com`, senha só com dígitos, `falso`) deixa de ser segredo. Arquivos: `git.js`, `regra-binario.js`, `regra-comentario.js`, `comentarios.js`, `regra-segredo.js`, `registro-da-pr.js` e `endurecimento.test.js`. **16/11/2026, quarta revisão:** arquivo de código em UTF-16 (BOM `FF FE`) também falha em `sem-binario-nem-lixo`, porque `.sh`, `.cmd` e `.bat` com esse BOM rodam no shell e as regras os liam como uma linha só (código entra em UTF-8; texto comum em UTF-16 continua decodificado); a credencial de proxy na ordem invertida da Evomi (`host:porta@usuario:senha`) e a senha com outro `@exemplo.com` depois voltam a ser achadas; o regex do shebang é linear e aceita CRLF. Arquivos: `regra-binario.js`, `regra-segredo.js`, `regra-comentario.js` e `endurecimento.test.js`. Limites conhecidos desta rodada (em `CONTRIBUTING.md`): `-->` depois de `/* */` de várias linhas, `.plist` binário, variantes de `rem` no `cmd.exe`, `falso` em valor de segredo, `#!/usr/bin/env VAR=x cmd`, symlink para pasta isenta e o limite de 3000 arquivos da API. **Não testado:** a proteção da `main` e da branch de integração com os checks obrigatórios (o firstmate configura; texto em `CONTRIBUTING.md`); o evento `pull_request_review` no GitHub antes de a PR ser mesclada; a execução do `Registro da PR` com as regras vindas da base (a base ainda não as tem).

## Seletor de modelo no app instalado (IPCs spoofer:*) — 06/11/2026

Com o OK do usuário (OK1), implementados no app instalado em `/Applications/Nova AI Mac.app`:
- `electron/main.js`: 4 canais com os nomes do contrato da UI — `spoofer:get-ios-models`, `spoofer:apply-ios-model`, `spoofer:clear-ios-model`, `spoofer:get-ios-model` (registrados junto dos demais `ipcMain.handle` de PHONE CONTROL).
- `electron/services/physicalMobileService.js`: métodos `getIosModels()`, `applyIOSModel(deviceId, productType)`, `clearIOSModel(deviceId)`, `getIOSModel(deviceId)` + `require('./ios-modelo')` no topo. NÃO foi copiado o gêmeo do repo (armadilha documentada: o `.patched.js` divergiu e quebraria o app).
- `electron/services/ios-modelo.js` e `electron/services/iosModels.json` copiados do repo (`MAC/integracao-iphone/`): módulo puro que monta os comandos do CLI `/var/jb/usr/bin/novamodel` (`set/clear/status`) via `iosSsh` (mesma sessão SSH do Conectar) e valida `productType` contra regex (sem shell injection).
- Backups ao lado: `main.js.bak-*`, `physicalMobileService.js.bak-*` (padrão `.bak-AAAAAADD-HHMMSS`). `node --check` OK nos três arquivos tocados.

Teste no aparelho (sem senha) já executado: `/var/jb/usr/bin/novamodel status` → `{"active":"iPhone10,2","enabled":false,"real":"iPhone10,2"}` (tweak funcional, nada aplicado).

O que testar depois de reiniciar o Nova: abrir PHONE CONTROL → o select MODELO deve listar 27 modelos → escolher iPhone 13 (productType `iPhone14,5`) → **APLICAR MODELO** → conferir por SSH `novamodel status` com `enabled:true` e `active:iPhone14,5` (e Ajustes → Geral → Sobre mostra o modelo) → **LIMPAR MODELO** → status volta a `enabled:false`, `active` = real. Branch `agent/ios/modelo-ipc-20261106`, sem merge e sem push.

## Conectar instala novamodel + nova-locale com a senha já digitada — 06/11/2026

O usuário pediu que a senha digitada no Conectar seja usada para instalar o que falta (modelo e GPS/fuso), sem digitar senha de novo. O `conexao-usb/setup.js` agora, no mesmo fluxo do Conectar (com a senha do modal):
- **novamodel**: se o `.deb` existir ao lado do setup e o pacote não estiver instalado, sobe por sftp e instala via `sudo -S` + senha; se já instalado, só informa a versão.
- **nova-locale**: confere os arquivos do helper (`/var/jb/usr/libexec/nova-locale.sh` + `com.aquiles.novalocale.plist`); se faltar, sobe os arquivos (`nova-locale.sh` e `com.aquiles.novalocale.plist` agora vão junto do app), move com `sudo -S`, ajusta permissões e carrega o daemon com `launchctl bootstrap` (fallback `kickstart`).
- A senha continua sem ser salva (é zerada no `finally`); cada comando `sudo` recebe a senha só pelo stdin daquela execução.

App instalado: `setup.js` corrigido com backup (`setup.js.bak-20261106-*`) e `novamodel.deb`/`nova-locale.sh`/plist copiados para `electron/services/iphone-setup/`. Para instalar no aparelho, o usuário toca **Conectar** mais uma vez e digita a senha — o resto é automático. Branch `agent/ios/novamodel-locale-conectar-20261106`, sem merge e sem push.

## Fase A — merge do seletor de modelo + pacotes release — 06/11/2026

Merge na `main` (de `530920e`) das três branches do seletor de modelo do iPhone, em sequência: `agent/jailbreak/modelo-iphone-20261105` → `agent/ios/modelo-iphone-20261105` → `agent/frontend/modelo-iphone-20261105` (merge octopus falharia no `MAC/LEIA-ME.md`). Conflito resolvido mantendo as três seções no topo (tweak+CLI, serviço+IPC, seletor da UI). Commits de merge: `93c63a5`, `b9d3116`, `b5c3522` (não enviados — push pendente de autorização).

**Testes após o merge:** `integracao-modelo/test/teste-novamodel.cjs` (5 ok), `integracao-modelo-app/novamodel.test.cjs` (30 verificações), `conexao-usb/setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` passando. `integracao-sequestro-cam/controles-independentes.test.cjs` **falha pré-existente** (já falhava em `530920e`): o teste fixa a ponte em `0.1-38` e espera o fluxo de injeção anterior à bridge 0.1-39; não foi alterado nesta fase — precisa de decisão separada.

**Pacotes release (theos, `FINALPACKAGE=1 DEBUG=0`):**
- Tweak `com.aquiles.novamodel_0.1_iphoneos-arm64.deb` (rootless arm64, `Version: 0.1`) em `integracao-modelo/packages/`.
- Bridge `com.aquiles.obsgraph-bridge_0.1-39_iphoneos-arm64.deb` (`Version: 0.1-39`) em `integracao-iphone/bridge/packages/`, copiado como `camera.deb` para `conexao-usb/` (repo) e `electron/services/iphone-setup/` (app). Ambos fora do git (`*.deb` ignorado).

**setup.js:** backport do app instalado para o repo (`ensureTunnel()`, listeners de erro do ssh2 com `on`+guarda `settled`, `launchctl kickstart mediaserverd` após instalar a ponte). `TARGET` ajustado de `0.1-39-1+debug` para `0.1-39` para casar com o pacote release (o mesmo ajuste foi aplicado no `setup.js` do app instalado). O bloco de instalação do `novamodel.deb` já está no repo, mas ainda **não** no app instalado (pendente da Fase C; exige colocar `novamodel.deb` em `electron/services/iphone-setup/`).

**Bundle:** `conexao-usb/dist/index-Dun7lr2S.patched.js` reaplicado no app (`dist/assets/index-Dun7lr2S.js`), levando o seletor de modelo (IPC `spoofer:get-ios-models`).

**DMG:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-06.dmg`, gerado do app instalado com `CFBundleVersion=20261106.1` e `LSMinimumSystemVersion=26.0`.

```
sha256  4bf34a8c0210dc81ba933ed45471e5febe814e63cc8836a2917c412722ded685
```

Assinatura ad hoc, sem Developer ID nem notarização. Estado registrado: `spctl --assess` no app dentro do DMG → `invalid Info.plist (plist or signature have been modified)`; no app instalado → `a sealed resource is missing or invalid`. Uso em outro Mac: abrir com Ctrl+clique → Abrir.

## Spoofing de modelo do iPhone (tweak + CLI) — 05/11/2026

Criado o pacote `com.aquiles.novamodel` (rootless) para o iPhone reportar outro modelo (ex. "iPhone 13" → `iPhone14,5`), a contraparte iOS do spoofing de identidade que hoje só existe em Android. Só modelo — sem IMEI/serial.

- **Tweak `NovaModel.dylib`** (Substrate, carrega em todo processo): hooka `MGCopyAnswer`/`MGCopyAnswerWithError`/`MGGetStringAnswer` (whitelist fechado: `ProductType`, `HWModelStr`, `ModelNumber`, `ProductName`, `MarketingProductName`), `sysctlbyname`/`sysctl` (`hw.machine`, `hw.product`) e `UIDevice` (`model`, `localizedModel`, `modelName`/`_modelName` privados). Lê `/var/tmp/nova-model-control.json` com cache por mtime (aplicação instantânea).
- **CLI `/var/jb/usr/bin/novamodel`** (setuid root): `set <productType>` (valida no banco e grava o control file), `clear`, `status` (JSON `real`/`active`/`enabled`). Roda sem o tweak, então `status` lê o ProductType real.
- **Banco de modelos** `models.json` (27 modelos: iPhone 8 → 15), instalado em `/var/jb/usr/share/novamodel/models.json`.

Arquivos: `integracao-modelo/` (Tweak.x, main.m, models.json, Makefile, layout, test). Compila no theos e gera `.deb` rootless arm64 (`packages/com.aquiles.novamodel_0.1-*.deb`). Teste automatizado `test/teste-novamodel.cjs` valida banco, contrato do control file e whitelist MG. **Sem testar no aparelho real** (efeito em Ajustes/Sobre e apps, `dpkg -i`, setuid); `HWModelStr`/`ModelNumber` estão no whitelist mas não são spoofados na v1 (códigos de placa/número de modelo são por variante/região).

## Spoofing de modelo do iPhone — serviço + IPC + instalação do .deb — 05/11/2026

Integração no app para o tweak `com.aquiles.novamodel` (spec `NOVA-AI-MODELO-SPOOF-SPEC.md`). No `physicalMobileService` entraram `getIosModels()`, `applyIOSModel(deviceId, productType)`, `clearIOSModel(deviceId)` e `getIOSModel(deviceId)` — chamam `/var/jb/usr/bin/novamodel` via `iosSsh` (túnel USB). IPCs novos em `main.js`: `spoofer:get-ios-models`/`spoofer:apply-ios-model`/`spoofer:clear-ios-model`/`spoofer:get-ios-model` (nomes do contrato da UI). Banco de modelos em `iosModels.json`; instalação do `novamodel.deb` pelo fluxo Conectar (guarded: só quando o `.deb` existir ao lado do `camera.deb`).

- Arquivos: `integracao-iphone/ios-modelo.js` (novo), `integracao-iphone/iosModels.json` (novo), `integracao-iphone/physicalMobileService.patched.js`, `integracao-iphone/conexao-usb/setup.js`, `integracao-modelo-app/main.modelo.js`, `integracao-modelo-app/novamodel.test.cjs`, `integracao-modelo-app/README.md`.
- Testado: `node --check` nos arquivos tocados + `novamodel.test.cjs` (30 verificações com mock de SSH).
- Sem testar: instalação e execução real do CLI (o `.deb` do Jailbreak Specialist ainda não existe) e o IPC no Electron (só sintaxe + mock). Detalhes: `MAC/integracao-modelo-app/README.md`.

## Seletor de modelo do iPhone no painel "Identidade simulada" — 05/11/2026

Spoofing de modelo do iPhone na UI: no painel **Identidade simulada** (janela "Controle do Celular"), o seletor de modelo do iPhone agora é alimentado pelo banco de modelos iOS e tem botões **Aplicar modelo** e **Limpar modelo**.

- **Seletor:** populado dinamicamente via `spoofer:get-ios-models` (27 modelos do banco do serviço, `{productType, name}`); o bundle não tem mais lista fixa. Ex.: iPhone 13 = `iPhone14,5`.
- **Contrato de IPC (bundle → main):** `spoofer:get-ios-models` (sem args → `{success, models[]}`), `spoofer:apply-ios-model {deviceId, productType}` (aplica), `spoofer:clear-ios-model {deviceId}` (restaura o real) e `spoofer:get-ios-model {deviceId}` (lê `{real, active, enabled}`). Os handlers no `main.js`/`physicalMobileService` são do iOS Engineer; o bundle já chama esses canais. Se o IPC ainda não existir, o seletor mostra a falha no painel (estado "error").
- **Estados:** `applying` (spinner), `applied` (verde, "Modelo aplicado no iPhone"), `idle` (modelo real) e `error` (vermelho). Ao abrir a aba, `spoofer:get-ios-model` lê o estado atual.
- **Texto pt-BR**; nomes de modelo (dados de spoofing) não traduzidos.

Arquivos: `MAC/integracao-iphone/conexao-usb/dist/index-Dun7lr2S.patched.js` (patch no bundle). Reaplicado `aplicar-botao-iphone.py` (idempotente) e `node --check` OK.

Sem testar: execução real no app (bundle patcheado ainda não copiado para `/Applications/Nova AI Mac.app`) e o fluxo Aplicar/Limpar contra o tweak `novamodel` no iPhone (depende do iOS Engineer expor os IPCs e do Jailbreak Specialist instalar o `.deb`).

## Chave SSH do iPhone agora é do app — 04/11/2026

A chave usada para falar com o iPhone saiu de `~/.ssh/id_iphone` e passou para `~/Library/Application Support/nova_dsktp/iphone-ssh/` (modo 0600), junto com o `known_hosts` do aparelho. Todos os `ssh`/`scp` do app usam `-i` explícito, `IdentitiesOnly=yes` e `UserKnownHostsFile=` desse diretório, então não caem mais nas outras chaves do agente SSH do Mac.

- `services/iphone-ssh.js` é o único lugar que conhece o caminho; `setup.js`, `physicalMobileService.js`, `ios-camera.js`, `cam-live-iphone.js` e `ios-bridge.js` passaram a usar `sshOptions()`.
- Migração automática no boot (`migrateLegacy()`): se existir `~/.ssh/id_iphone` e ainda não houver a do app, ela é **movida** (não copiada) e a linha `[127.0.0.1]:2222` do `known_hosts` é herdada. É a mesma chave, o iPhone continua autorizando — não precisa refazer o Conectar.
- Em teste (`NOVA_SMOKE_TEST=1`) a migração não roda; `NOVA_USER_DATA` isola os caminhos.
- Não é isolamento criptográfico: qualquer processo do mesmo usuário do macOS ainda lê o arquivo (0600). O ganho é sair do `~/.ssh` (fora de dotfiles, backups e outras ferramentas) e ter par chave/known_hosts só do app.

Verificação: migração simulada com `HOME` falso moveu a chave com 0600, herdou o known_hosts e gerou as opções certas; 15 testes do CAM LIVE + `setup.test.cjs` + `botao-servico.test.cjs` passando. **Reinicie o Nova** para a migração acontecer. No repo, `integracao-camlive/`, `integracao-sequestro-cam/` e `encerramento-nova/` têm um shim `iphone-ssh.js` porque neles os arquivos não ficam lado a lado como em `electron/services/`.

## Cartão do iPhone: "Abrir controle" reaplicado — 04/11/2026

O bundle em uso (`dist/assets/index-Dun7lr2S.js`) estava **sem** o patch do botão do iPhone: o cartão de um aparelho já preparado mostrava **PARAR TRANSMISSÃO** (vermelho) em vez de **Abrir controle**, o que dá a impressão de transmissão ativa mesmo com o aparelho parado — o `streaming` do iOS é o registro de pareamento (`iphone-hosts.json`), não uma transmissão real. Outro patch de bundle aplicado depois (controle de celular/geo-proxy) sobrescreveu o trecho.

Reaplicado `conexao-usb/aplicar-botao-iphone.py` no app instalado: iPhone preparado agora mostra **Abrir controle** (ciano) e abre o console direto; Android continua com **Parar transmissão**. A lista de dispositivos já se atualiza sozinha a cada 5 s (o painel faz `setInterval` de `physical-mobile:get-status`), então desplugado deixa de aparecer. Cópia canônica do bundle em `conexao-usb/dist/index-Dun7lr2S.patched.js`; anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/index-Dun7lr2S.antes-botao.js`.

**Regra nova no `AGENTS.md`:** qualquer patch futuro no bundle precisa reaplicar este script (é idempotente) antes de copiar para o app, senão o botão volta a regredir. Recarregue com **Cmd+R** ou reinicie o Nova.

## Transporte camuflado Mac → iPhone (bridge 0.1-39) — 04/11/2026

O que a Câmera do iPhone consome deixou de ser `http://127.0.0.1:18999/frame.jpg`.

- O servidor do Mac (CAM LIVE e CAM HIJACK) só responde em `/s/<token de 32 hex>/frame.jpg` e `/s/<token>/audio`; sem o token a resposta é 404 neutro. O token é novo a cada sessão.
- O túnel SSH tenta primeiro um **socket Unix** em `/var/tmp/.nb-<8hex>.sock` (modo 666 para o mediaserverd). Nenhuma porta TCP fica escutando no iPhone. Se o sshd do aparelho recusar streamlocal, cai para uma **porta TCP aleatória** (20000–39999) com o mesmo token; o `-v` do ssh foi removido.
- O bridge 0.1-39 valida o caminho com token, aceita `socket` no control, recusa a rota antiga e **removeu o IP fixo `10.0.0.245:8900`** que vinha do projeto original.
- O sequestro (item 3) passou a pedir o endereço ao CAM LIVE (`mediaEndpoint()`): CAM LIVE, CAM HIJACK e sequestro compartilham o mesmo token/transporte em vez de repetir 18999.

Compatibilidade: pontes 0.1-38 e anteriores são recusadas ("atualize por USB") porque não conhecem o token. Atualize pelo **Conectar** em PHONE CONTROL — o `camera.deb` 0.1-39 já está incluído no app.

Arquivos: `integracao-iphone/bridge/Tweak.x` (0.1-39), `integracao-camlive/cam-live-iphone.js`, `integracao-iphone/ios-camera.js` (= `integracao-sequestro-cam/ios-camera.patched.js`), `conexao-usb/setup.js` (alvo 0.1-39) e `conexao-usb/camera.deb`. Reservas do instalado anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/`. Testes: 15 passam (`node --test` em `integracao-camlive/test/`), incluindo token/404, socket Unix, fallback TCP e sequestro. **Não testado no aparelho**: se o sshd do iPhone aceita `-R` com socket Unix e se o mediaserverd (sandbox) consegue conectar; se recusar, o fallback TCP entra sozinho. Reinicie o Nova e refaça o Conectar para instalar a 0.1-39.

## Conexão do iPhone dentro do app — 04/11/2026

O **Conectar** dos iPhones em PHONE CONTROL deixou de abrir uma janela/página externa para a senha SSH. Agora o formulário, o progresso e o controle do iPhone são desenhados **dentro da janela do Nova**, como um modal do próprio app: fundo escurecido e embaçado, mesmo visual do Controle do Celular, X/Esc para fechar (bloqueado durante a preparação) e tempo decorrido.

A senha continua só em memória: o campo é limpo antes do envio ao processo principal, a senha não entra em log nem em mensagem de erro. O modal roda no preload (`inapp.js`), fora do bundle React — não depende do `index-Dun7lr2S.js`. Depois do sucesso, "Abrir controle e tela do iPhone" carrega o iPhone Console num `<webview>` dentro do app, com "Abrir em janela" como alternativa.

Depois de conectar, o cartão do iPhone não fica mais em **Conectar**: passa a **Abrir controle**, que abre o console dentro do app sem senha. O estado vem do registro `iphone-hosts.json` gravado por um Conectar bem-sucedido; Android segue com "Parar transmissão" e o botão **Refazer conexão** fica no topo do controle.

Arquivos: `integracao-iphone/conexao-usb/` (`inapp.js`, `setup.js`, `aplicar-botao-iphone.py`, `botao.test.cjs`, `botao-servico.test.cjs`, `setup.test.cjs`, `test/modal/`, `dist/index-Dun7lr2S.patched.js`, `docs/`), com os arquivos da janela antiga em `integracao-iphone/reservas/modal-externo-20261104/` e o estado anterior desta rodada em `integracao-iphone/reservas/botao-conectado-20261104/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: `node --check` nos quatro arquivos; testes do serviço (senha inválida, aparelho único, janela ausente); harness em Electron com o **preload real** abrindo o modal por IPC, enviando a senha e confirmando o campo vazio; estados idle/preparando/sucesso/erro e o webview do console renderizados sem exceção. **Conexão real no aparelho não refeita** (exige a senha do iPhone) e **reiniciar o Nova** para carregar.

## Foto ➔ Vídeo (Kling) acessível e corrigido — 03/11/2026

A função de animar foto em vídeo (Capítulo 3 do guia) existia no código, mas estava **sem botão de acesso** nesta versão: a seção "kling" da Suíte de Vídeo só abria por um evento interno (`nova-open-kling-video`) que nada disparava. Foram corrigidos 7 problemas no fluxo:

1. **Botão novo** "Foto ➔ Vídeo" na barra da Suíte e Estúdio de Vídeo (AI UPLOAD), entre "Criador de IA" e "Recortador Seguro" — abre a seção de selecionar foto → movimento → proporção/duração → converter.
2. **FFmpeg do Mac**: o serviço só procurava `ffmpeg.exe` (Windows); agora acha o `Resources/bin/ffmpeg` do macOS. Sem isso, o motor gratuito offline sempre falhava.
3. **Pasta de saída errada**: o vídeo era salvo em `cwd/youtube_auto/exports` (caía no Downloads) enquanto a biblioteca "Arquivos Exportados" lê `app/youtube_auto/exports` — o vídeo nunca apareceria na lista. Agora salva na pasta certa.
4. **Tamanho real do arquivo** na biblioteca (era fixo 5 MB).
5. **WebP** enviado com mime correto para a Kling Cloud.
6. **Tradução**: 12 textos em inglês esquecidos no fluxo ("Clear Picture", "Converting Picture into Video...", mensagens de status, "Library (n)" etc.).
7. **Assinatura** ad-hoc refeita após o patch (`codesign --verify` OK).
8. **Prévia do vídeo cinza (0:00)**: as URLs `file:///` eram montadas com padrão de Windows (`file:///` + caminho absoluto Unix = 4 barras), e o Chromium não achava o arquivo — o vídeo era gerado certo, mas o player ficava escuro. Corrigido para o player "✨ Vídeo Gerado Pronto" e para a prévia da foto escolhida via "Procurar Arquivos". O botão "Salvar Vídeo" e sua mensagem também foram traduzidos ("Save to Phone Storage" etc.).
9. **Vídeo saía parado (foto imóvel)**: o motor local usava `zoompan` com estado acumulado (`zoom+0.0012`) e `-loop 1`, combinação que congelava o efeito com certas fotos de entrada (verificado num caso real: 10 s de imagem imóvel, PSNR 61 entre quadros distantes). Reescrito com expressões puras em função do número do quadro (`on`), sem `-loop`, na receita canônica do FFmpeg para Ken Burns — o movimento agora vai do primeiro ao último quadro em todos os 5 presets. Teste `test/teste-movimento.cjs`: 20 combinações (5 presets × jpg/png/webp em vários tamanhos), todas com movimento medido (PSNR 6–13 entre 1 s e 8 s).
10. **"Salvar Vídeo" baixava HTML quebrado**: o botão usava download por âncora de URL `file://`, que o Chromium bloqueia — salvava uma página de erro de 15 KB com nome .mp4 (por isso "não pode ser aberto" no Mac). Novo IPC `kling:save-video` no `main.js` copia o arquivo real para o Downloads (sem sobrescrever: acrescenta -2, -3…), abre o Finder no arquivo e o botão usa esse IPC com fallback. As 3 cópias quebradas no Downloads do usuário foram substituídas pelos vídeos reais. Original do `main.js` antes deste patch em `reservas/instalado-antes-kling-2026-11-03-main.js`.
11. **IA do Sistema (Veo) no Foto ➔ Vídeo**: o app tinha chave Gemini configurada (`secret_key.json`, lida por `app.getGeminiToken()` — a mesma do Nova Studio), mas nenhum caminho de geração de vídeo. Adicionado o motor "IA do Sistema" no `kling-video-service.js` (`_generateSystemAIVideo`) com **auto-descoberta**: consulta `ListModels` (gratuito) e usa os modelos Veo que a chave tiver. **Testado com a chave atual: a API listou 60 modelos e nenhum é Veo** — ou seja, a chave do Nova não tem acesso a vídeo (Veo via API exige faturamento Google). O caminho fica pronto para o dia em que o faturamento for ativado.
12. **Motor fal.ai no Foto ➔ Vídeo (botão verde)**: como a chave do Nova não faz vídeo, o botão "Converter com IA fal.ai" usa a chave **fal-key do Chaveiro do Mac** (a mesma do projeto criar-videos, lida com `security find-generic-password`). Fila `queue.fal.run`, imagem em data URI, modelo mais barato primeiro (`fal-ai/bytedance/seedance/v1/lite/image-to-video`, fallbacks Wan 2.2 e Kling 2.1), 720p, duração 5/10 s, espera com progresso e download para `exports`. **Custa por vídeo na conta fal.ai** — confirmar antes de gerar. Reinicie o Nova para carregar.

Arquivos: `integracao-kling/` (fontes patcheadas + `reservas/` com os originais de antes + `test/teste-motor-local.cjs`). Teste de ponta a ponta do motor local passou no app instalado: imagem de teste → MP4 720×1280 válido em `app/youtube_auto/exports`, com progresso e limpeza automáticos. **Reinicie o Nova para carregar.** Sem chave da API Kling, usa o Nova Motion Engine local (grátis, Ken Burns por FFmpeg); com chave, envia para `api.klingai.com` (kling-v1) — a autenticação Bearer da Kling pode exigir JWT próprio dela, não validado (não há conta para testar). O DMG não foi regenerado.

## CAM LIVE direto para o iPhone por USB — 03/11/2026

O CAM LIVE agora transmite **sem OBS, MediaMTX nem servidor RTMP**. O destino padrão é "iPhone por USB — automático" (formato celular 720×1280): o renderer envia JPEG (`camlive:frame`) e PCM das cenas (`camlive:pcm`); o processo principal (`cam-live-iphone.js`) serve `/frame.jpg` e `/audio` em loopback, abre o túnel SSH reverso para a porta 18999 do iPhone, codifica o áudio em AAC-LC 44,1 kHz com o FFmpeg incluído e só ativa a câmera depois de haver imagem **e** áudio. RTMP continua em Configurações → Avançado. Não há IP, porta ou chave para digitar.

Pré-requisito: iPhone conectado por **Conectar** (PHONE CONTROL) — exatamente um iPhone, ponte 0.1-38 com hooks de foto prontos. O pacote 0.1-38 agora acompanha o Nova (`conexao-usb/camera.deb`) e é instalado/atualizado por Conectar no iPhone10,2 / iOS 16.7.16. Um `enabled:true` antigo na ponte com lease expirado já não bloqueia o início.

Arquivos: `integracao-camlive/` (cam-live.js, cam-live-audio.js, cam-live-service.js, cam-live-iphone.js); aplicado no app instalado, com cópia do `main.js` anterior em `integracao-camlive/reservas/instalado-antes-usb-*`. Testes: `test/iphone-*.cjs` (14 testes passam) e `test/harness-usb.js` (iPhone simulado: ~16 fps de JPEG válidos e PCM em tempo real chegaram; parar interrompe os dois). FFmpeg incluído gerou ADTS aceito pelo parser.

**Não testado:** transmissão real até a Câmera do iPhone (a imagem aparecer no app Câmera), aparelhos além do iPhone 8 Plus, e o DMG não foi regenerado — o instalador final ainda não contém esta mudança. Reinicie o Nova para carregar. Windows fica para depois.

## Pacote Mac portátil de 03/11/2026

**Arquivo para compartilhar:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-03-final.dmg`. Use a versão `-final`; a primeira imagem foi uma tentativa intermediária e foi preservada. A cópia final do app passou na verificação de assinatura local `codesign --verify --deep --strict`.

Destino inicial: Mac Apple Silicon com macOS 26+. Windows fica para uma etapa posterior. O requisito macOS 26 vem dos binários efetivamente incluídos, não do Electron: auditoria de 227 arquivos Mach-O encontrou requisito máximo 26.0 e nenhuma dependência carregada de Homebrew, `/usr/local` ou `/Users`.

Python/PortAudio e bibliotecas foram incluídos em `python-runtime-portable/`, Chromium em `browsers/`, e os serviços passaram a usar o Python interno. Validados importação de módulos de áudio/rede/compressão/SQLite, HTTPS com certificados incluídos e lançamento do navegador interno. O Python também executou na cópia em outra pasta. O pacote exclui o venv antigo e a tentativa incompleta de runtime; nenhuma dessas cópias originais foi apagada.

O Nova abriu com perfil vazio e PATH mínimo (`SMOKE_EXIT 0`), com interface React carregada e API Electron disponível. Evidências em `distribuicao/teste-perfil-vazio-1793726904588/` e `distribuicao/verificacao-binarios.json`. Isso não substitui teste em outro Mac limpo. Não há validação de todas as funcionalidades, nem adaptação da ponte 0.1-38. Upload automático do YouTube continua sem pipeline. Serviços online continuam dependendo de internet e contas próprias.

Scripts de reprodução e auditoria em `integracao-iphone/distribuicao/`. Os dados pessoais de Application Support, perfis de navegador e chaves SSH não são copiados para a distribuição. A assinatura é local, sem notarização Apple.

## Portabilidade — revisão inicial de 03/11/2026 (histórico)

As ferramentas USB iPhone (`iproxy`, `idevice_id`, `ideviceinfo`, `ideviceinstaller`) e nove bibliotecas agora estão em `Contents/Resources/ios-tools/`. Os serviços iPhone passaram a resolver apenas esses executáveis incluídos no app. Teste: todas as quatro ferramentas iniciam com `PATH=/usr/bin:/bin`; nenhum dos 13 arquivos Mach-O possui dependência absoluta de Homebrew. Licenças locais foram copiadas para `ios-tools/licenses/`. Script de reprodução: `integracao-iphone/distribuicao/empacotar-ferramentas.py`.

**Na revisão inicial, a distribuição ainda não estava pronta.** O Python incluído era um venv com `home` e executável de origem no Homebrew; precisa de um runtime portátil para funções Python. O instalador DMG/ZIP existente continua antigo. Falta testar em outro Mac sem ferramentas de desenvolvimento. Esta alteração não atualiza o EXE Windows. O iPhone ainda precisa ter jailbreak ativo e OpenSSH, e CatVNC tem configuração própria. Contas e credenciais devem ser configuradas por cada usuário, sem copiar dados de `Application Support` ou chaves SSH pessoais.

## Conexão iPhone por senha SSH — 03/11/2026

O botão dos iPhones em DEVICES agora mostra **Conectar** e abre uma janela para a senha SSH do usuário `mobile`. O fluxo exige jailbreak ativo e OpenSSH já instalado no iPhone. A senha fica apenas em memória durante a operação. O app prepara uma chave SSH, verifica o acesso e oferece abrir o console. Exige somente um iPhone conectado; não faz jailbreak automaticamente.

O pacote OBSGraphBridge 0.1-30 está incluído no app e pode ser instalado sem download externo no iPhone10,2 com iOS 16.7.16. Outras versões já instaladas são preservadas. Não há instalação automática do CatVNC nem suporte universal às funções Android: o fluxo informa essas limitações. CatVNC ainda exige instalação e configuração próprias.

Fontes e testes: `integracao-iphone/conexao-usb/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: sintaxe do main, bundle em modo módulo, serviço, carregamento do SSH e testes de limites IPC/múltiplos aparelhos. **Conexão e instalação reais no aparelho ainda não testadas neste fluxo.** Reinicie o Nova para carregar as alterações.


## Tradução para pt-BR de 03/11/2026

O app instalado (`/Applications/Nova AI Mac.app`) foi traduzido inteiro para português do Brasil — só texto de interface, sem tocar em nenhuma função. Traduzidos: bundle da interface (`dist/assets/index-Dun7lr2S.js`, ~1.900 substituições), `dist/index.html`, PWA (`electron/pwa/`: index, admin, app.js, manifest), menus/diálogos do `electron/main.js`, mensagens visíveis dos services e a extensão nova-grab. **Reinicie o app para ver a tradução.** Cópia de todos os arquivos originais está em `../backup-antes-traducao/`. Nomes de hardware (Apple M1, Galaxy, GPUs — são valores de spoofing), modelos de IA e termos técnicos (Stop Loss, SKU, ADB) foram mantidos de propósito.

## Atualização local de 02/11/2026 — CAM HIJACK iPhone

O app instalado recebeu encaminhamento iOS para CAM HIJACK, correção do caminho do APK Android e textos de preparação por plataforma. Fontes, testes, reservas e o instalador iOS estão em `integracao-iphone/`.

**Pendente:** executar `integracao-iphone/instalar-iphone.command` no Terminal (sudo do iPhone) e validar a imagem na Câmera. O pacote nativo compilado é OBSGraphBridge 0.1-30 com suporte ao túnel USB em localhost:18999. O fluxo ativa a prévia nativa experimental; fotos/vídeos gravados e outros apps não estão validados nem habilitados nesta integração.

**O DMG abaixo é anterior a esta atualização e já não é idêntico ao app instalado.**

**Instalador anterior:** `Nova-AI-Mac-sem-ativacao.dmg` (1/11/2026, 789 MB) — é idêntico ao app **já instalado em `/Applications/Nova AI Mac.app`**, que é o que você usa no dia a dia. O `.zip` é o mesmo app em formato zip (backup).

## Atualização de 15/11/2026 — auto-download de ADB e scrcpy no Mac (PR-G)

- **O que mudou:** `ensureTools` (`physicalMobileService.js`), que só baixava no Windows, agora também baixa no macOS quando `adb` ou `scrcpy` não são achados (Homebrew, `resources/bin`, PATH). Quem já tem as ferramentas não muda nada.
- **Fontes oficiais e verificação:** ADB de `dl.google.com` (SHA-1 conferido contra `repository2-3.xml` do Google; sem hash no manifesto = instalação cancelada); scrcpy v5.0.1 de `github.com/Genymobile/scrcpy` (SHA-256 fixo no código, arm64 e x64). Hash errado = arquivo descartado. Hosts fora da lista são recusados, inclusive em cada redirect (`beforeRedirect`).
- **Correções da revisão:** o scrcpy no Mac é iniciado com `ADB=<adb do app>` para não haver conflito de versão com o `adb` embutido no pacote do scrcpy; a troca de pasta guarda a instalação anterior como `.old` e a restaura se o `rename` falhar; `adb-tmp-*`/`scrcpy-tmp-*` órfãos são varridos no início de `ensureTools`.
- **Comportamento conhecido:** o download roda automaticamente ~2 s após abrir o app quando faltam as ferramentas (~16 MB ADB + ~13 MB scrcpy), igual ao Windows.
- **Destino:** `~/Library/Application Support/nova_dsktp/physical_mobile/platform-tools/` e `.../scrcpy/`.
- **Falha:** nunca silenciosa — `ensureTools` devolve `success:false` com a causa e manda `physical-mobile:setup-progress` com `stage:'error'` (sugere `brew install android-platform-tools scrcpy`).
- **Arquivos:** `app/electron/services/android-tools-mac.js` (novo), `physicalMobileService.js`, `app/tests/android-tools-mac.test.js`, `app/README.md`.
- **Testado:** `node --check` e `node --test app/tests/android-tools-mac.test.js` (14 testes, rede e extração simuladas); hashes conferidos contra os downloads reais no Linux.
- **Sem testar:** extração real (`ditto`/`tar`) e execução de adb/scrcpy num Mac; Android real; Gatekeeper/quarentena nos binários baixados.
- **Reaplicar no app instalado:** copiar `android-tools-mac.js` e `physicalMobileService.js` para `Resources/app/electron/services/` (guardar o anterior em `reservas/`) e reiniciar o Nova.

## O que já foi feito ✅

### Port e base
- Port do instalador Windows (Electron) para macOS arm64, módulos nativos recompilados (SQLite, RobotJS).
- Ferramentas nativas embutidas: FFmpeg, ADB, scrcpy, cloudflared, yt-dlp.
- **Ativação removida**: sem tela de chave, sem formulário, sem consulta ao servidor de licença do fornecedor. Abre direto no painel.
- Instalado em `/Applications` (não precisa mais rodar do DMG).

### Segurança (endurecimento)
- **Túnel público do Cloudflare desligado por padrão** (só liga com `NOVA_REMOTE_TUNNEL=1` no terminal).
- **Todos os servidores internos escutam só em 127.0.0.1** (interface, WebSocket, RTMP) — nada exposto pra rede Wi-Fi ou internet.
- Correção crítica: o servidor RTMP interno não derruba mais o app quando a porta está ocupada.

### Recursos ativos
- **RTMP do Nova: porta 11935** (1935 é do MediaMTX). Para o Android via cabo nada muda (`adb reverse` entrega a 1935 dentro do celular). De outro computador: `rtmp://<ip-do-mac>:11935/live/nova`.
- **Wake word (ativação por voz): funcionando.** PortAudio + SpeechRecognition + sounddevice instalados no Python embutido. Precisa de internet (API de fala do Google) e permissão de microfone.
- **Mobile Cam Bridge**: câmera do celular alimentando o painel.
  - Android: página própria do app.
  - iPhone: Safari + túnel SSH por cabo (https://127.0.0.1:8899/pc-cam no celular) — nunca usa Wi-Fi.
- **PC → PHONE**: webcam do Mac aparecendo no celular (iPhone via túnel USB: https://127.0.0.1:8899/pc-cam).

### NOVO: iPhone integrado na aba PHONE CONTROL ✅
Com o iPhone 8 Plus **plugado no cabo** (jailbreak religado, OpenSSH ativo — a chave `~/.ssh/id_iphone` já está configurada):
- **DEVICES**: aparece como "iPhone 8 Plus (iOS 16.7.16)" na lista de aparelhos, igual um Android.
- **CONTROLS**: abre a janela **iPhone Console** dentro do sistema (sem navegador externo) — tela ao vivo controlável (clique = toque) via CatVNC + noVNC por cabo.
- **APPS**: listar apps instalados e abrir por nome — com tradução automática de pacotes Android→iOS (WhatsApp, Instagram, Chrome etc.).
- **BROWSER**: campo de URL abre o link no Safari do iPhone.
- **Screenshot**: salva imagem da tela (via canvas da tela ao vivo).
- Senha pedida na primeira conexão: a que você definiu em **Ajustes → CatVNC** (fica memorizada na página).
- Os túneis (iproxy 5900/2222) têm **auto-recuperação**: se caem, o app recria em segundos.

## O que ainda falta fazer ⏳

- **Fase 2 — SPOOFER / CAM HIJACK para iPhone**: vídeo do Mac virando a câmera NATIVA do iPhone, conectando o Nova ao seu tweak VCamMin (o equivalente do APK Android). É o último pedaço pra paridade total com o Android.
- **Toggles de Wi-Fi/Bluetooth** no CONTROLS para iPhone: respondem "não suportado por SSH" (Apple não expõe isso).
- **`youtube_auto/pipeline.py`**: o instalador original nem inclui esse arquivo — a automação de upload depende de reconstruí-lo.
- **Integrações que dependem das suas contas** (WhatsApp, Telegram, Google, chaves de IA): instaladas mas sem validação completa.
- **Câmera virtual completa, Antigravity, Stable Diffusion**: sem validação de fluxo completo.
- **Wake word com microfone real**: motor instalado e rodando; falta testar em uso com permissões do macOS.
- **Atualização automática**: não configurada (o feed do fornecedor é Windows-only).
- **Notarização Apple**: o app é assinado localmente (ad-hoc) — a primeira abertura sempre exige botão direito → Abrir.

## Arquivos desta pasta

| Arquivo | Papel |
|---|---|
| `Nova-AI-Mac-sem-ativacao.dmg` | **Instalador atual** (idêntico ao app instalado) |
| `Nova-AI-Mac-sem-ativacao.zip` | Mesmo app em zip (backup) — duplicado do DMG |
| `Nova-AI-Mac-Preview-com-ativacao.dmg` | Versão antiga com tela de ativação original (só se quiser usar a licença do fornecedor) |
| `LEIA-ME.md` | Este arquivo |

Gerado e mantido localmente. Não é distribuição oficial do fornecedor.

# Nova AI para macOS (Apple Silicon) — estado do projeto

## Conectar: mensagem clara quando o dpkg trava no iPhone — 06/11/2026

O modal Conectar mostrava o dump cru do `dpkg` (`rm command for cleanup subprocess was killed by signal (Segmentation fault: 11)`), o que parece erro de senha. Agora, quando o texto do erro tem `dpkg:`, `Segmentation fault` ou `was killed by signal`, o modal explica: **não é a senha**, nada foi alterado no Mac, **não tocar em "Tentar novamente"** e que o aparelho precisa ser recuperado (modo seguro) antes de repetir.

- Arquivo: `MAC/integracao-iphone/conexao-usb/inapp.js` (cópia instalada em `electron/services/iphone-setup/inapp.js`). Testes `setup.test.cjs`, `botao.test.cjs`, `botao-servico.test.cjs` OK.

## Conectar: "Senha aceita, mas a chave de acesso não foi validada" — 06/11/2026

Sintoma: no modal Conectar iPhone por USB a senha era aceita e a mensagem em vermelho dizia que a chave de acesso não foi validada (parecia senha errada). Não era a senha nem o `known_hosts` em si.

Causa: em `electron/services/iphone-ssh.js` → `sshOptions()` a opção ia sem aspas: `UserKnownHostsFile=/Users/…/Application Support/nova_dsktp/iphone-ssh/known_hosts`. O parser de configuração do `ssh` **separa por espaço**, então ele lia o arquivo `/Users/aquilesneri/Library/Application` (um resto de 98 bytes com a chave de host **velha**, de 04/11) e recusava com `Host key for [127.0.0.1]:2222 has changed and you have requested strict checking`. A verificação `iosSsh('test -d /var/jb')` falhava e o app mostrava a mensagem enganosa.

- Correção: o valor de `UserKnownHostsFile` agora recebe aspas quando o caminho tem espaço (`MAC/integracao-iphone/iphone-ssh.js`).
- Verificado com as mesmas opções do app via `execFile`: `CONECTOU` / `JB_OK` / `mobile` — ou seja, a chave do app **já estava** instalada no aparelho; só a checagem estava quebrada.
- App instalado corrigido com backup ao lado: `electron/services/iphone-ssh.js.bak-20261106-182841`. Branch `agent/frontend/conectar-known-hosts-20261106`, sem merge e sem push.
- Sobra do bug no Mac: o arquivo `/Users/aquilesneri/Library/Application` (98 bytes, chave de host antiga). Com a correção não é mais lido; pode ser removido com o OK do usuário.

### Conectar: senha digitada uma vez só neste modal

- O campo era limpo antes da chamada, então um erro no Conectar obrigava a **digitar a senha outra vez** para "Tentar novamente". Agora a senha fica só na memória do modal durante a sessão: falhou → volta no campo já preenchido; o modal fecha → o campo é limpo. Nada é gravado em disco.
- Texto de ajuda corrigido: antes dizia apenas "Ela não é salva"; agora explica que é usada **só neste Conectar** e que depois o app entra pela chave, sem senha.
- Arquivo: `MAC/integracao-iphone/conexao-usb/inapp.js` (cópia instalada em `electron/services/iphone-setup/inapp.js`, com backup). Testes `setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` passando.
- O que ainda pede senha: instalar pacote em `/var/jb` (`novamodel`, `nova-locale`) usa `sudo`, que não está liberado sem senha. Para resolver de vez: incluir esses installs no mesmo Conectar (usa a senha que a pessoa acabou de digitar) ou instalar a regra de `sudo` sem senha no aparelho — ambos no `setup.js` (iOS Engineer).

## Fase A — merge do seletor de modelo + pacotes release — 06/11/2026

Merge na `main` (de `530920e`) das três branches do seletor de modelo do iPhone, em sequência: `agent/jailbreak/modelo-iphone-20261105` → `agent/ios/modelo-iphone-20261105` → `agent/frontend/modelo-iphone-20261105` (merge octopus falharia no `MAC/LEIA-ME.md`). Conflito resolvido mantendo as três seções no topo (tweak+CLI, serviço+IPC, seletor da UI). Commits de merge: `93c63a5`, `b9d3116`, `b5c3522` (não enviados — push pendente de autorização).

**Testes após o merge:** `integracao-modelo/test/teste-novamodel.cjs` (5 ok), `integracao-modelo-app/novamodel.test.cjs` (30 verificações), `conexao-usb/setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` passando. `integracao-sequestro-cam/controles-independentes.test.cjs` **falha pré-existente** (já falhava em `530920e`): o teste fixa a ponte em `0.1-38` e espera o fluxo de injeção anterior à bridge 0.1-39; não foi alterado nesta fase — precisa de decisão separada.

**Pacotes release (theos, `FINALPACKAGE=1 DEBUG=0`):**
- Tweak `com.aquiles.novamodel_0.1_iphoneos-arm64.deb` (rootless arm64, `Version: 0.1`) em `integracao-modelo/packages/`.
- Bridge `com.aquiles.obsgraph-bridge_0.1-39_iphoneos-arm64.deb` (`Version: 0.1-39`) em `integracao-iphone/bridge/packages/`, copiado como `camera.deb` para `conexao-usb/` (repo) e `electron/services/iphone-setup/` (app). Ambos fora do git (`*.deb` ignorado).

**setup.js:** backport do app instalado para o repo (`ensureTunnel()`, listeners de erro do ssh2 com `on`+guarda `settled`, `launchctl kickstart mediaserverd` após instalar a ponte). `TARGET` ajustado de `0.1-39-1+debug` para `0.1-39` para casar com o pacote release (o mesmo ajuste foi aplicado no `setup.js` do app instalado). O bloco de instalação do `novamodel.deb` já está no repo, mas ainda **não** no app instalado (pendente da Fase C; exige colocar `novamodel.deb` em `electron/services/iphone-setup/`).

**Bundle:** `conexao-usb/dist/index-Dun7lr2S.patched.js` reaplicado no app (`dist/assets/index-Dun7lr2S.js`), levando o seletor de modelo (IPC `spoofer:get-ios-models`).

**DMG:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-06.dmg`, gerado do app instalado com `CFBundleVersion=20261106.1` e `LSMinimumSystemVersion=26.0`.

```
sha256  4bf34a8c0210dc81ba933ed45471e5febe814e63cc8836a2917c412722ded685
```

Assinatura ad hoc, sem Developer ID nem notarização. Estado registrado: `spctl --assess` no app dentro do DMG → `invalid Info.plist (plist or signature have been modified)`; no app instalado → `a sealed resource is missing or invalid`. Uso em outro Mac: abrir com Ctrl+clique → Abrir.

## Spoofing de modelo do iPhone (tweak + CLI) — 05/11/2026

Criado o pacote `com.aquiles.novamodel` (rootless) para o iPhone reportar outro modelo (ex. "iPhone 13" → `iPhone14,5`), a contraparte iOS do spoofing de identidade que hoje só existe em Android. Só modelo — sem IMEI/serial.

- **Tweak `NovaModel.dylib`** (Substrate, carrega em todo processo): hooka `MGCopyAnswer`/`MGCopyAnswerWithError`/`MGGetStringAnswer` (whitelist fechado: `ProductType`, `HWModelStr`, `ModelNumber`, `ProductName`, `MarketingProductName`), `sysctlbyname`/`sysctl` (`hw.machine`, `hw.product`) e `UIDevice` (`model`, `localizedModel`, `modelName`/`_modelName` privados). Lê `/var/tmp/nova-model-control.json` com cache por mtime (aplicação instantânea).
- **CLI `/var/jb/usr/bin/novamodel`** (setuid root): `set <productType>` (valida no banco e grava o control file), `clear`, `status` (JSON `real`/`active`/`enabled`). Roda sem o tweak, então `status` lê o ProductType real.
- **Banco de modelos** `models.json` (27 modelos: iPhone 8 → 15), instalado em `/var/jb/usr/share/novamodel/models.json`.

Arquivos: `integracao-modelo/` (Tweak.x, main.m, models.json, Makefile, layout, test). Compila no theos e gera `.deb` rootless arm64 (`packages/com.aquiles.novamodel_0.1-*.deb`). Teste automatizado `test/teste-novamodel.cjs` valida banco, contrato do control file e whitelist MG. **Sem testar no aparelho real** (efeito em Ajustes/Sobre e apps, `dpkg -i`, setuid); `HWModelStr`/`ModelNumber` estão no whitelist mas não são spoofados na v1 (códigos de placa/número de modelo são por variante/região).

## Spoofing de modelo do iPhone — serviço + IPC + instalação do .deb — 05/11/2026

Integração no app para o tweak `com.aquiles.novamodel` (spec `NOVA-AI-MODELO-SPOOF-SPEC.md`). No `physicalMobileService` entraram `getIosModels()`, `applyIOSModel(deviceId, productType)`, `clearIOSModel(deviceId)` e `getIOSModel(deviceId)` — chamam `/var/jb/usr/bin/novamodel` via `iosSsh` (túnel USB). IPCs novos em `main.js`: `spoofer:get-ios-models`/`spoofer:apply-ios-model`/`spoofer:clear-ios-model`/`spoofer:get-ios-model` (nomes do contrato da UI). Banco de modelos em `iosModels.json`; instalação do `novamodel.deb` pelo fluxo Conectar (guarded: só quando o `.deb` existir ao lado do `camera.deb`).

- Arquivos: `integracao-iphone/ios-modelo.js` (novo), `integracao-iphone/iosModels.json` (novo), `integracao-iphone/physicalMobileService.patched.js`, `integracao-iphone/conexao-usb/setup.js`, `integracao-modelo-app/main.modelo.js`, `integracao-modelo-app/novamodel.test.cjs`, `integracao-modelo-app/README.md`.
- Testado: `node --check` nos arquivos tocados + `novamodel.test.cjs` (30 verificações com mock de SSH).
- Sem testar: instalação e execução real do CLI (o `.deb` do Jailbreak Specialist ainda não existe) e o IPC no Electron (só sintaxe + mock). Detalhes: `MAC/integracao-modelo-app/README.md`.

## Seletor de modelo do iPhone no painel "Identidade simulada" — 05/11/2026

Spoofing de modelo do iPhone na UI: no painel **Identidade simulada** (janela "Controle do Celular"), o seletor de modelo do iPhone agora é alimentado pelo banco de modelos iOS e tem botões **Aplicar modelo** e **Limpar modelo**.

- **Seletor:** populado dinamicamente via `spoofer:get-ios-models` (27 modelos do banco do serviço, `{productType, name}`); o bundle não tem mais lista fixa. Ex.: iPhone 13 = `iPhone14,5`.
- **Contrato de IPC (bundle → main):** `spoofer:get-ios-models` (sem args → `{success, models[]}`), `spoofer:apply-ios-model {deviceId, productType}` (aplica), `spoofer:clear-ios-model {deviceId}` (restaura o real) e `spoofer:get-ios-model {deviceId}` (lê `{real, active, enabled}`). Os handlers no `main.js`/`physicalMobileService` são do iOS Engineer; o bundle já chama esses canais. Se o IPC ainda não existir, o seletor mostra a falha no painel (estado "error").
- **Estados:** `applying` (spinner), `applied` (verde, "Modelo aplicado no iPhone"), `idle` (modelo real) e `error` (vermelho). Ao abrir a aba, `spoofer:get-ios-model` lê o estado atual.
- **Texto pt-BR**; nomes de modelo (dados de spoofing) não traduzidos.

Arquivos: `MAC/integracao-iphone/conexao-usb/dist/index-Dun7lr2S.patched.js` (patch no bundle). Reaplicado `aplicar-botao-iphone.py` (idempotente) e `node --check` OK.

Sem testar: execução real no app (bundle patcheado ainda não copiado para `/Applications/Nova AI Mac.app`) e o fluxo Aplicar/Limpar contra o tweak `novamodel` no iPhone (depende do iOS Engineer expor os IPCs e do Jailbreak Specialist instalar o `.deb`).

## Chave SSH do iPhone agora é do app — 04/11/2026

A chave usada para falar com o iPhone saiu de `~/.ssh/id_iphone` e passou para `~/Library/Application Support/nova_dsktp/iphone-ssh/` (modo 0600), junto com o `known_hosts` do aparelho. Todos os `ssh`/`scp` do app usam `-i` explícito, `IdentitiesOnly=yes` e `UserKnownHostsFile=` desse diretório, então não caem mais nas outras chaves do agente SSH do Mac.

- `services/iphone-ssh.js` é o único lugar que conhece o caminho; `setup.js`, `physicalMobileService.js`, `ios-camera.js`, `cam-live-iphone.js` e `ios-bridge.js` passaram a usar `sshOptions()`.
- Migração automática no boot (`migrateLegacy()`): se existir `~/.ssh/id_iphone` e ainda não houver a do app, ela é **movida** (não copiada) e a linha `[127.0.0.1]:2222` do `known_hosts` é herdada. É a mesma chave, o iPhone continua autorizando — não precisa refazer o Conectar.
- Em teste (`NOVA_SMOKE_TEST=1`) a migração não roda; `NOVA_USER_DATA` isola os caminhos.
- Não é isolamento criptográfico: qualquer processo do mesmo usuário do macOS ainda lê o arquivo (0600). O ganho é sair do `~/.ssh` (fora de dotfiles, backups e outras ferramentas) e ter par chave/known_hosts só do app.

Verificação: migração simulada com `HOME` falso moveu a chave com 0600, herdou o known_hosts e gerou as opções certas; 15 testes do CAM LIVE + `setup.test.cjs` + `botao-servico.test.cjs` passando. **Reinicie o Nova** para a migração acontecer. No repo, `integracao-camlive/`, `integracao-sequestro-cam/` e `encerramento-nova/` têm um shim `iphone-ssh.js` porque neles os arquivos não ficam lado a lado como em `electron/services/`.

## Cartão do iPhone: "Abrir controle" reaplicado — 04/11/2026

O bundle em uso (`dist/assets/index-Dun7lr2S.js`) estava **sem** o patch do botão do iPhone: o cartão de um aparelho já preparado mostrava **PARAR TRANSMISSÃO** (vermelho) em vez de **Abrir controle**, o que dá a impressão de transmissão ativa mesmo com o aparelho parado — o `streaming` do iOS é o registro de pareamento (`iphone-hosts.json`), não uma transmissão real. Outro patch de bundle aplicado depois (controle de celular/geo-proxy) sobrescreveu o trecho.

Reaplicado `conexao-usb/aplicar-botao-iphone.py` no app instalado: iPhone preparado agora mostra **Abrir controle** (ciano) e abre o console direto; Android continua com **Parar transmissão**. A lista de dispositivos já se atualiza sozinha a cada 5 s (o painel faz `setInterval` de `physical-mobile:get-status`), então desplugado deixa de aparecer. Cópia canônica do bundle em `conexao-usb/dist/index-Dun7lr2S.patched.js`; anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/index-Dun7lr2S.antes-botao.js`.

**Regra nova no `AGENTS.md`:** qualquer patch futuro no bundle precisa reaplicar este script (é idempotente) antes de copiar para o app, senão o botão volta a regredir. Recarregue com **Cmd+R** ou reinicie o Nova.

## Transporte camuflado Mac → iPhone (bridge 0.1-39) — 04/11/2026

O que a Câmera do iPhone consome deixou de ser `http://127.0.0.1:18999/frame.jpg`.

- O servidor do Mac (CAM LIVE e CAM HIJACK) só responde em `/s/<token de 32 hex>/frame.jpg` e `/s/<token>/audio`; sem o token a resposta é 404 neutro. O token é novo a cada sessão.
- O túnel SSH tenta primeiro um **socket Unix** em `/var/tmp/.nb-<8hex>.sock` (modo 666 para o mediaserverd). Nenhuma porta TCP fica escutando no iPhone. Se o sshd do aparelho recusar streamlocal, cai para uma **porta TCP aleatória** (20000–39999) com o mesmo token; o `-v` do ssh foi removido.
- O bridge 0.1-39 valida o caminho com token, aceita `socket` no control, recusa a rota antiga e **removeu o IP fixo `10.0.0.245:8900`** que vinha do projeto original.
- O sequestro (item 3) passou a pedir o endereço ao CAM LIVE (`mediaEndpoint()`): CAM LIVE, CAM HIJACK e sequestro compartilham o mesmo token/transporte em vez de repetir 18999.

Compatibilidade: pontes 0.1-38 e anteriores são recusadas ("atualize por USB") porque não conhecem o token. Atualize pelo **Conectar** em PHONE CONTROL — o `camera.deb` 0.1-39 já está incluído no app.

Arquivos: `integracao-iphone/bridge/Tweak.x` (0.1-39), `integracao-camlive/cam-live-iphone.js`, `integracao-iphone/ios-camera.js` (= `integracao-sequestro-cam/ios-camera.patched.js`), `conexao-usb/setup.js` (alvo 0.1-39) e `conexao-usb/camera.deb`. Reservas do instalado anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/`. Testes: 15 passam (`node --test` em `integracao-camlive/test/`), incluindo token/404, socket Unix, fallback TCP e sequestro. **Não testado no aparelho**: se o sshd do iPhone aceita `-R` com socket Unix e se o mediaserverd (sandbox) consegue conectar; se recusar, o fallback TCP entra sozinho. Reinicie o Nova e refaça o Conectar para instalar a 0.1-39.

## Conexão do iPhone dentro do app — 04/11/2026

O **Conectar** dos iPhones em PHONE CONTROL deixou de abrir uma janela/página externa para a senha SSH. Agora o formulário, o progresso e o controle do iPhone são desenhados **dentro da janela do Nova**, como um modal do próprio app: fundo escurecido e embaçado, mesmo visual do Controle do Celular, X/Esc para fechar (bloqueado durante a preparação) e tempo decorrido.

A senha continua só em memória: o campo é limpo antes do envio ao processo principal, a senha não entra em log nem em mensagem de erro. O modal roda no preload (`inapp.js`), fora do bundle React — não depende do `index-Dun7lr2S.js`. Depois do sucesso, "Abrir controle e tela do iPhone" carrega o iPhone Console num `<webview>` dentro do app, com "Abrir em janela" como alternativa.

Depois de conectar, o cartão do iPhone não fica mais em **Conectar**: passa a **Abrir controle**, que abre o console dentro do app sem senha. O estado vem do registro `iphone-hosts.json` gravado por um Conectar bem-sucedido; Android segue com "Parar transmissão" e o botão **Refazer conexão** fica no topo do controle.

Arquivos: `integracao-iphone/conexao-usb/` (`inapp.js`, `setup.js`, `aplicar-botao-iphone.py`, `botao.test.cjs`, `botao-servico.test.cjs`, `setup.test.cjs`, `test/modal/`, `dist/index-Dun7lr2S.patched.js`, `docs/`), com os arquivos da janela antiga em `integracao-iphone/reservas/modal-externo-20261104/` e o estado anterior desta rodada em `integracao-iphone/reservas/botao-conectado-20261104/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: `node --check` nos quatro arquivos; testes do serviço (senha inválida, aparelho único, janela ausente); harness em Electron com o **preload real** abrindo o modal por IPC, enviando a senha e confirmando o campo vazio; estados idle/preparando/sucesso/erro e o webview do console renderizados sem exceção. **Conexão real no aparelho não refeita** (exige a senha do iPhone) e **reiniciar o Nova** para carregar.

## Foto ➔ Vídeo (Kling) acessível e corrigido — 03/11/2026

A função de animar foto em vídeo (Capítulo 3 do guia) existia no código, mas estava **sem botão de acesso** nesta versão: a seção "kling" da Suíte de Vídeo só abria por um evento interno (`nova-open-kling-video`) que nada disparava. Foram corrigidos 7 problemas no fluxo:

1. **Botão novo** "Foto ➔ Vídeo" na barra da Suíte e Estúdio de Vídeo (AI UPLOAD), entre "Criador de IA" e "Recortador Seguro" — abre a seção de selecionar foto → movimento → proporção/duração → converter.
2. **FFmpeg do Mac**: o serviço só procurava `ffmpeg.exe` (Windows); agora acha o `Resources/bin/ffmpeg` do macOS. Sem isso, o motor gratuito offline sempre falhava.
3. **Pasta de saída errada**: o vídeo era salvo em `cwd/youtube_auto/exports` (caía no Downloads) enquanto a biblioteca "Arquivos Exportados" lê `app/youtube_auto/exports` — o vídeo nunca apareceria na lista. Agora salva na pasta certa.
4. **Tamanho real do arquivo** na biblioteca (era fixo 5 MB).
5. **WebP** enviado com mime correto para a Kling Cloud.
6. **Tradução**: 12 textos em inglês esquecidos no fluxo ("Clear Picture", "Converting Picture into Video...", mensagens de status, "Library (n)" etc.).
7. **Assinatura** ad-hoc refeita após o patch (`codesign --verify` OK).
8. **Prévia do vídeo cinza (0:00)**: as URLs `file:///` eram montadas com padrão de Windows (`file:///` + caminho absoluto Unix = 4 barras), e o Chromium não achava o arquivo — o vídeo era gerado certo, mas o player ficava escuro. Corrigido para o player "✨ Vídeo Gerado Pronto" e para a prévia da foto escolhida via "Procurar Arquivos". O botão "Salvar Vídeo" e sua mensagem também foram traduzidos ("Save to Phone Storage" etc.).
9. **Vídeo saía parado (foto imóvel)**: o motor local usava `zoompan` com estado acumulado (`zoom+0.0012`) e `-loop 1`, combinação que congelava o efeito com certas fotos de entrada (verificado num caso real: 10 s de imagem imóvel, PSNR 61 entre quadros distantes). Reescrito com expressões puras em função do número do quadro (`on`), sem `-loop`, na receita canônica do FFmpeg para Ken Burns — o movimento agora vai do primeiro ao último quadro em todos os 5 presets. Teste `test/teste-movimento.cjs`: 20 combinações (5 presets × jpg/png/webp em vários tamanhos), todas com movimento medido (PSNR 6–13 entre 1 s e 8 s).
10. **"Salvar Vídeo" baixava HTML quebrado**: o botão usava download por âncora de URL `file://`, que o Chromium bloqueia — salvava uma página de erro de 15 KB com nome .mp4 (por isso "não pode ser aberto" no Mac). Novo IPC `kling:save-video` no `main.js` copia o arquivo real para o Downloads (sem sobrescrever: acrescenta -2, -3…), abre o Finder no arquivo e o botão usa esse IPC com fallback. As 3 cópias quebradas no Downloads do usuário foram substituídas pelos vídeos reais. Original do `main.js` antes deste patch em `reservas/instalado-antes-kling-2026-11-03-main.js`.
11. **IA do Sistema (Veo) no Foto ➔ Vídeo**: o app tinha chave Gemini configurada (`secret_key.json`, lida por `app.getGeminiToken()` — a mesma do Nova Studio), mas nenhum caminho de geração de vídeo. Adicionado o motor "IA do Sistema" no `kling-video-service.js` (`_generateSystemAIVideo`) com **auto-descoberta**: consulta `ListModels` (gratuito) e usa os modelos Veo que a chave tiver. **Testado com a chave atual: a API listou 60 modelos e nenhum é Veo** — ou seja, a chave do Nova não tem acesso a vídeo (Veo via API exige faturamento Google). O caminho fica pronto para o dia em que o faturamento for ativado.
12. **Motor fal.ai no Foto ➔ Vídeo (botão verde)**: como a chave do Nova não faz vídeo, o botão "Converter com IA fal.ai" usa a chave **fal-key do Chaveiro do Mac** (a mesma do projeto criar-videos, lida com `security find-generic-password`). Fila `queue.fal.run`, imagem em data URI, modelo mais barato primeiro (`fal-ai/bytedance/seedance/v1/lite/image-to-video`, fallbacks Wan 2.2 e Kling 2.1), 720p, duração 5/10 s, espera com progresso e download para `exports`. **Custa por vídeo na conta fal.ai** — confirmar antes de gerar. Reinicie o Nova para carregar.

Arquivos: `integracao-kling/` (fontes patcheadas + `reservas/` com os originais de antes + `test/teste-motor-local.cjs`). Teste de ponta a ponta do motor local passou no app instalado: imagem de teste → MP4 720×1280 válido em `app/youtube_auto/exports`, com progresso e limpeza automáticos. **Reinicie o Nova para carregar.** Sem chave da API Kling, usa o Nova Motion Engine local (grátis, Ken Burns por FFmpeg); com chave, envia para `api.klingai.com` (kling-v1) — a autenticação Bearer da Kling pode exigir JWT próprio dela, não validado (não há conta para testar). O DMG não foi regenerado.

## CAM LIVE direto para o iPhone por USB — 03/11/2026

O CAM LIVE agora transmite **sem OBS, MediaMTX nem servidor RTMP**. O destino padrão é "iPhone por USB — automático" (formato celular 720×1280): o renderer envia JPEG (`camlive:frame`) e PCM das cenas (`camlive:pcm`); o processo principal (`cam-live-iphone.js`) serve `/frame.jpg` e `/audio` em loopback, abre o túnel SSH reverso para a porta 18999 do iPhone, codifica o áudio em AAC-LC 44,1 kHz com o FFmpeg incluído e só ativa a câmera depois de haver imagem **e** áudio. RTMP continua em Configurações → Avançado. Não há IP, porta ou chave para digitar.

Pré-requisito: iPhone conectado por **Conectar** (PHONE CONTROL) — exatamente um iPhone, ponte 0.1-38 com hooks de foto prontos. O pacote 0.1-38 agora acompanha o Nova (`conexao-usb/camera.deb`) e é instalado/atualizado por Conectar no iPhone10,2 / iOS 16.7.16. Um `enabled:true` antigo na ponte com lease expirado já não bloqueia o início.

Arquivos: `integracao-camlive/` (cam-live.js, cam-live-audio.js, cam-live-service.js, cam-live-iphone.js); aplicado no app instalado, com cópia do `main.js` anterior em `integracao-camlive/reservas/instalado-antes-usb-*`. Testes: `test/iphone-*.cjs` (14 testes passam) e `test/harness-usb.js` (iPhone simulado: ~16 fps de JPEG válidos e PCM em tempo real chegaram; parar interrompe os dois). FFmpeg incluído gerou ADTS aceito pelo parser.

**Não testado:** transmissão real até a Câmera do iPhone (a imagem aparecer no app Câmera), aparelhos além do iPhone 8 Plus, e o DMG não foi regenerado — o instalador final ainda não contém esta mudança. Reinicie o Nova para carregar. Windows fica para depois.

## Pacote Mac portátil de 03/11/2026

**Arquivo para compartilhar:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-03-final.dmg`. Use a versão `-final`; a primeira imagem foi uma tentativa intermediária e foi preservada. A cópia final do app passou na verificação de assinatura local `codesign --verify --deep --strict`.

Destino inicial: Mac Apple Silicon com macOS 26+. Windows fica para uma etapa posterior. O requisito macOS 26 vem dos binários efetivamente incluídos, não do Electron: auditoria de 227 arquivos Mach-O encontrou requisito máximo 26.0 e nenhuma dependência carregada de Homebrew, `/usr/local` ou `/Users`.

Python/PortAudio e bibliotecas foram incluídos em `python-runtime-portable/`, Chromium em `browsers/`, e os serviços passaram a usar o Python interno. Validados importação de módulos de áudio/rede/compressão/SQLite, HTTPS com certificados incluídos e lançamento do navegador interno. O Python também executou na cópia em outra pasta. O pacote exclui o venv antigo e a tentativa incompleta de runtime; nenhuma dessas cópias originais foi apagada.

O Nova abriu com perfil vazio e PATH mínimo (`SMOKE_EXIT 0`), com interface React carregada e API Electron disponível. Evidências em `distribuicao/teste-perfil-vazio-1793726904588/` e `distribuicao/verificacao-binarios.json`. Isso não substitui teste em outro Mac limpo. Não há validação de todas as funcionalidades, nem adaptação da ponte 0.1-38. Upload automático do YouTube continua sem pipeline. Serviços online continuam dependendo de internet e contas próprias.

Scripts de reprodução e auditoria em `integracao-iphone/distribuicao/`. Os dados pessoais de Application Support, perfis de navegador e chaves SSH não são copiados para a distribuição. A assinatura é local, sem notarização Apple.

## Portabilidade — revisão inicial de 03/11/2026 (histórico)

As ferramentas USB iPhone (`iproxy`, `idevice_id`, `ideviceinfo`, `ideviceinstaller`) e nove bibliotecas agora estão em `Contents/Resources/ios-tools/`. Os serviços iPhone passaram a resolver apenas esses executáveis incluídos no app. Teste: todas as quatro ferramentas iniciam com `PATH=/usr/bin:/bin`; nenhum dos 13 arquivos Mach-O possui dependência absoluta de Homebrew. Licenças locais foram copiadas para `ios-tools/licenses/`. Script de reprodução: `integracao-iphone/distribuicao/empacotar-ferramentas.py`.

**Na revisão inicial, a distribuição ainda não estava pronta.** O Python incluído era um venv com `home` e executável de origem no Homebrew; precisa de um runtime portátil para funções Python. O instalador DMG/ZIP existente continua antigo. Falta testar em outro Mac sem ferramentas de desenvolvimento. Esta alteração não atualiza o EXE Windows. O iPhone ainda precisa ter jailbreak ativo e OpenSSH, e CatVNC tem configuração própria. Contas e credenciais devem ser configuradas por cada usuário, sem copiar dados de `Application Support` ou chaves SSH pessoais.

## Conexão iPhone por senha SSH — 03/11/2026

O botão dos iPhones em DEVICES agora mostra **Conectar** e abre uma janela para a senha SSH do usuário `mobile`. O fluxo exige jailbreak ativo e OpenSSH já instalado no iPhone. A senha fica apenas em memória durante a operação. O app prepara uma chave SSH, verifica o acesso e oferece abrir o console. Exige somente um iPhone conectado; não faz jailbreak automaticamente.

O pacote OBSGraphBridge 0.1-30 está incluído no app e pode ser instalado sem download externo no iPhone10,2 com iOS 16.7.16. Outras versões já instaladas são preservadas. Não há instalação automática do CatVNC nem suporte universal às funções Android: o fluxo informa essas limitações. CatVNC ainda exige instalação e configuração próprias.

Fontes e testes: `integracao-iphone/conexao-usb/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: sintaxe do main, bundle em modo módulo, serviço, carregamento do SSH e testes de limites IPC/múltiplos aparelhos. **Conexão e instalação reais no aparelho ainda não testadas neste fluxo.** Reinicie o Nova para carregar as alterações.


## Tradução para pt-BR de 03/11/2026

O app instalado (`/Applications/Nova AI Mac.app`) foi traduzido inteiro para português do Brasil — só texto de interface, sem tocar em nenhuma função. Traduzidos: bundle da interface (`dist/assets/index-Dun7lr2S.js`, ~1.900 substituições), `dist/index.html`, PWA (`electron/pwa/`: index, admin, app.js, manifest), menus/diálogos do `electron/main.js`, mensagens visíveis dos services e a extensão nova-grab. **Reinicie o app para ver a tradução.** Cópia de todos os arquivos originais está em `../backup-antes-traducao/`. Nomes de hardware (Apple M1, Galaxy, GPUs — são valores de spoofing), modelos de IA e termos técnicos (Stop Loss, SKU, ADB) foram mantidos de propósito.

## Atualização local de 02/11/2026 — CAM HIJACK iPhone

O app instalado recebeu encaminhamento iOS para CAM HIJACK, correção do caminho do APK Android e textos de preparação por plataforma. Fontes, testes, reservas e o instalador iOS estão em `integracao-iphone/`.

**Pendente:** executar `integracao-iphone/instalar-iphone.command` no Terminal (sudo do iPhone) e validar a imagem na Câmera. O pacote nativo compilado é OBSGraphBridge 0.1-30 com suporte ao túnel USB em localhost:18999. O fluxo ativa a prévia nativa experimental; fotos/vídeos gravados e outros apps não estão validados nem habilitados nesta integração.

**O DMG abaixo é anterior a esta atualização e já não é idêntico ao app instalado.**

**Instalador anterior:** `Nova-AI-Mac-sem-ativacao.dmg` (1/11/2026, 789 MB) — é idêntico ao app **já instalado em `/Applications/Nova AI Mac.app`**, que é o que você usa no dia a dia. O `.zip` é o mesmo app em formato zip (backup).

## O que já foi feito ✅

### Port e base
- Port do instalador Windows (Electron) para macOS arm64, módulos nativos recompilados (SQLite, RobotJS).
- Ferramentas nativas embutidas: FFmpeg, ADB, scrcpy, cloudflared, yt-dlp.
- **Ativação removida**: sem tela de chave, sem formulário, sem consulta ao servidor de licença do fornecedor. Abre direto no painel.
- Instalado em `/Applications` (não precisa mais rodar do DMG).

### Segurança (endurecimento)
- **Túnel público do Cloudflare desligado por padrão** (só liga com `NOVA_REMOTE_TUNNEL=1` no terminal).
- **Todos os servidores internos escutam só em 127.0.0.1** (interface, WebSocket, RTMP) — nada exposto pra rede Wi-Fi ou internet.
- Correção crítica: o servidor RTMP interno não derruba mais o app quando a porta está ocupada.

### Recursos ativos
- **RTMP do Nova: porta 11935** (1935 é do MediaMTX). Para o Android via cabo nada muda (`adb reverse` entrega a 1935 dentro do celular). De outro computador: `rtmp://<ip-do-mac>:11935/live/nova`.
- **Wake word (ativação por voz): funcionando.** PortAudio + SpeechRecognition + sounddevice instalados no Python embutido. Precisa de internet (API de fala do Google) e permissão de microfone.
- **Mobile Cam Bridge**: câmera do celular alimentando o painel.
  - Android: página própria do app.
  - iPhone: Safari + túnel SSH por cabo (https://127.0.0.1:8899/pc-cam no celular) — nunca usa Wi-Fi.
- **PC → PHONE**: webcam do Mac aparecendo no celular (iPhone via túnel USB: https://127.0.0.1:8899/pc-cam).

### NOVO: iPhone integrado na aba PHONE CONTROL ✅
Com o iPhone 8 Plus **plugado no cabo** (jailbreak religado, OpenSSH ativo — a chave `~/.ssh/id_iphone` já está configurada):
- **DEVICES**: aparece como "iPhone 8 Plus (iOS 16.7.16)" na lista de aparelhos, igual um Android.
- **CONTROLS**: abre a janela **iPhone Console** dentro do sistema (sem navegador externo) — tela ao vivo controlável (clique = toque) via CatVNC + noVNC por cabo.
- **APPS**: listar apps instalados e abrir por nome — com tradução automática de pacotes Android→iOS (WhatsApp, Instagram, Chrome etc.).
- **BROWSER**: campo de URL abre o link no Safari do iPhone.
- **Screenshot**: salva imagem da tela (via canvas da tela ao vivo).
- Senha pedida na primeira conexão: a que você definiu em **Ajustes → CatVNC** (fica memorizada na página).
- Os túneis (iproxy 5900/2222) têm **auto-recuperação**: se caem, o app recria em segundos.

## O que ainda falta fazer ⏳

- **Fase 2 — SPOOFER / CAM HIJACK para iPhone**: vídeo do Mac virando a câmera NATIVA do iPhone, conectando o Nova ao seu tweak VCamMin (o equivalente do APK Android). É o último pedaço pra paridade total com o Android.
- **Toggles de Wi-Fi/Bluetooth** no CONTROLS para iPhone: respondem "não suportado por SSH" (Apple não expõe isso).
- **`youtube_auto/pipeline.py`**: o instalador original nem inclui esse arquivo — a automação de upload depende de reconstruí-lo.
- **Integrações que dependem das suas contas** (WhatsApp, Telegram, Google, chaves de IA): instaladas mas sem validação completa.
- **Câmera virtual completa, Antigravity, Stable Diffusion**: sem validação de fluxo completo.
- **Wake word com microfone real**: motor instalado e rodando; falta testar em uso com permissões do macOS.
- **Atualização automática**: não configurada (o feed do fornecedor é Windows-only).
- **Notarização Apple**: o app é assinado localmente (ad-hoc) — a primeira abertura sempre exige botão direito → Abrir.

## Arquivos desta pasta

| Arquivo | Papel |
|---|---|
| `Nova-AI-Mac-sem-ativacao.dmg` | **Instalador atual** (idêntico ao app instalado) |
| `Nova-AI-Mac-sem-ativacao.zip` | Mesmo app em zip (backup) — duplicado do DMG |
| `Nova-AI-Mac-Preview-com-ativacao.dmg` | Versão antiga com tela de ativação original (só se quiser usar a licença do fornecedor) |
| `LEIA-ME.md` | Este arquivo |

Gerado e mantido localmente. Não é distribuição oficial do fornecedor.

# Nova AI para macOS (Apple Silicon) — estado do projeto

## Correção do guard `this.mobile` no CAM LIVE (branch, sem merge) — 06/11/2026

Branch `agent/backend/cam-spoof-guard-20261106` (a partir de `main` `67673e3`), **sem merge na main e sem push**. Corrige o defeito que o QA achou no caminho "ligar a injeção antes de transmitir": `TypeError: Cannot read properties of undefined (reading 'iosSsh')` em `_camouflagedForward()`.

- Causa: `this.mobile` só era atribuído dentro de `_start()`; quem clicava em "Ligar" sem iniciar o CAM LIVE antes nunca passava por `_start()`, então `this.mobile` ficava `undefined`. A linha do `chmod` era engolida pelo `catch(_)` e a do `rm -f` (dentro do catch) estourava.
- `ensureTransport()`: antes de `_tunnel()`, adicionada a guarda `if (!this.mobile) this.mobile = this.getMobileService?.();` (a mesma que o app já usa em `_readState()`).
- `_camouflagedForward()`: o `catch(_)` silencioso agora lança `"Abra PHONE CONTROL e conecte o iPhone antes de ligar a injeção."` quando `this.mobile` não existe (em vez de engolir o erro).
- Aplicado nas duas cópias do repo: `integracao-camlive/cam-live-iphone.js` e `integracao-sequestro-cam/cam-live-iphone.patched.js`. **App instalado em `/Applications` não foi tocado** (fica para o Security & Infra, com aprovação).
- Teste `integracao-sequestro-cam/controles-independentes.test.cjs` atualizado: `version: '0.1-38'` → `'0.1-39'` e a rota `/frame.jpg` → `live.media.framePath` (`/s/<token>/frame.jpg`).

**Verificação:** `controles-independentes.test.cjs` 2 de 2 passando; `setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` OK; `node --check` nos arquivos tocados OK.

## Fase A — merge do seletor de modelo + pacotes release — 06/11/2026

Merge na `main` (de `530920e`) das três branches do seletor de modelo do iPhone, em sequência: `agent/jailbreak/modelo-iphone-20261105` → `agent/ios/modelo-iphone-20261105` → `agent/frontend/modelo-iphone-20261105` (merge octopus falharia no `MAC/LEIA-ME.md`). Conflito resolvido mantendo as três seções no topo (tweak+CLI, serviço+IPC, seletor da UI). Commits de merge: `93c63a5`, `b9d3116`, `b5c3522` (não enviados — push pendente de autorização).

**Testes após o merge:** `integracao-modelo/test/teste-novamodel.cjs` (5 ok), `integracao-modelo-app/novamodel.test.cjs` (30 verificações), `conexao-usb/setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` passando. `integracao-sequestro-cam/controles-independentes.test.cjs` **falha pré-existente** (já falhava em `530920e`): o teste fixa a ponte em `0.1-38` e espera o fluxo de injeção anterior à bridge 0.1-39; não foi alterado nesta fase — precisa de decisão separada.

**Pacotes release (theos, `FINALPACKAGE=1 DEBUG=0`):**
- Tweak `com.aquiles.novamodel_0.1_iphoneos-arm64.deb` (rootless arm64, `Version: 0.1`) em `integracao-modelo/packages/`.
- Bridge `com.aquiles.obsgraph-bridge_0.1-39_iphoneos-arm64.deb` (`Version: 0.1-39`) em `integracao-iphone/bridge/packages/`, copiado como `camera.deb` para `conexao-usb/` (repo) e `electron/services/iphone-setup/` (app). Ambos fora do git (`*.deb` ignorado).

**setup.js:** backport do app instalado para o repo (`ensureTunnel()`, listeners de erro do ssh2 com `on`+guarda `settled`, `launchctl kickstart mediaserverd` após instalar a ponte). `TARGET` ajustado de `0.1-39-1+debug` para `0.1-39` para casar com o pacote release (o mesmo ajuste foi aplicado no `setup.js` do app instalado). O bloco de instalação do `novamodel.deb` já está no repo, mas ainda **não** no app instalado (pendente da Fase C; exige colocar `novamodel.deb` em `electron/services/iphone-setup/`).

**Bundle:** `conexao-usb/dist/index-Dun7lr2S.patched.js` reaplicado no app (`dist/assets/index-Dun7lr2S.js`), levando o seletor de modelo (IPC `spoofer:get-ios-models`).

**DMG:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-06.dmg`, gerado do app instalado com `CFBundleVersion=20261106.1` e `LSMinimumSystemVersion=26.0`.

```
sha256  4bf34a8c0210dc81ba933ed45471e5febe814e63cc8836a2917c412722ded685
```

Assinatura ad hoc, sem Developer ID nem notarização. Estado registrado: `spctl --assess` no app dentro do DMG → `invalid Info.plist (plist or signature have been modified)`; no app instalado → `a sealed resource is missing or invalid`. Uso em outro Mac: abrir com Ctrl+clique → Abrir.

## Spoofing de modelo do iPhone (tweak + CLI) — 05/11/2026

Criado o pacote `com.aquiles.novamodel` (rootless) para o iPhone reportar outro modelo (ex. "iPhone 13" → `iPhone14,5`), a contraparte iOS do spoofing de identidade que hoje só existe em Android. Só modelo — sem IMEI/serial.

- **Tweak `NovaModel.dylib`** (Substrate, carrega em todo processo): hooka `MGCopyAnswer`/`MGCopyAnswerWithError`/`MGGetStringAnswer` (whitelist fechado: `ProductType`, `HWModelStr`, `ModelNumber`, `ProductName`, `MarketingProductName`), `sysctlbyname`/`sysctl` (`hw.machine`, `hw.product`) e `UIDevice` (`model`, `localizedModel`, `modelName`/`_modelName` privados). Lê `/var/tmp/nova-model-control.json` com cache por mtime (aplicação instantânea).
- **CLI `/var/jb/usr/bin/novamodel`** (setuid root): `set <productType>` (valida no banco e grava o control file), `clear`, `status` (JSON `real`/`active`/`enabled`). Roda sem o tweak, então `status` lê o ProductType real.
- **Banco de modelos** `models.json` (27 modelos: iPhone 8 → 15), instalado em `/var/jb/usr/share/novamodel/models.json`.

Arquivos: `integracao-modelo/` (Tweak.x, main.m, models.json, Makefile, layout, test). Compila no theos e gera `.deb` rootless arm64 (`packages/com.aquiles.novamodel_0.1-*.deb`). Teste automatizado `test/teste-novamodel.cjs` valida banco, contrato do control file e whitelist MG. **Sem testar no aparelho real** (efeito em Ajustes/Sobre e apps, `dpkg -i`, setuid); `HWModelStr`/`ModelNumber` estão no whitelist mas não são spoofados na v1 (códigos de placa/número de modelo são por variante/região).

## Spoofing de modelo do iPhone — serviço + IPC + instalação do .deb — 05/11/2026

Integração no app para o tweak `com.aquiles.novamodel` (spec `NOVA-AI-MODELO-SPOOF-SPEC.md`). No `physicalMobileService` entraram `getIosModels()`, `applyIOSModel(deviceId, productType)`, `clearIOSModel(deviceId)` e `getIOSModel(deviceId)` — chamam `/var/jb/usr/bin/novamodel` via `iosSsh` (túnel USB). IPCs novos em `main.js`: `spoofer:get-ios-models`/`spoofer:apply-ios-model`/`spoofer:clear-ios-model`/`spoofer:get-ios-model` (nomes do contrato da UI). Banco de modelos em `iosModels.json`; instalação do `novamodel.deb` pelo fluxo Conectar (guarded: só quando o `.deb` existir ao lado do `camera.deb`).

- Arquivos: `integracao-iphone/ios-modelo.js` (novo), `integracao-iphone/iosModels.json` (novo), `integracao-iphone/physicalMobileService.patched.js`, `integracao-iphone/conexao-usb/setup.js`, `integracao-modelo-app/main.modelo.js`, `integracao-modelo-app/novamodel.test.cjs`, `integracao-modelo-app/README.md`.
- Testado: `node --check` nos arquivos tocados + `novamodel.test.cjs` (30 verificações com mock de SSH).
- Sem testar: instalação e execução real do CLI (o `.deb` do Jailbreak Specialist ainda não existe) e o IPC no Electron (só sintaxe + mock). Detalhes: `MAC/integracao-modelo-app/README.md`.

## Seletor de modelo do iPhone no painel "Identidade simulada" — 05/11/2026

Spoofing de modelo do iPhone na UI: no painel **Identidade simulada** (janela "Controle do Celular"), o seletor de modelo do iPhone agora é alimentado pelo banco de modelos iOS e tem botões **Aplicar modelo** e **Limpar modelo**.

- **Seletor:** populado dinamicamente via `spoofer:get-ios-models` (27 modelos do banco do serviço, `{productType, name}`); o bundle não tem mais lista fixa. Ex.: iPhone 13 = `iPhone14,5`.
- **Contrato de IPC (bundle → main):** `spoofer:get-ios-models` (sem args → `{success, models[]}`), `spoofer:apply-ios-model {deviceId, productType}` (aplica), `spoofer:clear-ios-model {deviceId}` (restaura o real) e `spoofer:get-ios-model {deviceId}` (lê `{real, active, enabled}`). Os handlers no `main.js`/`physicalMobileService` são do iOS Engineer; o bundle já chama esses canais. Se o IPC ainda não existir, o seletor mostra a falha no painel (estado "error").
- **Estados:** `applying` (spinner), `applied` (verde, "Modelo aplicado no iPhone"), `idle` (modelo real) e `error` (vermelho). Ao abrir a aba, `spoofer:get-ios-model` lê o estado atual.
- **Texto pt-BR**; nomes de modelo (dados de spoofing) não traduzidos.

Arquivos: `MAC/integracao-iphone/conexao-usb/dist/index-Dun7lr2S.patched.js` (patch no bundle). Reaplicado `aplicar-botao-iphone.py` (idempotente) e `node --check` OK.

Sem testar: execução real no app (bundle patcheado ainda não copiado para `/Applications/Nova AI Mac.app`) e o fluxo Aplicar/Limpar contra o tweak `novamodel` no iPhone (depende do iOS Engineer expor os IPCs e do Jailbreak Specialist instalar o `.deb`).

## Chave SSH do iPhone agora é do app — 04/11/2026

A chave usada para falar com o iPhone saiu de `~/.ssh/id_iphone` e passou para `~/Library/Application Support/nova_dsktp/iphone-ssh/` (modo 0600), junto com o `known_hosts` do aparelho. Todos os `ssh`/`scp` do app usam `-i` explícito, `IdentitiesOnly=yes` e `UserKnownHostsFile=` desse diretório, então não caem mais nas outras chaves do agente SSH do Mac.

- `services/iphone-ssh.js` é o único lugar que conhece o caminho; `setup.js`, `physicalMobileService.js`, `ios-camera.js`, `cam-live-iphone.js` e `ios-bridge.js` passaram a usar `sshOptions()`.
- Migração automática no boot (`migrateLegacy()`): se existir `~/.ssh/id_iphone` e ainda não houver a do app, ela é **movida** (não copiada) e a linha `[127.0.0.1]:2222` do `known_hosts` é herdada. É a mesma chave, o iPhone continua autorizando — não precisa refazer o Conectar.
- Em teste (`NOVA_SMOKE_TEST=1`) a migração não roda; `NOVA_USER_DATA` isola os caminhos.
- Não é isolamento criptográfico: qualquer processo do mesmo usuário do macOS ainda lê o arquivo (0600). O ganho é sair do `~/.ssh` (fora de dotfiles, backups e outras ferramentas) e ter par chave/known_hosts só do app.

Verificação: migração simulada com `HOME` falso moveu a chave com 0600, herdou o known_hosts e gerou as opções certas; 15 testes do CAM LIVE + `setup.test.cjs` + `botao-servico.test.cjs` passando. **Reinicie o Nova** para a migração acontecer. No repo, `integracao-camlive/`, `integracao-sequestro-cam/` e `encerramento-nova/` têm um shim `iphone-ssh.js` porque neles os arquivos não ficam lado a lado como em `electron/services/`.

## Cartão do iPhone: "Abrir controle" reaplicado — 04/11/2026

O bundle em uso (`dist/assets/index-Dun7lr2S.js`) estava **sem** o patch do botão do iPhone: o cartão de um aparelho já preparado mostrava **PARAR TRANSMISSÃO** (vermelho) em vez de **Abrir controle**, o que dá a impressão de transmissão ativa mesmo com o aparelho parado — o `streaming` do iOS é o registro de pareamento (`iphone-hosts.json`), não uma transmissão real. Outro patch de bundle aplicado depois (controle de celular/geo-proxy) sobrescreveu o trecho.

Reaplicado `conexao-usb/aplicar-botao-iphone.py` no app instalado: iPhone preparado agora mostra **Abrir controle** (ciano) e abre o console direto; Android continua com **Parar transmissão**. A lista de dispositivos já se atualiza sozinha a cada 5 s (o painel faz `setInterval` de `physical-mobile:get-status`), então desplugado deixa de aparecer. Cópia canônica do bundle em `conexao-usb/dist/index-Dun7lr2S.patched.js`; anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/index-Dun7lr2S.antes-botao.js`.

**Regra nova no `AGENTS.md`:** qualquer patch futuro no bundle precisa reaplicar este script (é idempotente) antes de copiar para o app, senão o botão volta a regredir. Recarregue com **Cmd+R** ou reinicie o Nova.

## Transporte camuflado Mac → iPhone (bridge 0.1-39) — 04/11/2026

O que a Câmera do iPhone consome deixou de ser `http://127.0.0.1:18999/frame.jpg`.

- O servidor do Mac (CAM LIVE e CAM HIJACK) só responde em `/s/<token de 32 hex>/frame.jpg` e `/s/<token>/audio`; sem o token a resposta é 404 neutro. O token é novo a cada sessão.
- O túnel SSH tenta primeiro um **socket Unix** em `/var/tmp/.nb-<8hex>.sock` (modo 666 para o mediaserverd). Nenhuma porta TCP fica escutando no iPhone. Se o sshd do aparelho recusar streamlocal, cai para uma **porta TCP aleatória** (20000–39999) com o mesmo token; o `-v` do ssh foi removido.
- O bridge 0.1-39 valida o caminho com token, aceita `socket` no control, recusa a rota antiga e **removeu o IP fixo `10.0.0.245:8900`** que vinha do projeto original.
- O sequestro (item 3) passou a pedir o endereço ao CAM LIVE (`mediaEndpoint()`): CAM LIVE, CAM HIJACK e sequestro compartilham o mesmo token/transporte em vez de repetir 18999.

Compatibilidade: pontes 0.1-38 e anteriores são recusadas ("atualize por USB") porque não conhecem o token. Atualize pelo **Conectar** em PHONE CONTROL — o `camera.deb` 0.1-39 já está incluído no app.

Arquivos: `integracao-iphone/bridge/Tweak.x` (0.1-39), `integracao-camlive/cam-live-iphone.js`, `integracao-iphone/ios-camera.js` (= `integracao-sequestro-cam/ios-camera.patched.js`), `conexao-usb/setup.js` (alvo 0.1-39) e `conexao-usb/camera.deb`. Reservas do instalado anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/`. Testes: 15 passam (`node --test` em `integracao-camlive/test/`), incluindo token/404, socket Unix, fallback TCP e sequestro. **Não testado no aparelho**: se o sshd do iPhone aceita `-R` com socket Unix e se o mediaserverd (sandbox) consegue conectar; se recusar, o fallback TCP entra sozinho. Reinicie o Nova e refaça o Conectar para instalar a 0.1-39.

## Conexão do iPhone dentro do app — 04/11/2026

O **Conectar** dos iPhones em PHONE CONTROL deixou de abrir uma janela/página externa para a senha SSH. Agora o formulário, o progresso e o controle do iPhone são desenhados **dentro da janela do Nova**, como um modal do próprio app: fundo escurecido e embaçado, mesmo visual do Controle do Celular, X/Esc para fechar (bloqueado durante a preparação) e tempo decorrido.

A senha continua só em memória: o campo é limpo antes do envio ao processo principal, a senha não entra em log nem em mensagem de erro. O modal roda no preload (`inapp.js`), fora do bundle React — não depende do `index-Dun7lr2S.js`. Depois do sucesso, "Abrir controle e tela do iPhone" carrega o iPhone Console num `<webview>` dentro do app, com "Abrir em janela" como alternativa.

Depois de conectar, o cartão do iPhone não fica mais em **Conectar**: passa a **Abrir controle**, que abre o console dentro do app sem senha. O estado vem do registro `iphone-hosts.json` gravado por um Conectar bem-sucedido; Android segue com "Parar transmissão" e o botão **Refazer conexão** fica no topo do controle.

Arquivos: `integracao-iphone/conexao-usb/` (`inapp.js`, `setup.js`, `aplicar-botao-iphone.py`, `botao.test.cjs`, `botao-servico.test.cjs`, `setup.test.cjs`, `test/modal/`, `dist/index-Dun7lr2S.patched.js`, `docs/`), com os arquivos da janela antiga em `integracao-iphone/reservas/modal-externo-20261104/` e o estado anterior desta rodada em `integracao-iphone/reservas/botao-conectado-20261104/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: `node --check` nos quatro arquivos; testes do serviço (senha inválida, aparelho único, janela ausente); harness em Electron com o **preload real** abrindo o modal por IPC, enviando a senha e confirmando o campo vazio; estados idle/preparando/sucesso/erro e o webview do console renderizados sem exceção. **Conexão real no aparelho não refeita** (exige a senha do iPhone) e **reiniciar o Nova** para carregar.

## Foto ➔ Vídeo (Kling) acessível e corrigido — 03/11/2026

A função de animar foto em vídeo (Capítulo 3 do guia) existia no código, mas estava **sem botão de acesso** nesta versão: a seção "kling" da Suíte de Vídeo só abria por um evento interno (`nova-open-kling-video`) que nada disparava. Foram corrigidos 7 problemas no fluxo:

1. **Botão novo** "Foto ➔ Vídeo" na barra da Suíte e Estúdio de Vídeo (AI UPLOAD), entre "Criador de IA" e "Recortador Seguro" — abre a seção de selecionar foto → movimento → proporção/duração → converter.
2. **FFmpeg do Mac**: o serviço só procurava `ffmpeg.exe` (Windows); agora acha o `Resources/bin/ffmpeg` do macOS. Sem isso, o motor gratuito offline sempre falhava.
3. **Pasta de saída errada**: o vídeo era salvo em `cwd/youtube_auto/exports` (caía no Downloads) enquanto a biblioteca "Arquivos Exportados" lê `app/youtube_auto/exports` — o vídeo nunca apareceria na lista. Agora salva na pasta certa.
4. **Tamanho real do arquivo** na biblioteca (era fixo 5 MB).
5. **WebP** enviado com mime correto para a Kling Cloud.
6. **Tradução**: 12 textos em inglês esquecidos no fluxo ("Clear Picture", "Converting Picture into Video...", mensagens de status, "Library (n)" etc.).
7. **Assinatura** ad-hoc refeita após o patch (`codesign --verify` OK).
8. **Prévia do vídeo cinza (0:00)**: as URLs `file:///` eram montadas com padrão de Windows (`file:///` + caminho absoluto Unix = 4 barras), e o Chromium não achava o arquivo — o vídeo era gerado certo, mas o player ficava escuro. Corrigido para o player "✨ Vídeo Gerado Pronto" e para a prévia da foto escolhida via "Procurar Arquivos". O botão "Salvar Vídeo" e sua mensagem também foram traduzidos ("Save to Phone Storage" etc.).
9. **Vídeo saía parado (foto imóvel)**: o motor local usava `zoompan` com estado acumulado (`zoom+0.0012`) e `-loop 1`, combinação que congelava o efeito com certas fotos de entrada (verificado num caso real: 10 s de imagem imóvel, PSNR 61 entre quadros distantes). Reescrito com expressões puras em função do número do quadro (`on`), sem `-loop`, na receita canônica do FFmpeg para Ken Burns — o movimento agora vai do primeiro ao último quadro em todos os 5 presets. Teste `test/teste-movimento.cjs`: 20 combinações (5 presets × jpg/png/webp em vários tamanhos), todas com movimento medido (PSNR 6–13 entre 1 s e 8 s).
10. **"Salvar Vídeo" baixava HTML quebrado**: o botão usava download por âncora de URL `file://`, que o Chromium bloqueia — salvava uma página de erro de 15 KB com nome .mp4 (por isso "não pode ser aberto" no Mac). Novo IPC `kling:save-video` no `main.js` copia o arquivo real para o Downloads (sem sobrescrever: acrescenta -2, -3…), abre o Finder no arquivo e o botão usa esse IPC com fallback. As 3 cópias quebradas no Downloads do usuário foram substituídas pelos vídeos reais. Original do `main.js` antes deste patch em `reservas/instalado-antes-kling-2026-11-03-main.js`.
11. **IA do Sistema (Veo) no Foto ➔ Vídeo**: o app tinha chave Gemini configurada (`secret_key.json`, lida por `app.getGeminiToken()` — a mesma do Nova Studio), mas nenhum caminho de geração de vídeo. Adicionado o motor "IA do Sistema" no `kling-video-service.js` (`_generateSystemAIVideo`) com **auto-descoberta**: consulta `ListModels` (gratuito) e usa os modelos Veo que a chave tiver. **Testado com a chave atual: a API listou 60 modelos e nenhum é Veo** — ou seja, a chave do Nova não tem acesso a vídeo (Veo via API exige faturamento Google). O caminho fica pronto para o dia em que o faturamento for ativado.
12. **Motor fal.ai no Foto ➔ Vídeo (botão verde)**: como a chave do Nova não faz vídeo, o botão "Converter com IA fal.ai" usa a chave **fal-key do Chaveiro do Mac** (a mesma do projeto criar-videos, lida com `security find-generic-password`). Fila `queue.fal.run`, imagem em data URI, modelo mais barato primeiro (`fal-ai/bytedance/seedance/v1/lite/image-to-video`, fallbacks Wan 2.2 e Kling 2.1), 720p, duração 5/10 s, espera com progresso e download para `exports`. **Custa por vídeo na conta fal.ai** — confirmar antes de gerar. Reinicie o Nova para carregar.

Arquivos: `integracao-kling/` (fontes patcheadas + `reservas/` com os originais de antes + `test/teste-motor-local.cjs`). Teste de ponta a ponta do motor local passou no app instalado: imagem de teste → MP4 720×1280 válido em `app/youtube_auto/exports`, com progresso e limpeza automáticos. **Reinicie o Nova para carregar.** Sem chave da API Kling, usa o Nova Motion Engine local (grátis, Ken Burns por FFmpeg); com chave, envia para `api.klingai.com` (kling-v1) — a autenticação Bearer da Kling pode exigir JWT próprio dela, não validado (não há conta para testar). O DMG não foi regenerado.

## CAM LIVE direto para o iPhone por USB — 03/11/2026

O CAM LIVE agora transmite **sem OBS, MediaMTX nem servidor RTMP**. O destino padrão é "iPhone por USB — automático" (formato celular 720×1280): o renderer envia JPEG (`camlive:frame`) e PCM das cenas (`camlive:pcm`); o processo principal (`cam-live-iphone.js`) serve `/frame.jpg` e `/audio` em loopback, abre o túnel SSH reverso para a porta 18999 do iPhone, codifica o áudio em AAC-LC 44,1 kHz com o FFmpeg incluído e só ativa a câmera depois de haver imagem **e** áudio. RTMP continua em Configurações → Avançado. Não há IP, porta ou chave para digitar.

Pré-requisito: iPhone conectado por **Conectar** (PHONE CONTROL) — exatamente um iPhone, ponte 0.1-38 com hooks de foto prontos. O pacote 0.1-38 agora acompanha o Nova (`conexao-usb/camera.deb`) e é instalado/atualizado por Conectar no iPhone10,2 / iOS 16.7.16. Um `enabled:true` antigo na ponte com lease expirado já não bloqueia o início.

Arquivos: `integracao-camlive/` (cam-live.js, cam-live-audio.js, cam-live-service.js, cam-live-iphone.js); aplicado no app instalado, com cópia do `main.js` anterior em `integracao-camlive/reservas/instalado-antes-usb-*`. Testes: `test/iphone-*.cjs` (14 testes passam) e `test/harness-usb.js` (iPhone simulado: ~16 fps de JPEG válidos e PCM em tempo real chegaram; parar interrompe os dois). FFmpeg incluído gerou ADTS aceito pelo parser.

**Não testado:** transmissão real até a Câmera do iPhone (a imagem aparecer no app Câmera), aparelhos além do iPhone 8 Plus, e o DMG não foi regenerado — o instalador final ainda não contém esta mudança. Reinicie o Nova para carregar. Windows fica para depois.

## Pacote Mac portátil de 03/11/2026

**Arquivo para compartilhar:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-03-final.dmg`. Use a versão `-final`; a primeira imagem foi uma tentativa intermediária e foi preservada. A cópia final do app passou na verificação de assinatura local `codesign --verify --deep --strict`.

Destino inicial: Mac Apple Silicon com macOS 26+. Windows fica para uma etapa posterior. O requisito macOS 26 vem dos binários efetivamente incluídos, não do Electron: auditoria de 227 arquivos Mach-O encontrou requisito máximo 26.0 e nenhuma dependência carregada de Homebrew, `/usr/local` ou `/Users`.

Python/PortAudio e bibliotecas foram incluídos em `python-runtime-portable/`, Chromium em `browsers/`, e os serviços passaram a usar o Python interno. Validados importação de módulos de áudio/rede/compressão/SQLite, HTTPS com certificados incluídos e lançamento do navegador interno. O Python também executou na cópia em outra pasta. O pacote exclui o venv antigo e a tentativa incompleta de runtime; nenhuma dessas cópias originais foi apagada.

O Nova abriu com perfil vazio e PATH mínimo (`SMOKE_EXIT 0`), com interface React carregada e API Electron disponível. Evidências em `distribuicao/teste-perfil-vazio-1793726904588/` e `distribuicao/verificacao-binarios.json`. Isso não substitui teste em outro Mac limpo. Não há validação de todas as funcionalidades, nem adaptação da ponte 0.1-38. Upload automático do YouTube continua sem pipeline. Serviços online continuam dependendo de internet e contas próprias.

Scripts de reprodução e auditoria em `integracao-iphone/distribuicao/`. Os dados pessoais de Application Support, perfis de navegador e chaves SSH não são copiados para a distribuição. A assinatura é local, sem notarização Apple.

## Portabilidade — revisão inicial de 03/11/2026 (histórico)

As ferramentas USB iPhone (`iproxy`, `idevice_id`, `ideviceinfo`, `ideviceinstaller`) e nove bibliotecas agora estão em `Contents/Resources/ios-tools/`. Os serviços iPhone passaram a resolver apenas esses executáveis incluídos no app. Teste: todas as quatro ferramentas iniciam com `PATH=/usr/bin:/bin`; nenhum dos 13 arquivos Mach-O possui dependência absoluta de Homebrew. Licenças locais foram copiadas para `ios-tools/licenses/`. Script de reprodução: `integracao-iphone/distribuicao/empacotar-ferramentas.py`.

**Na revisão inicial, a distribuição ainda não estava pronta.** O Python incluído era um venv com `home` e executável de origem no Homebrew; precisa de um runtime portátil para funções Python. O instalador DMG/ZIP existente continua antigo. Falta testar em outro Mac sem ferramentas de desenvolvimento. Esta alteração não atualiza o EXE Windows. O iPhone ainda precisa ter jailbreak ativo e OpenSSH, e CatVNC tem configuração própria. Contas e credenciais devem ser configuradas por cada usuário, sem copiar dados de `Application Support` ou chaves SSH pessoais.

## Conexão iPhone por senha SSH — 03/11/2026

O botão dos iPhones em DEVICES agora mostra **Conectar** e abre uma janela para a senha SSH do usuário `mobile`. O fluxo exige jailbreak ativo e OpenSSH já instalado no iPhone. A senha fica apenas em memória durante a operação. O app prepara uma chave SSH, verifica o acesso e oferece abrir o console. Exige somente um iPhone conectado; não faz jailbreak automaticamente.

O pacote OBSGraphBridge 0.1-30 está incluído no app e pode ser instalado sem download externo no iPhone10,2 com iOS 16.7.16. Outras versões já instaladas são preservadas. Não há instalação automática do CatVNC nem suporte universal às funções Android: o fluxo informa essas limitações. CatVNC ainda exige instalação e configuração próprias.

Fontes e testes: `integracao-iphone/conexao-usb/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: sintaxe do main, bundle em modo módulo, serviço, carregamento do SSH e testes de limites IPC/múltiplos aparelhos. **Conexão e instalação reais no aparelho ainda não testadas neste fluxo.** Reinicie o Nova para carregar as alterações.


## Tradução para pt-BR de 03/11/2026

O app instalado (`/Applications/Nova AI Mac.app`) foi traduzido inteiro para português do Brasil — só texto de interface, sem tocar em nenhuma função. Traduzidos: bundle da interface (`dist/assets/index-Dun7lr2S.js`, ~1.900 substituições), `dist/index.html`, PWA (`electron/pwa/`: index, admin, app.js, manifest), menus/diálogos do `electron/main.js`, mensagens visíveis dos services e a extensão nova-grab. **Reinicie o app para ver a tradução.** Cópia de todos os arquivos originais está em `../backup-antes-traducao/`. Nomes de hardware (Apple M1, Galaxy, GPUs — são valores de spoofing), modelos de IA e termos técnicos (Stop Loss, SKU, ADB) foram mantidos de propósito.

## Atualização local de 02/11/2026 — CAM HIJACK iPhone

O app instalado recebeu encaminhamento iOS para CAM HIJACK, correção do caminho do APK Android e textos de preparação por plataforma. Fontes, testes, reservas e o instalador iOS estão em `integracao-iphone/`.

**Pendente:** executar `integracao-iphone/instalar-iphone.command` no Terminal (sudo do iPhone) e validar a imagem na Câmera. O pacote nativo compilado é OBSGraphBridge 0.1-30 com suporte ao túnel USB em localhost:18999. O fluxo ativa a prévia nativa experimental; fotos/vídeos gravados e outros apps não estão validados nem habilitados nesta integração.

**O DMG abaixo é anterior a esta atualização e já não é idêntico ao app instalado.**

**Instalador anterior:** `Nova-AI-Mac-sem-ativacao.dmg` (1/11/2026, 789 MB) — é idêntico ao app **já instalado em `/Applications/Nova AI Mac.app`**, que é o que você usa no dia a dia. O `.zip` é o mesmo app em formato zip (backup).

## O que já foi feito ✅

### Port e base
- Port do instalador Windows (Electron) para macOS arm64, módulos nativos recompilados (SQLite, RobotJS).
- Ferramentas nativas embutidas: FFmpeg, ADB, scrcpy, cloudflared, yt-dlp.
- **Ativação removida**: sem tela de chave, sem formulário, sem consulta ao servidor de licença do fornecedor. Abre direto no painel.
- Instalado em `/Applications` (não precisa mais rodar do DMG).

### Segurança (endurecimento)
- **Túnel público do Cloudflare desligado por padrão** (só liga com `NOVA_REMOTE_TUNNEL=1` no terminal).
- **Todos os servidores internos escutam só em 127.0.0.1** (interface, WebSocket, RTMP) — nada exposto pra rede Wi-Fi ou internet.
- Correção crítica: o servidor RTMP interno não derruba mais o app quando a porta está ocupada.

### Recursos ativos
- **RTMP do Nova: porta 11935** (1935 é do MediaMTX). Para o Android via cabo nada muda (`adb reverse` entrega a 1935 dentro do celular). De outro computador: `rtmp://<ip-do-mac>:11935/live/nova`.
- **Wake word (ativação por voz): funcionando.** PortAudio + SpeechRecognition + sounddevice instalados no Python embutido. Precisa de internet (API de fala do Google) e permissão de microfone.
- **Mobile Cam Bridge**: câmera do celular alimentando o painel.
  - Android: página própria do app.
  - iPhone: Safari + túnel SSH por cabo (https://127.0.0.1:8899/pc-cam no celular) — nunca usa Wi-Fi.
- **PC → PHONE**: webcam do Mac aparecendo no celular (iPhone via túnel USB: https://127.0.0.1:8899/pc-cam).

### NOVO: iPhone integrado na aba PHONE CONTROL ✅
Com o iPhone 8 Plus **plugado no cabo** (jailbreak religado, OpenSSH ativo — a chave `~/.ssh/id_iphone` já está configurada):
- **DEVICES**: aparece como "iPhone 8 Plus (iOS 16.7.16)" na lista de aparelhos, igual um Android.
- **CONTROLS**: abre a janela **iPhone Console** dentro do sistema (sem navegador externo) — tela ao vivo controlável (clique = toque) via CatVNC + noVNC por cabo.
- **APPS**: listar apps instalados e abrir por nome — com tradução automática de pacotes Android→iOS (WhatsApp, Instagram, Chrome etc.).
- **BROWSER**: campo de URL abre o link no Safari do iPhone.
- **Screenshot**: salva imagem da tela (via canvas da tela ao vivo).
- Senha pedida na primeira conexão: a que você definiu em **Ajustes → CatVNC** (fica memorizada na página).
- Os túneis (iproxy 5900/2222) têm **auto-recuperação**: se caem, o app recria em segundos.

## O que ainda falta fazer ⏳

- **Fase 2 — SPOOFER / CAM HIJACK para iPhone**: vídeo do Mac virando a câmera NATIVA do iPhone, conectando o Nova ao seu tweak VCamMin (o equivalente do APK Android). É o último pedaço pra paridade total com o Android.
- **Toggles de Wi-Fi/Bluetooth** no CONTROLS para iPhone: respondem "não suportado por SSH" (Apple não expõe isso).
- **`youtube_auto/pipeline.py`**: o instalador original nem inclui esse arquivo — a automação de upload depende de reconstruí-lo.
- **Integrações que dependem das suas contas** (WhatsApp, Telegram, Google, chaves de IA): instaladas mas sem validação completa.
- **Câmera virtual completa, Antigravity, Stable Diffusion**: sem validação de fluxo completo.
- **Wake word com microfone real**: motor instalado e rodando; falta testar em uso com permissões do macOS.
- **Atualização automática**: não configurada (o feed do fornecedor é Windows-only).
- **Notarização Apple**: o app é assinado localmente (ad-hoc) — a primeira abertura sempre exige botão direito → Abrir.

## Arquivos desta pasta

| Arquivo | Papel |
|---|---|
| `Nova-AI-Mac-sem-ativacao.dmg` | **Instalador atual** (idêntico ao app instalado) |
| `Nova-AI-Mac-sem-ativacao.zip` | Mesmo app em zip (backup) — duplicado do DMG |
| `Nova-AI-Mac-Preview-com-ativacao.dmg` | Versão antiga com tela de ativação original (só se quiser usar a licença do fornecedor) |
| `LEIA-ME.md` | Este arquivo |

Gerado e mantido localmente. Não é distribuição oficial do fornecedor.

# Nova AI para macOS (Apple Silicon) — estado do projeto

## GPS: monta a Developer Disk Image antes de aplicar localização — 06/11/2026

Causa do erro "Proxy em Sayreville … Command failed: idevicesetlocation …": a Developer Disk Image cai a cada reboot do iPhone e o `idevicesetlocation` (libimobiledevice 1.4.0) **não avisa** — com a DDI desmontada ele sai com código 0 em silêncio (a conexão ao serviço `com.apple.dt.simulatelocation` é resetada, só visível com `-d`), ou falha com a mensagem real escrita no **stdout** (o app só lia stderr, então mostrava o genérico `Command failed`).

Fix em `physicalMobileService.js`:
- `iosSetLocation` agora chama `mountDeveloperImage` (auto-mount idempotente) **antes** de aplicar, em vez de só como fallback que nunca disparava (regex testava stderr, mas o erro está no stdout).
- `runIdevicesetlocation` passa a juntar stdout+stderr no campo de erro, para não esconder a causa.

App instalado (`/Applications/Nova AI Mac.app/…/physicalMobileService.js`) **patcheado agora** com o mesmo fix (backup em `MAC/integracao-iphone/reservas/physicalMobileService.js.bak-20261106-195601`), `node --check` OK. Requer reiniciar o Nova para carregar (o require cache segura a versão antiga). Contorno imediato já aplicado: `pymobiledevice3 mounter auto-mount --udid 47f4fc34…` rodado e o comando do app passou sem erro (40.4592726 -74.3609833). Branch `agent/backend/gps-ddi-automount-20261106`, sem merge e sem push.

## Conectar instala novamodel + nova-locale com a senha já digitada — 06/11/2026

O usuário pediu que a senha digitada no Conectar seja usada para instalar o que falta (modelo e GPS/fuso), sem digitar senha de novo. O `conexao-usb/setup.js` agora, no mesmo fluxo do Conectar (com a senha do modal):
- **novamodel**: se o `.deb` existir ao lado do setup e o pacote não estiver instalado, sobe por sftp e instala via `sudo -S` + senha; se já instalado, só informa a versão.
- **nova-locale**: confere os arquivos do helper (`/var/jb/usr/libexec/nova-locale.sh` + `com.aquiles.novalocale.plist`); se faltar, sobe os arquivos (`nova-locale.sh` e `com.aquiles.novalocale.plist` agora vão junto do app), move com `sudo -S`, ajusta permissões e carrega o daemon com `launchctl bootstrap` (fallback `kickstart`).
- A senha continua sem ser salva (é zerada no `finally`); cada comando `sudo` recebe a senha só pelo stdin daquela execução.

App instalado: `setup.js` corrigido com backup (`setup.js.bak-20261106-*`) e `novamodel.deb`/`nova-locale.sh`/plist copiados para `electron/services/iphone-setup/`. Para instalar no aparelho, o usuário toca **Conectar** mais uma vez e digita a senha — o resto é automático. Branch `agent/ios/novamodel-locale-conectar-20261106`, sem merge e sem push.

## Fase A — merge do seletor de modelo + pacotes release — 06/11/2026

Merge na `main` (de `530920e`) das três branches do seletor de modelo do iPhone, em sequência: `agent/jailbreak/modelo-iphone-20261105` → `agent/ios/modelo-iphone-20261105` → `agent/frontend/modelo-iphone-20261105` (merge octopus falharia no `MAC/LEIA-ME.md`). Conflito resolvido mantendo as três seções no topo (tweak+CLI, serviço+IPC, seletor da UI). Commits de merge: `93c63a5`, `b9d3116`, `b5c3522` (não enviados — push pendente de autorização).

**Testes após o merge:** `integracao-modelo/test/teste-novamodel.cjs` (5 ok), `integracao-modelo-app/novamodel.test.cjs` (30 verificações), `conexao-usb/setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` passando. `integracao-sequestro-cam/controles-independentes.test.cjs` **falha pré-existente** (já falhava em `530920e`): o teste fixa a ponte em `0.1-38` e espera o fluxo de injeção anterior à bridge 0.1-39; não foi alterado nesta fase — precisa de decisão separada.

**Pacotes release (theos, `FINALPACKAGE=1 DEBUG=0`):**
- Tweak `com.aquiles.novamodel_0.1_iphoneos-arm64.deb` (rootless arm64, `Version: 0.1`) em `integracao-modelo/packages/`.
- Bridge `com.aquiles.obsgraph-bridge_0.1-39_iphoneos-arm64.deb` (`Version: 0.1-39`) em `integracao-iphone/bridge/packages/`, copiado como `camera.deb` para `conexao-usb/` (repo) e `electron/services/iphone-setup/` (app). Ambos fora do git (`*.deb` ignorado).

**setup.js:** backport do app instalado para o repo (`ensureTunnel()`, listeners de erro do ssh2 com `on`+guarda `settled`, `launchctl kickstart mediaserverd` após instalar a ponte). `TARGET` ajustado de `0.1-39-1+debug` para `0.1-39` para casar com o pacote release (o mesmo ajuste foi aplicado no `setup.js` do app instalado). O bloco de instalação do `novamodel.deb` já está no repo, mas ainda **não** no app instalado (pendente da Fase C; exige colocar `novamodel.deb` em `electron/services/iphone-setup/`).

**Bundle:** `conexao-usb/dist/index-Dun7lr2S.patched.js` reaplicado no app (`dist/assets/index-Dun7lr2S.js`), levando o seletor de modelo (IPC `spoofer:get-ios-models`).

**DMG:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-06.dmg`, gerado do app instalado com `CFBundleVersion=20261106.1` e `LSMinimumSystemVersion=26.0`.

```
sha256  4bf34a8c0210dc81ba933ed45471e5febe814e63cc8836a2917c412722ded685
```

Assinatura ad hoc, sem Developer ID nem notarização. Estado registrado: `spctl --assess` no app dentro do DMG → `invalid Info.plist (plist or signature have been modified)`; no app instalado → `a sealed resource is missing or invalid`. Uso em outro Mac: abrir com Ctrl+clique → Abrir.

## Spoofing de modelo do iPhone (tweak + CLI) — 05/11/2026

Criado o pacote `com.aquiles.novamodel` (rootless) para o iPhone reportar outro modelo (ex. "iPhone 13" → `iPhone14,5`), a contraparte iOS do spoofing de identidade que hoje só existe em Android. Só modelo — sem IMEI/serial.

- **Tweak `NovaModel.dylib`** (Substrate, carrega em todo processo): hooka `MGCopyAnswer`/`MGCopyAnswerWithError`/`MGGetStringAnswer` (whitelist fechado: `ProductType`, `HWModelStr`, `ModelNumber`, `ProductName`, `MarketingProductName`), `sysctlbyname`/`sysctl` (`hw.machine`, `hw.product`) e `UIDevice` (`model`, `localizedModel`, `modelName`/`_modelName` privados). Lê `/var/tmp/nova-model-control.json` com cache por mtime (aplicação instantânea).
- **CLI `/var/jb/usr/bin/novamodel`** (setuid root): `set <productType>` (valida no banco e grava o control file), `clear`, `status` (JSON `real`/`active`/`enabled`). Roda sem o tweak, então `status` lê o ProductType real.
- **Banco de modelos** `models.json` (27 modelos: iPhone 8 → 15), instalado em `/var/jb/usr/share/novamodel/models.json`.

Arquivos: `integracao-modelo/` (Tweak.x, main.m, models.json, Makefile, layout, test). Compila no theos e gera `.deb` rootless arm64 (`packages/com.aquiles.novamodel_0.1-*.deb`). Teste automatizado `test/teste-novamodel.cjs` valida banco, contrato do control file e whitelist MG. **Sem testar no aparelho real** (efeito em Ajustes/Sobre e apps, `dpkg -i`, setuid); `HWModelStr`/`ModelNumber` estão no whitelist mas não são spoofados na v1 (códigos de placa/número de modelo são por variante/região).

## Spoofing de modelo do iPhone — serviço + IPC + instalação do .deb — 05/11/2026

Integração no app para o tweak `com.aquiles.novamodel` (spec `NOVA-AI-MODELO-SPOOF-SPEC.md`). No `physicalMobileService` entraram `getIosModels()`, `applyIOSModel(deviceId, productType)`, `clearIOSModel(deviceId)` e `getIOSModel(deviceId)` — chamam `/var/jb/usr/bin/novamodel` via `iosSsh` (túnel USB). IPCs novos em `main.js`: `spoofer:get-ios-models`/`spoofer:apply-ios-model`/`spoofer:clear-ios-model`/`spoofer:get-ios-model` (nomes do contrato da UI). Banco de modelos em `iosModels.json`; instalação do `novamodel.deb` pelo fluxo Conectar (guarded: só quando o `.deb` existir ao lado do `camera.deb`).

- Arquivos: `integracao-iphone/ios-modelo.js` (novo), `integracao-iphone/iosModels.json` (novo), `integracao-iphone/physicalMobileService.patched.js`, `integracao-iphone/conexao-usb/setup.js`, `integracao-modelo-app/main.modelo.js`, `integracao-modelo-app/novamodel.test.cjs`, `integracao-modelo-app/README.md`.
- Testado: `node --check` nos arquivos tocados + `novamodel.test.cjs` (30 verificações com mock de SSH).
- Sem testar: instalação e execução real do CLI (o `.deb` do Jailbreak Specialist ainda não existe) e o IPC no Electron (só sintaxe + mock). Detalhes: `MAC/integracao-modelo-app/README.md`.

## Seletor de modelo do iPhone no painel "Identidade simulada" — 05/11/2026

Spoofing de modelo do iPhone na UI: no painel **Identidade simulada** (janela "Controle do Celular"), o seletor de modelo do iPhone agora é alimentado pelo banco de modelos iOS e tem botões **Aplicar modelo** e **Limpar modelo**.

- **Seletor:** populado dinamicamente via `spoofer:get-ios-models` (27 modelos do banco do serviço, `{productType, name}`); o bundle não tem mais lista fixa. Ex.: iPhone 13 = `iPhone14,5`.
- **Contrato de IPC (bundle → main):** `spoofer:get-ios-models` (sem args → `{success, models[]}`), `spoofer:apply-ios-model {deviceId, productType}` (aplica), `spoofer:clear-ios-model {deviceId}` (restaura o real) e `spoofer:get-ios-model {deviceId}` (lê `{real, active, enabled}`). Os handlers no `main.js`/`physicalMobileService` são do iOS Engineer; o bundle já chama esses canais. Se o IPC ainda não existir, o seletor mostra a falha no painel (estado "error").
- **Estados:** `applying` (spinner), `applied` (verde, "Modelo aplicado no iPhone"), `idle` (modelo real) e `error` (vermelho). Ao abrir a aba, `spoofer:get-ios-model` lê o estado atual.
- **Texto pt-BR**; nomes de modelo (dados de spoofing) não traduzidos.

Arquivos: `MAC/integracao-iphone/conexao-usb/dist/index-Dun7lr2S.patched.js` (patch no bundle). Reaplicado `aplicar-botao-iphone.py` (idempotente) e `node --check` OK.

Sem testar: execução real no app (bundle patcheado ainda não copiado para `/Applications/Nova AI Mac.app`) e o fluxo Aplicar/Limpar contra o tweak `novamodel` no iPhone (depende do iOS Engineer expor os IPCs e do Jailbreak Specialist instalar o `.deb`).

## Chave SSH do iPhone agora é do app — 04/11/2026

A chave usada para falar com o iPhone saiu de `~/.ssh/id_iphone` e passou para `~/Library/Application Support/nova_dsktp/iphone-ssh/` (modo 0600), junto com o `known_hosts` do aparelho. Todos os `ssh`/`scp` do app usam `-i` explícito, `IdentitiesOnly=yes` e `UserKnownHostsFile=` desse diretório, então não caem mais nas outras chaves do agente SSH do Mac.

- `services/iphone-ssh.js` é o único lugar que conhece o caminho; `setup.js`, `physicalMobileService.js`, `ios-camera.js`, `cam-live-iphone.js` e `ios-bridge.js` passaram a usar `sshOptions()`.
- Migração automática no boot (`migrateLegacy()`): se existir `~/.ssh/id_iphone` e ainda não houver a do app, ela é **movida** (não copiada) e a linha `[127.0.0.1]:2222` do `known_hosts` é herdada. É a mesma chave, o iPhone continua autorizando — não precisa refazer o Conectar.
- Em teste (`NOVA_SMOKE_TEST=1`) a migração não roda; `NOVA_USER_DATA` isola os caminhos.
- Não é isolamento criptográfico: qualquer processo do mesmo usuário do macOS ainda lê o arquivo (0600). O ganho é sair do `~/.ssh` (fora de dotfiles, backups e outras ferramentas) e ter par chave/known_hosts só do app.

Verificação: migração simulada com `HOME` falso moveu a chave com 0600, herdou o known_hosts e gerou as opções certas; 15 testes do CAM LIVE + `setup.test.cjs` + `botao-servico.test.cjs` passando. **Reinicie o Nova** para a migração acontecer. No repo, `integracao-camlive/`, `integracao-sequestro-cam/` e `encerramento-nova/` têm um shim `iphone-ssh.js` porque neles os arquivos não ficam lado a lado como em `electron/services/`.

## Cartão do iPhone: "Abrir controle" reaplicado — 04/11/2026

O bundle em uso (`dist/assets/index-Dun7lr2S.js`) estava **sem** o patch do botão do iPhone: o cartão de um aparelho já preparado mostrava **PARAR TRANSMISSÃO** (vermelho) em vez de **Abrir controle**, o que dá a impressão de transmissão ativa mesmo com o aparelho parado — o `streaming` do iOS é o registro de pareamento (`iphone-hosts.json`), não uma transmissão real. Outro patch de bundle aplicado depois (controle de celular/geo-proxy) sobrescreveu o trecho.

Reaplicado `conexao-usb/aplicar-botao-iphone.py` no app instalado: iPhone preparado agora mostra **Abrir controle** (ciano) e abre o console direto; Android continua com **Parar transmissão**. A lista de dispositivos já se atualiza sozinha a cada 5 s (o painel faz `setInterval` de `physical-mobile:get-status`), então desplugado deixa de aparecer. Cópia canônica do bundle em `conexao-usb/dist/index-Dun7lr2S.patched.js`; anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/index-Dun7lr2S.antes-botao.js`.

**Regra nova no `AGENTS.md`:** qualquer patch futuro no bundle precisa reaplicar este script (é idempotente) antes de copiar para o app, senão o botão volta a regredir. Recarregue com **Cmd+R** ou reinicie o Nova.

## Transporte camuflado Mac → iPhone (bridge 0.1-39) — 04/11/2026

O que a Câmera do iPhone consome deixou de ser `http://127.0.0.1:18999/frame.jpg`.

- O servidor do Mac (CAM LIVE e CAM HIJACK) só responde em `/s/<token de 32 hex>/frame.jpg` e `/s/<token>/audio`; sem o token a resposta é 404 neutro. O token é novo a cada sessão.
- O túnel SSH tenta primeiro um **socket Unix** em `/var/tmp/.nb-<8hex>.sock` (modo 666 para o mediaserverd). Nenhuma porta TCP fica escutando no iPhone. Se o sshd do aparelho recusar streamlocal, cai para uma **porta TCP aleatória** (20000–39999) com o mesmo token; o `-v` do ssh foi removido.
- O bridge 0.1-39 valida o caminho com token, aceita `socket` no control, recusa a rota antiga e **removeu o IP fixo `10.0.0.245:8900`** que vinha do projeto original.
- O sequestro (item 3) passou a pedir o endereço ao CAM LIVE (`mediaEndpoint()`): CAM LIVE, CAM HIJACK e sequestro compartilham o mesmo token/transporte em vez de repetir 18999.

Compatibilidade: pontes 0.1-38 e anteriores são recusadas ("atualize por USB") porque não conhecem o token. Atualize pelo **Conectar** em PHONE CONTROL — o `camera.deb` 0.1-39 já está incluído no app.

Arquivos: `integracao-iphone/bridge/Tweak.x` (0.1-39), `integracao-camlive/cam-live-iphone.js`, `integracao-iphone/ios-camera.js` (= `integracao-sequestro-cam/ios-camera.patched.js`), `conexao-usb/setup.js` (alvo 0.1-39) e `conexao-usb/camera.deb`. Reservas do instalado anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/`. Testes: 15 passam (`node --test` em `integracao-camlive/test/`), incluindo token/404, socket Unix, fallback TCP e sequestro. **Não testado no aparelho**: se o sshd do iPhone aceita `-R` com socket Unix e se o mediaserverd (sandbox) consegue conectar; se recusar, o fallback TCP entra sozinho. Reinicie o Nova e refaça o Conectar para instalar a 0.1-39.

## Conexão do iPhone dentro do app — 04/11/2026

O **Conectar** dos iPhones em PHONE CONTROL deixou de abrir uma janela/página externa para a senha SSH. Agora o formulário, o progresso e o controle do iPhone são desenhados **dentro da janela do Nova**, como um modal do próprio app: fundo escurecido e embaçado, mesmo visual do Controle do Celular, X/Esc para fechar (bloqueado durante a preparação) e tempo decorrido.

A senha continua só em memória: o campo é limpo antes do envio ao processo principal, a senha não entra em log nem em mensagem de erro. O modal roda no preload (`inapp.js`), fora do bundle React — não depende do `index-Dun7lr2S.js`. Depois do sucesso, "Abrir controle e tela do iPhone" carrega o iPhone Console num `<webview>` dentro do app, com "Abrir em janela" como alternativa.

Depois de conectar, o cartão do iPhone não fica mais em **Conectar**: passa a **Abrir controle**, que abre o console dentro do app sem senha. O estado vem do registro `iphone-hosts.json` gravado por um Conectar bem-sucedido; Android segue com "Parar transmissão" e o botão **Refazer conexão** fica no topo do controle.

Arquivos: `integracao-iphone/conexao-usb/` (`inapp.js`, `setup.js`, `aplicar-botao-iphone.py`, `botao.test.cjs`, `botao-servico.test.cjs`, `setup.test.cjs`, `test/modal/`, `dist/index-Dun7lr2S.patched.js`, `docs/`), com os arquivos da janela antiga em `integracao-iphone/reservas/modal-externo-20261104/` e o estado anterior desta rodada em `integracao-iphone/reservas/botao-conectado-20261104/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: `node --check` nos quatro arquivos; testes do serviço (senha inválida, aparelho único, janela ausente); harness em Electron com o **preload real** abrindo o modal por IPC, enviando a senha e confirmando o campo vazio; estados idle/preparando/sucesso/erro e o webview do console renderizados sem exceção. **Conexão real no aparelho não refeita** (exige a senha do iPhone) e **reiniciar o Nova** para carregar.

## Foto ➔ Vídeo (Kling) acessível e corrigido — 03/11/2026

A função de animar foto em vídeo (Capítulo 3 do guia) existia no código, mas estava **sem botão de acesso** nesta versão: a seção "kling" da Suíte de Vídeo só abria por um evento interno (`nova-open-kling-video`) que nada disparava. Foram corrigidos 7 problemas no fluxo:

1. **Botão novo** "Foto ➔ Vídeo" na barra da Suíte e Estúdio de Vídeo (AI UPLOAD), entre "Criador de IA" e "Recortador Seguro" — abre a seção de selecionar foto → movimento → proporção/duração → converter.
2. **FFmpeg do Mac**: o serviço só procurava `ffmpeg.exe` (Windows); agora acha o `Resources/bin/ffmpeg` do macOS. Sem isso, o motor gratuito offline sempre falhava.
3. **Pasta de saída errada**: o vídeo era salvo em `cwd/youtube_auto/exports` (caía no Downloads) enquanto a biblioteca "Arquivos Exportados" lê `app/youtube_auto/exports` — o vídeo nunca apareceria na lista. Agora salva na pasta certa.
4. **Tamanho real do arquivo** na biblioteca (era fixo 5 MB).
5. **WebP** enviado com mime correto para a Kling Cloud.
6. **Tradução**: 12 textos em inglês esquecidos no fluxo ("Clear Picture", "Converting Picture into Video...", mensagens de status, "Library (n)" etc.).
7. **Assinatura** ad-hoc refeita após o patch (`codesign --verify` OK).
8. **Prévia do vídeo cinza (0:00)**: as URLs `file:///` eram montadas com padrão de Windows (`file:///` + caminho absoluto Unix = 4 barras), e o Chromium não achava o arquivo — o vídeo era gerado certo, mas o player ficava escuro. Corrigido para o player "✨ Vídeo Gerado Pronto" e para a prévia da foto escolhida via "Procurar Arquivos". O botão "Salvar Vídeo" e sua mensagem também foram traduzidos ("Save to Phone Storage" etc.).
9. **Vídeo saía parado (foto imóvel)**: o motor local usava `zoompan` com estado acumulado (`zoom+0.0012`) e `-loop 1`, combinação que congelava o efeito com certas fotos de entrada (verificado num caso real: 10 s de imagem imóvel, PSNR 61 entre quadros distantes). Reescrito com expressões puras em função do número do quadro (`on`), sem `-loop`, na receita canônica do FFmpeg para Ken Burns — o movimento agora vai do primeiro ao último quadro em todos os 5 presets. Teste `test/teste-movimento.cjs`: 20 combinações (5 presets × jpg/png/webp em vários tamanhos), todas com movimento medido (PSNR 6–13 entre 1 s e 8 s).
10. **"Salvar Vídeo" baixava HTML quebrado**: o botão usava download por âncora de URL `file://`, que o Chromium bloqueia — salvava uma página de erro de 15 KB com nome .mp4 (por isso "não pode ser aberto" no Mac). Novo IPC `kling:save-video` no `main.js` copia o arquivo real para o Downloads (sem sobrescrever: acrescenta -2, -3…), abre o Finder no arquivo e o botão usa esse IPC com fallback. As 3 cópias quebradas no Downloads do usuário foram substituídas pelos vídeos reais. Original do `main.js` antes deste patch em `reservas/instalado-antes-kling-2026-11-03-main.js`.
11. **IA do Sistema (Veo) no Foto ➔ Vídeo**: o app tinha chave Gemini configurada (`secret_key.json`, lida por `app.getGeminiToken()` — a mesma do Nova Studio), mas nenhum caminho de geração de vídeo. Adicionado o motor "IA do Sistema" no `kling-video-service.js` (`_generateSystemAIVideo`) com **auto-descoberta**: consulta `ListModels` (gratuito) e usa os modelos Veo que a chave tiver. **Testado com a chave atual: a API listou 60 modelos e nenhum é Veo** — ou seja, a chave do Nova não tem acesso a vídeo (Veo via API exige faturamento Google). O caminho fica pronto para o dia em que o faturamento for ativado.
12. **Motor fal.ai no Foto ➔ Vídeo (botão verde)**: como a chave do Nova não faz vídeo, o botão "Converter com IA fal.ai" usa a chave **fal-key do Chaveiro do Mac** (a mesma do projeto criar-videos, lida com `security find-generic-password`). Fila `queue.fal.run`, imagem em data URI, modelo mais barato primeiro (`fal-ai/bytedance/seedance/v1/lite/image-to-video`, fallbacks Wan 2.2 e Kling 2.1), 720p, duração 5/10 s, espera com progresso e download para `exports`. **Custa por vídeo na conta fal.ai** — confirmar antes de gerar. Reinicie o Nova para carregar.

Arquivos: `integracao-kling/` (fontes patcheadas + `reservas/` com os originais de antes + `test/teste-motor-local.cjs`). Teste de ponta a ponta do motor local passou no app instalado: imagem de teste → MP4 720×1280 válido em `app/youtube_auto/exports`, com progresso e limpeza automáticos. **Reinicie o Nova para carregar.** Sem chave da API Kling, usa o Nova Motion Engine local (grátis, Ken Burns por FFmpeg); com chave, envia para `api.klingai.com` (kling-v1) — a autenticação Bearer da Kling pode exigir JWT próprio dela, não validado (não há conta para testar). O DMG não foi regenerado.

## CAM LIVE direto para o iPhone por USB — 03/11/2026

O CAM LIVE agora transmite **sem OBS, MediaMTX nem servidor RTMP**. O destino padrão é "iPhone por USB — automático" (formato celular 720×1280): o renderer envia JPEG (`camlive:frame`) e PCM das cenas (`camlive:pcm`); o processo principal (`cam-live-iphone.js`) serve `/frame.jpg` e `/audio` em loopback, abre o túnel SSH reverso para a porta 18999 do iPhone, codifica o áudio em AAC-LC 44,1 kHz com o FFmpeg incluído e só ativa a câmera depois de haver imagem **e** áudio. RTMP continua em Configurações → Avançado. Não há IP, porta ou chave para digitar.

Pré-requisito: iPhone conectado por **Conectar** (PHONE CONTROL) — exatamente um iPhone, ponte 0.1-38 com hooks de foto prontos. O pacote 0.1-38 agora acompanha o Nova (`conexao-usb/camera.deb`) e é instalado/atualizado por Conectar no iPhone10,2 / iOS 16.7.16. Um `enabled:true` antigo na ponte com lease expirado já não bloqueia o início.

Arquivos: `integracao-camlive/` (cam-live.js, cam-live-audio.js, cam-live-service.js, cam-live-iphone.js); aplicado no app instalado, com cópia do `main.js` anterior em `integracao-camlive/reservas/instalado-antes-usb-*`. Testes: `test/iphone-*.cjs` (14 testes passam) e `test/harness-usb.js` (iPhone simulado: ~16 fps de JPEG válidos e PCM em tempo real chegaram; parar interrompe os dois). FFmpeg incluído gerou ADTS aceito pelo parser.

**Não testado:** transmissão real até a Câmera do iPhone (a imagem aparecer no app Câmera), aparelhos além do iPhone 8 Plus, e o DMG não foi regenerado — o instalador final ainda não contém esta mudança. Reinicie o Nova para carregar. Windows fica para depois.

## Pacote Mac portátil de 03/11/2026

**Arquivo para compartilhar:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-03-final.dmg`. Use a versão `-final`; a primeira imagem foi uma tentativa intermediária e foi preservada. A cópia final do app passou na verificação de assinatura local `codesign --verify --deep --strict`.

Destino inicial: Mac Apple Silicon com macOS 26+. Windows fica para uma etapa posterior. O requisito macOS 26 vem dos binários efetivamente incluídos, não do Electron: auditoria de 227 arquivos Mach-O encontrou requisito máximo 26.0 e nenhuma dependência carregada de Homebrew, `/usr/local` ou `/Users`.

Python/PortAudio e bibliotecas foram incluídos em `python-runtime-portable/`, Chromium em `browsers/`, e os serviços passaram a usar o Python interno. Validados importação de módulos de áudio/rede/compressão/SQLite, HTTPS com certificados incluídos e lançamento do navegador interno. O Python também executou na cópia em outra pasta. O pacote exclui o venv antigo e a tentativa incompleta de runtime; nenhuma dessas cópias originais foi apagada.

O Nova abriu com perfil vazio e PATH mínimo (`SMOKE_EXIT 0`), com interface React carregada e API Electron disponível. Evidências em `distribuicao/teste-perfil-vazio-1793726904588/` e `distribuicao/verificacao-binarios.json`. Isso não substitui teste em outro Mac limpo. Não há validação de todas as funcionalidades, nem adaptação da ponte 0.1-38. Upload automático do YouTube continua sem pipeline. Serviços online continuam dependendo de internet e contas próprias.

Scripts de reprodução e auditoria em `integracao-iphone/distribuicao/`. Os dados pessoais de Application Support, perfis de navegador e chaves SSH não são copiados para a distribuição. A assinatura é local, sem notarização Apple.

## Portabilidade — revisão inicial de 03/11/2026 (histórico)

As ferramentas USB iPhone (`iproxy`, `idevice_id`, `ideviceinfo`, `ideviceinstaller`) e nove bibliotecas agora estão em `Contents/Resources/ios-tools/`. Os serviços iPhone passaram a resolver apenas esses executáveis incluídos no app. Teste: todas as quatro ferramentas iniciam com `PATH=/usr/bin:/bin`; nenhum dos 13 arquivos Mach-O possui dependência absoluta de Homebrew. Licenças locais foram copiadas para `ios-tools/licenses/`. Script de reprodução: `integracao-iphone/distribuicao/empacotar-ferramentas.py`.

**Na revisão inicial, a distribuição ainda não estava pronta.** O Python incluído era um venv com `home` e executável de origem no Homebrew; precisa de um runtime portátil para funções Python. O instalador DMG/ZIP existente continua antigo. Falta testar em outro Mac sem ferramentas de desenvolvimento. Esta alteração não atualiza o EXE Windows. O iPhone ainda precisa ter jailbreak ativo e OpenSSH, e CatVNC tem configuração própria. Contas e credenciais devem ser configuradas por cada usuário, sem copiar dados de `Application Support` ou chaves SSH pessoais.

## Conexão iPhone por senha SSH — 03/11/2026

O botão dos iPhones em DEVICES agora mostra **Conectar** e abre uma janela para a senha SSH do usuário `mobile`. O fluxo exige jailbreak ativo e OpenSSH já instalado no iPhone. A senha fica apenas em memória durante a operação. O app prepara uma chave SSH, verifica o acesso e oferece abrir o console. Exige somente um iPhone conectado; não faz jailbreak automaticamente.

O pacote OBSGraphBridge 0.1-30 está incluído no app e pode ser instalado sem download externo no iPhone10,2 com iOS 16.7.16. Outras versões já instaladas são preservadas. Não há instalação automática do CatVNC nem suporte universal às funções Android: o fluxo informa essas limitações. CatVNC ainda exige instalação e configuração próprias.

Fontes e testes: `integracao-iphone/conexao-usb/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: sintaxe do main, bundle em modo módulo, serviço, carregamento do SSH e testes de limites IPC/múltiplos aparelhos. **Conexão e instalação reais no aparelho ainda não testadas neste fluxo.** Reinicie o Nova para carregar as alterações.


## Tradução para pt-BR de 03/11/2026

O app instalado (`/Applications/Nova AI Mac.app`) foi traduzido inteiro para português do Brasil — só texto de interface, sem tocar em nenhuma função. Traduzidos: bundle da interface (`dist/assets/index-Dun7lr2S.js`, ~1.900 substituições), `dist/index.html`, PWA (`electron/pwa/`: index, admin, app.js, manifest), menus/diálogos do `electron/main.js`, mensagens visíveis dos services e a extensão nova-grab. **Reinicie o app para ver a tradução.** Cópia de todos os arquivos originais está em `../backup-antes-traducao/`. Nomes de hardware (Apple M1, Galaxy, GPUs — são valores de spoofing), modelos de IA e termos técnicos (Stop Loss, SKU, ADB) foram mantidos de propósito.

## Atualização local de 02/11/2026 — CAM HIJACK iPhone

O app instalado recebeu encaminhamento iOS para CAM HIJACK, correção do caminho do APK Android e textos de preparação por plataforma. Fontes, testes, reservas e o instalador iOS estão em `integracao-iphone/`.

**Pendente:** executar `integracao-iphone/instalar-iphone.command` no Terminal (sudo do iPhone) e validar a imagem na Câmera. O pacote nativo compilado é OBSGraphBridge 0.1-30 com suporte ao túnel USB em localhost:18999. O fluxo ativa a prévia nativa experimental; fotos/vídeos gravados e outros apps não estão validados nem habilitados nesta integração.

**O DMG abaixo é anterior a esta atualização e já não é idêntico ao app instalado.**

**Instalador anterior:** `Nova-AI-Mac-sem-ativacao.dmg` (1/11/2026, 789 MB) — é idêntico ao app **já instalado em `/Applications/Nova AI Mac.app`**, que é o que você usa no dia a dia. O `.zip` é o mesmo app em formato zip (backup).

## O que já foi feito ✅

### Port e base
- Port do instalador Windows (Electron) para macOS arm64, módulos nativos recompilados (SQLite, RobotJS).
- Ferramentas nativas embutidas: FFmpeg, ADB, scrcpy, cloudflared, yt-dlp.
- **Ativação removida**: sem tela de chave, sem formulário, sem consulta ao servidor de licença do fornecedor. Abre direto no painel.
- Instalado em `/Applications` (não precisa mais rodar do DMG).

### Segurança (endurecimento)
- **Túnel público do Cloudflare desligado por padrão** (só liga com `NOVA_REMOTE_TUNNEL=1` no terminal).
- **Todos os servidores internos escutam só em 127.0.0.1** (interface, WebSocket, RTMP) — nada exposto pra rede Wi-Fi ou internet.
- Correção crítica: o servidor RTMP interno não derruba mais o app quando a porta está ocupada.

### Recursos ativos
- **RTMP do Nova: porta 11935** (1935 é do MediaMTX). Para o Android via cabo nada muda (`adb reverse` entrega a 1935 dentro do celular). De outro computador: `rtmp://<ip-do-mac>:11935/live/nova`.
- **Wake word (ativação por voz): funcionando.** PortAudio + SpeechRecognition + sounddevice instalados no Python embutido. Precisa de internet (API de fala do Google) e permissão de microfone.
- **Mobile Cam Bridge**: câmera do celular alimentando o painel.
  - Android: página própria do app.
  - iPhone: Safari + túnel SSH por cabo (https://127.0.0.1:8899/pc-cam no celular) — nunca usa Wi-Fi.
- **PC → PHONE**: webcam do Mac aparecendo no celular (iPhone via túnel USB: https://127.0.0.1:8899/pc-cam).

### NOVO: iPhone integrado na aba PHONE CONTROL ✅
Com o iPhone 8 Plus **plugado no cabo** (jailbreak religado, OpenSSH ativo — a chave `~/.ssh/id_iphone` já está configurada):
- **DEVICES**: aparece como "iPhone 8 Plus (iOS 16.7.16)" na lista de aparelhos, igual um Android.
- **CONTROLS**: abre a janela **iPhone Console** dentro do sistema (sem navegador externo) — tela ao vivo controlável (clique = toque) via CatVNC + noVNC por cabo.
- **APPS**: listar apps instalados e abrir por nome — com tradução automática de pacotes Android→iOS (WhatsApp, Instagram, Chrome etc.).
- **BROWSER**: campo de URL abre o link no Safari do iPhone.
- **Screenshot**: salva imagem da tela (via canvas da tela ao vivo).
- Senha pedida na primeira conexão: a que você definiu em **Ajustes → CatVNC** (fica memorizada na página).
- Os túneis (iproxy 5900/2222) têm **auto-recuperação**: se caem, o app recria em segundos.

## O que ainda falta fazer ⏳

- **Fase 2 — SPOOFER / CAM HIJACK para iPhone**: vídeo do Mac virando a câmera NATIVA do iPhone, conectando o Nova ao seu tweak VCamMin (o equivalente do APK Android). É o último pedaço pra paridade total com o Android.
- **Toggles de Wi-Fi/Bluetooth** no CONTROLS para iPhone: respondem "não suportado por SSH" (Apple não expõe isso).
- **`youtube_auto/pipeline.py`**: o instalador original nem inclui esse arquivo — a automação de upload depende de reconstruí-lo.
- **Integrações que dependem das suas contas** (WhatsApp, Telegram, Google, chaves de IA): instaladas mas sem validação completa.
- **Câmera virtual completa, Antigravity, Stable Diffusion**: sem validação de fluxo completo.
- **Wake word com microfone real**: motor instalado e rodando; falta testar em uso com permissões do macOS.
- **Atualização automática**: não configurada (o feed do fornecedor é Windows-only).
- **Notarização Apple**: o app é assinado localmente (ad-hoc) — a primeira abertura sempre exige botão direito → Abrir.

## Arquivos desta pasta

| Arquivo | Papel |
|---|---|
| `Nova-AI-Mac-sem-ativacao.dmg` | **Instalador atual** (idêntico ao app instalado) |
| `Nova-AI-Mac-sem-ativacao.zip` | Mesmo app em zip (backup) — duplicado do DMG |
| `Nova-AI-Mac-Preview-com-ativacao.dmg` | Versão antiga com tela de ativação original (só se quiser usar a licença do fornecedor) |
| `LEIA-ME.md` | Este arquivo |

Gerado e mantido localmente. Não é distribuição oficial do fornecedor.

# Nova AI para macOS (Apple Silicon) — estado do projeto

## Injeção de câmera explícita para Safari — 06/11/2026

Pedido do usuário: a injeção de câmera também deve chegar ao Safari. A ponte 0.1-39 já cobria qualquer app pelo curinga (`appIDs:['*']`) e o `Tweak.x` já trata o grafo do Safari (`com.apple.WebKit.GPU`: dimensões próprias e caminho de stop específico). O ajuste torna o alvo explícito e auditável: nos dois configs de injeção (`enable()` do vídeo local e `setCameraInjection()` do CAM LIVE), `appIDs` agora lista `['*','com.apple.camera','com.apple.WebKit.GPU','com.apple.mobilesafari','com.apple.facetime']` — o curinga continua, então nenhum app perde cobertura. A mensagem de sucesso agora cita Câmera, FaceTime e Safari. Arquivos: `MAC/integracao-iphone/ios-camera.js`, `MAC/integracao-sequestro-cam/ios-camera.patched.js` e o app instalado (`electron/services/ios-camera.js`, backup `ios-camera.js.bak-*`). Branch `agent/ios/injetar-safari-20261106`, sem merge/push. Lembrete: no app instalado, iniciar CAM LIVE antes de Ligar (bug `this.mobile`, conserto na branch `5406337`).

## Conectar instala novamodel + nova-locale com a senha já digitada — 06/11/2026

O usuário pediu que a senha digitada no Conectar seja usada para instalar o que falta (modelo e GPS/fuso), sem digitar senha de novo. O `conexao-usb/setup.js` agora, no mesmo fluxo do Conectar (com a senha do modal):
- **novamodel**: se o `.deb` existir ao lado do setup e o pacote não estiver instalado, sobe por sftp e instala via `sudo -S` + senha; se já instalado, só informa a versão.
- **nova-locale**: confere os arquivos do helper (`/var/jb/usr/libexec/nova-locale.sh` + `com.aquiles.novalocale.plist`); se faltar, sobe os arquivos (`nova-locale.sh` e `com.aquiles.novalocale.plist` agora vão junto do app), move com `sudo -S`, ajusta permissões e carrega o daemon com `launchctl bootstrap` (fallback `kickstart`).
- A senha continua sem ser salva (é zerada no `finally`); cada comando `sudo` recebe a senha só pelo stdin daquela execução.

App instalado: `setup.js` corrigido com backup (`setup.js.bak-20261106-*`) e `novamodel.deb`/`nova-locale.sh`/plist copiados para `electron/services/iphone-setup/`. Para instalar no aparelho, o usuário toca **Conectar** mais uma vez e digita a senha — o resto é automático. Branch `agent/ios/novamodel-locale-conectar-20261106`, sem merge e sem push.

## Fase A — merge do seletor de modelo + pacotes release — 06/11/2026

Merge na `main` (de `530920e`) das três branches do seletor de modelo do iPhone, em sequência: `agent/jailbreak/modelo-iphone-20261105` → `agent/ios/modelo-iphone-20261105` → `agent/frontend/modelo-iphone-20261105` (merge octopus falharia no `MAC/LEIA-ME.md`). Conflito resolvido mantendo as três seções no topo (tweak+CLI, serviço+IPC, seletor da UI). Commits de merge: `93c63a5`, `b9d3116`, `b5c3522` (não enviados — push pendente de autorização).

**Testes após o merge:** `integracao-modelo/test/teste-novamodel.cjs` (5 ok), `integracao-modelo-app/novamodel.test.cjs` (30 verificações), `conexao-usb/setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` passando. `integracao-sequestro-cam/controles-independentes.test.cjs` **falha pré-existente** (já falhava em `530920e`): o teste fixa a ponte em `0.1-38` e espera o fluxo de injeção anterior à bridge 0.1-39; não foi alterado nesta fase — precisa de decisão separada.

**Pacotes release (theos, `FINALPACKAGE=1 DEBUG=0`):**
- Tweak `com.aquiles.novamodel_0.1_iphoneos-arm64.deb` (rootless arm64, `Version: 0.1`) em `integracao-modelo/packages/`.
- Bridge `com.aquiles.obsgraph-bridge_0.1-39_iphoneos-arm64.deb` (`Version: 0.1-39`) em `integracao-iphone/bridge/packages/`, copiado como `camera.deb` para `conexao-usb/` (repo) e `electron/services/iphone-setup/` (app). Ambos fora do git (`*.deb` ignorado).

**setup.js:** backport do app instalado para o repo (`ensureTunnel()`, listeners de erro do ssh2 com `on`+guarda `settled`, `launchctl kickstart mediaserverd` após instalar a ponte). `TARGET` ajustado de `0.1-39-1+debug` para `0.1-39` para casar com o pacote release (o mesmo ajuste foi aplicado no `setup.js` do app instalado). O bloco de instalação do `novamodel.deb` já está no repo, mas ainda **não** no app instalado (pendente da Fase C; exige colocar `novamodel.deb` em `electron/services/iphone-setup/`).

**Bundle:** `conexao-usb/dist/index-Dun7lr2S.patched.js` reaplicado no app (`dist/assets/index-Dun7lr2S.js`), levando o seletor de modelo (IPC `spoofer:get-ios-models`).

**DMG:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-06.dmg`, gerado do app instalado com `CFBundleVersion=20261106.1` e `LSMinimumSystemVersion=26.0`.

```
sha256  4bf34a8c0210dc81ba933ed45471e5febe814e63cc8836a2917c412722ded685
```

Assinatura ad hoc, sem Developer ID nem notarização. Estado registrado: `spctl --assess` no app dentro do DMG → `invalid Info.plist (plist or signature have been modified)`; no app instalado → `a sealed resource is missing or invalid`. Uso em outro Mac: abrir com Ctrl+clique → Abrir.

## Spoofing de modelo do iPhone (tweak + CLI) — 05/11/2026

Criado o pacote `com.aquiles.novamodel` (rootless) para o iPhone reportar outro modelo (ex. "iPhone 13" → `iPhone14,5`), a contraparte iOS do spoofing de identidade que hoje só existe em Android. Só modelo — sem IMEI/serial.

- **Tweak `NovaModel.dylib`** (Substrate, carrega em todo processo): hooka `MGCopyAnswer`/`MGCopyAnswerWithError`/`MGGetStringAnswer` (whitelist fechado: `ProductType`, `HWModelStr`, `ModelNumber`, `ProductName`, `MarketingProductName`), `sysctlbyname`/`sysctl` (`hw.machine`, `hw.product`) e `UIDevice` (`model`, `localizedModel`, `modelName`/`_modelName` privados). Lê `/var/tmp/nova-model-control.json` com cache por mtime (aplicação instantânea).
- **CLI `/var/jb/usr/bin/novamodel`** (setuid root): `set <productType>` (valida no banco e grava o control file), `clear`, `status` (JSON `real`/`active`/`enabled`). Roda sem o tweak, então `status` lê o ProductType real.
- **Banco de modelos** `models.json` (27 modelos: iPhone 8 → 15), instalado em `/var/jb/usr/share/novamodel/models.json`.

Arquivos: `integracao-modelo/` (Tweak.x, main.m, models.json, Makefile, layout, test). Compila no theos e gera `.deb` rootless arm64 (`packages/com.aquiles.novamodel_0.1-*.deb`). Teste automatizado `test/teste-novamodel.cjs` valida banco, contrato do control file e whitelist MG. **Sem testar no aparelho real** (efeito em Ajustes/Sobre e apps, `dpkg -i`, setuid); `HWModelStr`/`ModelNumber` estão no whitelist mas não são spoofados na v1 (códigos de placa/número de modelo são por variante/região).

## Spoofing de modelo do iPhone — serviço + IPC + instalação do .deb — 05/11/2026

Integração no app para o tweak `com.aquiles.novamodel` (spec `NOVA-AI-MODELO-SPOOF-SPEC.md`). No `physicalMobileService` entraram `getIosModels()`, `applyIOSModel(deviceId, productType)`, `clearIOSModel(deviceId)` e `getIOSModel(deviceId)` — chamam `/var/jb/usr/bin/novamodel` via `iosSsh` (túnel USB). IPCs novos em `main.js`: `spoofer:get-ios-models`/`spoofer:apply-ios-model`/`spoofer:clear-ios-model`/`spoofer:get-ios-model` (nomes do contrato da UI). Banco de modelos em `iosModels.json`; instalação do `novamodel.deb` pelo fluxo Conectar (guarded: só quando o `.deb` existir ao lado do `camera.deb`).

- Arquivos: `integracao-iphone/ios-modelo.js` (novo), `integracao-iphone/iosModels.json` (novo), `integracao-iphone/physicalMobileService.patched.js`, `integracao-iphone/conexao-usb/setup.js`, `integracao-modelo-app/main.modelo.js`, `integracao-modelo-app/novamodel.test.cjs`, `integracao-modelo-app/README.md`.
- Testado: `node --check` nos arquivos tocados + `novamodel.test.cjs` (30 verificações com mock de SSH).
- Sem testar: instalação e execução real do CLI (o `.deb` do Jailbreak Specialist ainda não existe) e o IPC no Electron (só sintaxe + mock). Detalhes: `MAC/integracao-modelo-app/README.md`.

## Seletor de modelo do iPhone no painel "Identidade simulada" — 05/11/2026

Spoofing de modelo do iPhone na UI: no painel **Identidade simulada** (janela "Controle do Celular"), o seletor de modelo do iPhone agora é alimentado pelo banco de modelos iOS e tem botões **Aplicar modelo** e **Limpar modelo**.

- **Seletor:** populado dinamicamente via `spoofer:get-ios-models` (27 modelos do banco do serviço, `{productType, name}`); o bundle não tem mais lista fixa. Ex.: iPhone 13 = `iPhone14,5`.
- **Contrato de IPC (bundle → main):** `spoofer:get-ios-models` (sem args → `{success, models[]}`), `spoofer:apply-ios-model {deviceId, productType}` (aplica), `spoofer:clear-ios-model {deviceId}` (restaura o real) e `spoofer:get-ios-model {deviceId}` (lê `{real, active, enabled}`). Os handlers no `main.js`/`physicalMobileService` são do iOS Engineer; o bundle já chama esses canais. Se o IPC ainda não existir, o seletor mostra a falha no painel (estado "error").
- **Estados:** `applying` (spinner), `applied` (verde, "Modelo aplicado no iPhone"), `idle` (modelo real) e `error` (vermelho). Ao abrir a aba, `spoofer:get-ios-model` lê o estado atual.
- **Texto pt-BR**; nomes de modelo (dados de spoofing) não traduzidos.

Arquivos: `MAC/integracao-iphone/conexao-usb/dist/index-Dun7lr2S.patched.js` (patch no bundle). Reaplicado `aplicar-botao-iphone.py` (idempotente) e `node --check` OK.

Sem testar: execução real no app (bundle patcheado ainda não copiado para `/Applications/Nova AI Mac.app`) e o fluxo Aplicar/Limpar contra o tweak `novamodel` no iPhone (depende do iOS Engineer expor os IPCs e do Jailbreak Specialist instalar o `.deb`).

## Chave SSH do iPhone agora é do app — 04/11/2026

A chave usada para falar com o iPhone saiu de `~/.ssh/id_iphone` e passou para `~/Library/Application Support/nova_dsktp/iphone-ssh/` (modo 0600), junto com o `known_hosts` do aparelho. Todos os `ssh`/`scp` do app usam `-i` explícito, `IdentitiesOnly=yes` e `UserKnownHostsFile=` desse diretório, então não caem mais nas outras chaves do agente SSH do Mac.

- `services/iphone-ssh.js` é o único lugar que conhece o caminho; `setup.js`, `physicalMobileService.js`, `ios-camera.js`, `cam-live-iphone.js` e `ios-bridge.js` passaram a usar `sshOptions()`.
- Migração automática no boot (`migrateLegacy()`): se existir `~/.ssh/id_iphone` e ainda não houver a do app, ela é **movida** (não copiada) e a linha `[127.0.0.1]:2222` do `known_hosts` é herdada. É a mesma chave, o iPhone continua autorizando — não precisa refazer o Conectar.
- Em teste (`NOVA_SMOKE_TEST=1`) a migração não roda; `NOVA_USER_DATA` isola os caminhos.
- Não é isolamento criptográfico: qualquer processo do mesmo usuário do macOS ainda lê o arquivo (0600). O ganho é sair do `~/.ssh` (fora de dotfiles, backups e outras ferramentas) e ter par chave/known_hosts só do app.

Verificação: migração simulada com `HOME` falso moveu a chave com 0600, herdou o known_hosts e gerou as opções certas; 15 testes do CAM LIVE + `setup.test.cjs` + `botao-servico.test.cjs` passando. **Reinicie o Nova** para a migração acontecer. No repo, `integracao-camlive/`, `integracao-sequestro-cam/` e `encerramento-nova/` têm um shim `iphone-ssh.js` porque neles os arquivos não ficam lado a lado como em `electron/services/`.

## Cartão do iPhone: "Abrir controle" reaplicado — 04/11/2026

O bundle em uso (`dist/assets/index-Dun7lr2S.js`) estava **sem** o patch do botão do iPhone: o cartão de um aparelho já preparado mostrava **PARAR TRANSMISSÃO** (vermelho) em vez de **Abrir controle**, o que dá a impressão de transmissão ativa mesmo com o aparelho parado — o `streaming` do iOS é o registro de pareamento (`iphone-hosts.json`), não uma transmissão real. Outro patch de bundle aplicado depois (controle de celular/geo-proxy) sobrescreveu o trecho.

Reaplicado `conexao-usb/aplicar-botao-iphone.py` no app instalado: iPhone preparado agora mostra **Abrir controle** (ciano) e abre o console direto; Android continua com **Parar transmissão**. A lista de dispositivos já se atualiza sozinha a cada 5 s (o painel faz `setInterval` de `physical-mobile:get-status`), então desplugado deixa de aparecer. Cópia canônica do bundle em `conexao-usb/dist/index-Dun7lr2S.patched.js`; anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/index-Dun7lr2S.antes-botao.js`.

**Regra nova no `AGENTS.md`:** qualquer patch futuro no bundle precisa reaplicar este script (é idempotente) antes de copiar para o app, senão o botão volta a regredir. Recarregue com **Cmd+R** ou reinicie o Nova.

## Transporte camuflado Mac → iPhone (bridge 0.1-39) — 04/11/2026

O que a Câmera do iPhone consome deixou de ser `http://127.0.0.1:18999/frame.jpg`.

- O servidor do Mac (CAM LIVE e CAM HIJACK) só responde em `/s/<token de 32 hex>/frame.jpg` e `/s/<token>/audio`; sem o token a resposta é 404 neutro. O token é novo a cada sessão.
- O túnel SSH tenta primeiro um **socket Unix** em `/var/tmp/.nb-<8hex>.sock` (modo 666 para o mediaserverd). Nenhuma porta TCP fica escutando no iPhone. Se o sshd do aparelho recusar streamlocal, cai para uma **porta TCP aleatória** (20000–39999) com o mesmo token; o `-v` do ssh foi removido.
- O bridge 0.1-39 valida o caminho com token, aceita `socket` no control, recusa a rota antiga e **removeu o IP fixo `10.0.0.245:8900`** que vinha do projeto original.
- O sequestro (item 3) passou a pedir o endereço ao CAM LIVE (`mediaEndpoint()`): CAM LIVE, CAM HIJACK e sequestro compartilham o mesmo token/transporte em vez de repetir 18999.

Compatibilidade: pontes 0.1-38 e anteriores são recusadas ("atualize por USB") porque não conhecem o token. Atualize pelo **Conectar** em PHONE CONTROL — o `camera.deb` 0.1-39 já está incluído no app.

Arquivos: `integracao-iphone/bridge/Tweak.x` (0.1-39), `integracao-camlive/cam-live-iphone.js`, `integracao-iphone/ios-camera.js` (= `integracao-sequestro-cam/ios-camera.patched.js`), `conexao-usb/setup.js` (alvo 0.1-39) e `conexao-usb/camera.deb`. Reservas do instalado anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/`. Testes: 15 passam (`node --test` em `integracao-camlive/test/`), incluindo token/404, socket Unix, fallback TCP e sequestro. **Não testado no aparelho**: se o sshd do iPhone aceita `-R` com socket Unix e se o mediaserverd (sandbox) consegue conectar; se recusar, o fallback TCP entra sozinho. Reinicie o Nova e refaça o Conectar para instalar a 0.1-39.

## Conexão do iPhone dentro do app — 04/11/2026

O **Conectar** dos iPhones em PHONE CONTROL deixou de abrir uma janela/página externa para a senha SSH. Agora o formulário, o progresso e o controle do iPhone são desenhados **dentro da janela do Nova**, como um modal do próprio app: fundo escurecido e embaçado, mesmo visual do Controle do Celular, X/Esc para fechar (bloqueado durante a preparação) e tempo decorrido.

A senha continua só em memória: o campo é limpo antes do envio ao processo principal, a senha não entra em log nem em mensagem de erro. O modal roda no preload (`inapp.js`), fora do bundle React — não depende do `index-Dun7lr2S.js`. Depois do sucesso, "Abrir controle e tela do iPhone" carrega o iPhone Console num `<webview>` dentro do app, com "Abrir em janela" como alternativa.

Depois de conectar, o cartão do iPhone não fica mais em **Conectar**: passa a **Abrir controle**, que abre o console dentro do app sem senha. O estado vem do registro `iphone-hosts.json` gravado por um Conectar bem-sucedido; Android segue com "Parar transmissão" e o botão **Refazer conexão** fica no topo do controle.

Arquivos: `integracao-iphone/conexao-usb/` (`inapp.js`, `setup.js`, `aplicar-botao-iphone.py`, `botao.test.cjs`, `botao-servico.test.cjs`, `setup.test.cjs`, `test/modal/`, `dist/index-Dun7lr2S.patched.js`, `docs/`), com os arquivos da janela antiga em `integracao-iphone/reservas/modal-externo-20261104/` e o estado anterior desta rodada em `integracao-iphone/reservas/botao-conectado-20261104/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: `node --check` nos quatro arquivos; testes do serviço (senha inválida, aparelho único, janela ausente); harness em Electron com o **preload real** abrindo o modal por IPC, enviando a senha e confirmando o campo vazio; estados idle/preparando/sucesso/erro e o webview do console renderizados sem exceção. **Conexão real no aparelho não refeita** (exige a senha do iPhone) e **reiniciar o Nova** para carregar.

## Foto ➔ Vídeo (Kling) acessível e corrigido — 03/11/2026

A função de animar foto em vídeo (Capítulo 3 do guia) existia no código, mas estava **sem botão de acesso** nesta versão: a seção "kling" da Suíte de Vídeo só abria por um evento interno (`nova-open-kling-video`) que nada disparava. Foram corrigidos 7 problemas no fluxo:

1. **Botão novo** "Foto ➔ Vídeo" na barra da Suíte e Estúdio de Vídeo (AI UPLOAD), entre "Criador de IA" e "Recortador Seguro" — abre a seção de selecionar foto → movimento → proporção/duração → converter.
2. **FFmpeg do Mac**: o serviço só procurava `ffmpeg.exe` (Windows); agora acha o `Resources/bin/ffmpeg` do macOS. Sem isso, o motor gratuito offline sempre falhava.
3. **Pasta de saída errada**: o vídeo era salvo em `cwd/youtube_auto/exports` (caía no Downloads) enquanto a biblioteca "Arquivos Exportados" lê `app/youtube_auto/exports` — o vídeo nunca apareceria na lista. Agora salva na pasta certa.
4. **Tamanho real do arquivo** na biblioteca (era fixo 5 MB).
5. **WebP** enviado com mime correto para a Kling Cloud.
6. **Tradução**: 12 textos em inglês esquecidos no fluxo ("Clear Picture", "Converting Picture into Video...", mensagens de status, "Library (n)" etc.).
7. **Assinatura** ad-hoc refeita após o patch (`codesign --verify` OK).
8. **Prévia do vídeo cinza (0:00)**: as URLs `file:///` eram montadas com padrão de Windows (`file:///` + caminho absoluto Unix = 4 barras), e o Chromium não achava o arquivo — o vídeo era gerado certo, mas o player ficava escuro. Corrigido para o player "✨ Vídeo Gerado Pronto" e para a prévia da foto escolhida via "Procurar Arquivos". O botão "Salvar Vídeo" e sua mensagem também foram traduzidos ("Save to Phone Storage" etc.).
9. **Vídeo saía parado (foto imóvel)**: o motor local usava `zoompan` com estado acumulado (`zoom+0.0012`) e `-loop 1`, combinação que congelava o efeito com certas fotos de entrada (verificado num caso real: 10 s de imagem imóvel, PSNR 61 entre quadros distantes). Reescrito com expressões puras em função do número do quadro (`on`), sem `-loop`, na receita canônica do FFmpeg para Ken Burns — o movimento agora vai do primeiro ao último quadro em todos os 5 presets. Teste `test/teste-movimento.cjs`: 20 combinações (5 presets × jpg/png/webp em vários tamanhos), todas com movimento medido (PSNR 6–13 entre 1 s e 8 s).
10. **"Salvar Vídeo" baixava HTML quebrado**: o botão usava download por âncora de URL `file://`, que o Chromium bloqueia — salvava uma página de erro de 15 KB com nome .mp4 (por isso "não pode ser aberto" no Mac). Novo IPC `kling:save-video` no `main.js` copia o arquivo real para o Downloads (sem sobrescrever: acrescenta -2, -3…), abre o Finder no arquivo e o botão usa esse IPC com fallback. As 3 cópias quebradas no Downloads do usuário foram substituídas pelos vídeos reais. Original do `main.js` antes deste patch em `reservas/instalado-antes-kling-2026-11-03-main.js`.
11. **IA do Sistema (Veo) no Foto ➔ Vídeo**: o app tinha chave Gemini configurada (`secret_key.json`, lida por `app.getGeminiToken()` — a mesma do Nova Studio), mas nenhum caminho de geração de vídeo. Adicionado o motor "IA do Sistema" no `kling-video-service.js` (`_generateSystemAIVideo`) com **auto-descoberta**: consulta `ListModels` (gratuito) e usa os modelos Veo que a chave tiver. **Testado com a chave atual: a API listou 60 modelos e nenhum é Veo** — ou seja, a chave do Nova não tem acesso a vídeo (Veo via API exige faturamento Google). O caminho fica pronto para o dia em que o faturamento for ativado.
12. **Motor fal.ai no Foto ➔ Vídeo (botão verde)**: como a chave do Nova não faz vídeo, o botão "Converter com IA fal.ai" usa a chave **fal-key do Chaveiro do Mac** (a mesma do projeto criar-videos, lida com `security find-generic-password`). Fila `queue.fal.run`, imagem em data URI, modelo mais barato primeiro (`fal-ai/bytedance/seedance/v1/lite/image-to-video`, fallbacks Wan 2.2 e Kling 2.1), 720p, duração 5/10 s, espera com progresso e download para `exports`. **Custa por vídeo na conta fal.ai** — confirmar antes de gerar. Reinicie o Nova para carregar.

Arquivos: `integracao-kling/` (fontes patcheadas + `reservas/` com os originais de antes + `test/teste-motor-local.cjs`). Teste de ponta a ponta do motor local passou no app instalado: imagem de teste → MP4 720×1280 válido em `app/youtube_auto/exports`, com progresso e limpeza automáticos. **Reinicie o Nova para carregar.** Sem chave da API Kling, usa o Nova Motion Engine local (grátis, Ken Burns por FFmpeg); com chave, envia para `api.klingai.com` (kling-v1) — a autenticação Bearer da Kling pode exigir JWT próprio dela, não validado (não há conta para testar). O DMG não foi regenerado.

## CAM LIVE direto para o iPhone por USB — 03/11/2026

O CAM LIVE agora transmite **sem OBS, MediaMTX nem servidor RTMP**. O destino padrão é "iPhone por USB — automático" (formato celular 720×1280): o renderer envia JPEG (`camlive:frame`) e PCM das cenas (`camlive:pcm`); o processo principal (`cam-live-iphone.js`) serve `/frame.jpg` e `/audio` em loopback, abre o túnel SSH reverso para a porta 18999 do iPhone, codifica o áudio em AAC-LC 44,1 kHz com o FFmpeg incluído e só ativa a câmera depois de haver imagem **e** áudio. RTMP continua em Configurações → Avançado. Não há IP, porta ou chave para digitar.

Pré-requisito: iPhone conectado por **Conectar** (PHONE CONTROL) — exatamente um iPhone, ponte 0.1-38 com hooks de foto prontos. O pacote 0.1-38 agora acompanha o Nova (`conexao-usb/camera.deb`) e é instalado/atualizado por Conectar no iPhone10,2 / iOS 16.7.16. Um `enabled:true` antigo na ponte com lease expirado já não bloqueia o início.

Arquivos: `integracao-camlive/` (cam-live.js, cam-live-audio.js, cam-live-service.js, cam-live-iphone.js); aplicado no app instalado, com cópia do `main.js` anterior em `integracao-camlive/reservas/instalado-antes-usb-*`. Testes: `test/iphone-*.cjs` (14 testes passam) e `test/harness-usb.js` (iPhone simulado: ~16 fps de JPEG válidos e PCM em tempo real chegaram; parar interrompe os dois). FFmpeg incluído gerou ADTS aceito pelo parser.

**Não testado:** transmissão real até a Câmera do iPhone (a imagem aparecer no app Câmera), aparelhos além do iPhone 8 Plus, e o DMG não foi regenerado — o instalador final ainda não contém esta mudança. Reinicie o Nova para carregar. Windows fica para depois.

## Pacote Mac portátil de 03/11/2026

**Arquivo para compartilhar:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-03-final.dmg`. Use a versão `-final`; a primeira imagem foi uma tentativa intermediária e foi preservada. A cópia final do app passou na verificação de assinatura local `codesign --verify --deep --strict`.

Destino inicial: Mac Apple Silicon com macOS 26+. Windows fica para uma etapa posterior. O requisito macOS 26 vem dos binários efetivamente incluídos, não do Electron: auditoria de 227 arquivos Mach-O encontrou requisito máximo 26.0 e nenhuma dependência carregada de Homebrew, `/usr/local` ou `/Users`.

Python/PortAudio e bibliotecas foram incluídos em `python-runtime-portable/`, Chromium em `browsers/`, e os serviços passaram a usar o Python interno. Validados importação de módulos de áudio/rede/compressão/SQLite, HTTPS com certificados incluídos e lançamento do navegador interno. O Python também executou na cópia em outra pasta. O pacote exclui o venv antigo e a tentativa incompleta de runtime; nenhuma dessas cópias originais foi apagada.

O Nova abriu com perfil vazio e PATH mínimo (`SMOKE_EXIT 0`), com interface React carregada e API Electron disponível. Evidências em `distribuicao/teste-perfil-vazio-1793726904588/` e `distribuicao/verificacao-binarios.json`. Isso não substitui teste em outro Mac limpo. Não há validação de todas as funcionalidades, nem adaptação da ponte 0.1-38. Upload automático do YouTube continua sem pipeline. Serviços online continuam dependendo de internet e contas próprias.

Scripts de reprodução e auditoria em `integracao-iphone/distribuicao/`. Os dados pessoais de Application Support, perfis de navegador e chaves SSH não são copiados para a distribuição. A assinatura é local, sem notarização Apple.

## Portabilidade — revisão inicial de 03/11/2026 (histórico)

As ferramentas USB iPhone (`iproxy`, `idevice_id`, `ideviceinfo`, `ideviceinstaller`) e nove bibliotecas agora estão em `Contents/Resources/ios-tools/`. Os serviços iPhone passaram a resolver apenas esses executáveis incluídos no app. Teste: todas as quatro ferramentas iniciam com `PATH=/usr/bin:/bin`; nenhum dos 13 arquivos Mach-O possui dependência absoluta de Homebrew. Licenças locais foram copiadas para `ios-tools/licenses/`. Script de reprodução: `integracao-iphone/distribuicao/empacotar-ferramentas.py`.

**Na revisão inicial, a distribuição ainda não estava pronta.** O Python incluído era um venv com `home` e executável de origem no Homebrew; precisa de um runtime portátil para funções Python. O instalador DMG/ZIP existente continua antigo. Falta testar em outro Mac sem ferramentas de desenvolvimento. Esta alteração não atualiza o EXE Windows. O iPhone ainda precisa ter jailbreak ativo e OpenSSH, e CatVNC tem configuração própria. Contas e credenciais devem ser configuradas por cada usuário, sem copiar dados de `Application Support` ou chaves SSH pessoais.

## Conexão iPhone por senha SSH — 03/11/2026

O botão dos iPhones em DEVICES agora mostra **Conectar** e abre uma janela para a senha SSH do usuário `mobile`. O fluxo exige jailbreak ativo e OpenSSH já instalado no iPhone. A senha fica apenas em memória durante a operação. O app prepara uma chave SSH, verifica o acesso e oferece abrir o console. Exige somente um iPhone conectado; não faz jailbreak automaticamente.

O pacote OBSGraphBridge 0.1-30 está incluído no app e pode ser instalado sem download externo no iPhone10,2 com iOS 16.7.16. Outras versões já instaladas são preservadas. Não há instalação automática do CatVNC nem suporte universal às funções Android: o fluxo informa essas limitações. CatVNC ainda exige instalação e configuração próprias.

Fontes e testes: `integracao-iphone/conexao-usb/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: sintaxe do main, bundle em modo módulo, serviço, carregamento do SSH e testes de limites IPC/múltiplos aparelhos. **Conexão e instalação reais no aparelho ainda não testadas neste fluxo.** Reinicie o Nova para carregar as alterações.


## Tradução para pt-BR de 03/11/2026

O app instalado (`/Applications/Nova AI Mac.app`) foi traduzido inteiro para português do Brasil — só texto de interface, sem tocar em nenhuma função. Traduzidos: bundle da interface (`dist/assets/index-Dun7lr2S.js`, ~1.900 substituições), `dist/index.html`, PWA (`electron/pwa/`: index, admin, app.js, manifest), menus/diálogos do `electron/main.js`, mensagens visíveis dos services e a extensão nova-grab. **Reinicie o app para ver a tradução.** Cópia de todos os arquivos originais está em `../backup-antes-traducao/`. Nomes de hardware (Apple M1, Galaxy, GPUs — são valores de spoofing), modelos de IA e termos técnicos (Stop Loss, SKU, ADB) foram mantidos de propósito.

## Atualização local de 02/11/2026 — CAM HIJACK iPhone

O app instalado recebeu encaminhamento iOS para CAM HIJACK, correção do caminho do APK Android e textos de preparação por plataforma. Fontes, testes, reservas e o instalador iOS estão em `integracao-iphone/`.

**Pendente:** executar `integracao-iphone/instalar-iphone.command` no Terminal (sudo do iPhone) e validar a imagem na Câmera. O pacote nativo compilado é OBSGraphBridge 0.1-30 com suporte ao túnel USB em localhost:18999. O fluxo ativa a prévia nativa experimental; fotos/vídeos gravados e outros apps não estão validados nem habilitados nesta integração.

**O DMG abaixo é anterior a esta atualização e já não é idêntico ao app instalado.**

**Instalador anterior:** `Nova-AI-Mac-sem-ativacao.dmg` (1/11/2026, 789 MB) — é idêntico ao app **já instalado em `/Applications/Nova AI Mac.app`**, que é o que você usa no dia a dia. O `.zip` é o mesmo app em formato zip (backup).

## O que já foi feito ✅

### Port e base
- Port do instalador Windows (Electron) para macOS arm64, módulos nativos recompilados (SQLite, RobotJS).
- Ferramentas nativas embutidas: FFmpeg, ADB, scrcpy, cloudflared, yt-dlp.
- **Ativação removida**: sem tela de chave, sem formulário, sem consulta ao servidor de licença do fornecedor. Abre direto no painel.
- Instalado em `/Applications` (não precisa mais rodar do DMG).

### Segurança (endurecimento)
- **Túnel público do Cloudflare desligado por padrão** (só liga com `NOVA_REMOTE_TUNNEL=1` no terminal).
- **Todos os servidores internos escutam só em 127.0.0.1** (interface, WebSocket, RTMP) — nada exposto pra rede Wi-Fi ou internet.
- Correção crítica: o servidor RTMP interno não derruba mais o app quando a porta está ocupada.

### Recursos ativos
- **RTMP do Nova: porta 11935** (1935 é do MediaMTX). Para o Android via cabo nada muda (`adb reverse` entrega a 1935 dentro do celular). De outro computador: `rtmp://<ip-do-mac>:11935/live/nova`.
- **Wake word (ativação por voz): funcionando.** PortAudio + SpeechRecognition + sounddevice instalados no Python embutido. Precisa de internet (API de fala do Google) e permissão de microfone.
- **Mobile Cam Bridge**: câmera do celular alimentando o painel.
  - Android: página própria do app.
  - iPhone: Safari + túnel SSH por cabo (https://127.0.0.1:8899/pc-cam no celular) — nunca usa Wi-Fi.
- **PC → PHONE**: webcam do Mac aparecendo no celular (iPhone via túnel USB: https://127.0.0.1:8899/pc-cam).

### NOVO: iPhone integrado na aba PHONE CONTROL ✅
Com o iPhone 8 Plus **plugado no cabo** (jailbreak religado, OpenSSH ativo — a chave `~/.ssh/id_iphone` já está configurada):
- **DEVICES**: aparece como "iPhone 8 Plus (iOS 16.7.16)" na lista de aparelhos, igual um Android.
- **CONTROLS**: abre a janela **iPhone Console** dentro do sistema (sem navegador externo) — tela ao vivo controlável (clique = toque) via CatVNC + noVNC por cabo.
- **APPS**: listar apps instalados e abrir por nome — com tradução automática de pacotes Android→iOS (WhatsApp, Instagram, Chrome etc.).
- **BROWSER**: campo de URL abre o link no Safari do iPhone.
- **Screenshot**: salva imagem da tela (via canvas da tela ao vivo).
- Senha pedida na primeira conexão: a que você definiu em **Ajustes → CatVNC** (fica memorizada na página).
- Os túneis (iproxy 5900/2222) têm **auto-recuperação**: se caem, o app recria em segundos.

## O que ainda falta fazer ⏳

- **Fase 2 — SPOOFER / CAM HIJACK para iPhone**: vídeo do Mac virando a câmera NATIVA do iPhone, conectando o Nova ao seu tweak VCamMin (o equivalente do APK Android). É o último pedaço pra paridade total com o Android.
- **Toggles de Wi-Fi/Bluetooth** no CONTROLS para iPhone: respondem "não suportado por SSH" (Apple não expõe isso).
- **`youtube_auto/pipeline.py`**: o instalador original nem inclui esse arquivo — a automação de upload depende de reconstruí-lo.
- **Integrações que dependem das suas contas** (WhatsApp, Telegram, Google, chaves de IA): instaladas mas sem validação completa.
- **Câmera virtual completa, Antigravity, Stable Diffusion**: sem validação de fluxo completo.
- **Wake word com microfone real**: motor instalado e rodando; falta testar em uso com permissões do macOS.
- **Atualização automática**: não configurada (o feed do fornecedor é Windows-only).
- **Notarização Apple**: o app é assinado localmente (ad-hoc) — a primeira abertura sempre exige botão direito → Abrir.

## Arquivos desta pasta

| Arquivo | Papel |
|---|---|
| `Nova-AI-Mac-sem-ativacao.dmg` | **Instalador atual** (idêntico ao app instalado) |
| `Nova-AI-Mac-sem-ativacao.zip` | Mesmo app em zip (backup) — duplicado do DMG |
| `Nova-AI-Mac-Preview-com-ativacao.dmg` | Versão antiga com tela de ativação original (só se quiser usar a licença do fornecedor) |
| `LEIA-ME.md` | Este arquivo |

Gerado e mantido localmente. Não é distribuição oficial do fornecedor.

# Nova AI para macOS (Apple Silicon) — estado do projeto

## nova-locale v2 (complemento): auto-checagem de comandos e recusas do helper root — 07/11/2026

Revisão da v2 do iOS Engineer (7a5dcba) por quem cuida do helper. Medido rodando o script de verdade num sandbox do Mac (caminhos trocados por uma pasta temporária; nada do aparelho tocado). Três furos, os três corrigidos aqui:
1. **Status falso.** Com a v2 original, se faltar o `sleep` (ou outro comando) na partida, o script grava `{"ok":true,"message":"pronto v2"}` e só depois sai com 1. O handshake do Conectar procura exatamente esse texto e diria "atualizado" com o serviço em laço de reinício. Agora, antes de dizer pronto, o script confere `sleep sed head grep cp mv ln chown chmod rm`; se faltar algum, grava `{"ok":false,"message":"helper sem comandos: ..."}`, 1 linha no `.err` e sai com 78. O `sleep 1 || exit 1` do laço continua, para o caso de o `sleep` sumir com o serviço já rodando. O `trim_logs` passou a rodar antes dessa checagem.
2. **`trim_logs` seguia link simbólico.** `: >` segue o link: um `nova-locale.out` apontando para outro arquivo zerava o arquivo apontado (medido: 2 MiB → 0). Agora link simbólico é ignorado.
3. **`plist=` com `..`.** `/var/tmp/../x.plist` passava no teste de prefixo e só o `<?xml` na primeira linha segurava; como o helper é root e o `.cmd` é gravável por qualquer processo, dava para copiar um plist qualquer para as preferências do `mobile`. Agora `..` e link simbólico são recusados. O app atual só manda `tz`, então nada muda para ele.

Arquivos: `conexao-usb/nova-locale.sh` e o gêmeo `geo-proxy/helper/nova-locale.sh` (idênticos); `conexao-usb/locale-helper.test.cjs` (o teste 2a mudou de "exit 1 + pronto v2" para "exit 78 + ok:false, nunca pronto v"; novos 2c = `sleep` some com o serviço no ar e 2d = link simbólico/plist). `HELPER_VERSION` continua 2: a v2 ainda não foi para o aparelho. Branch `agent/jailbreak/locale-selfcheck-20261107`, empilhada em `agent/ios/locale-endurecer-20261107`, sem merge/push. Substitui a primeira tentativa (`agent/jailbreak/locale-script-endurecer-20261107`), que reescrevia o script por conta própria.

Testes (07/11): `locale-helper.test.cjs` (1, 2a, 2b, 2c, 2d, 3), `setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` OK. O 2a novo falha contra o script v2 original, como deve. No launchd real do Mac (agente temporário, `KeepAlive`, sem `sleep` no PATH) o script com esta checagem religou em t=0/10/20/30 s, 1 linha de 81 bytes por vez, `last exit code = 78: EX_CONFIG`, sem nenhum "pronto".

**Sem testar:** o aparelho (nada foi instalado nem executado lá), o bash 5 do Procursus e o `ThrottleInterval` do launchd do iOS 16 (medi o do macOS).

## Helper nova-locale v2: guarda do sleep, log limitado e Conectar que confere o reinício — 07/11/2026

**Contexto medido no aparelho (só leitura, 07/11):** o helper antigo rodou ~19 h (06/11 16:40 → 07/11 11:37, relógio do aparelho) com o PATH mínimo do launchd (`/usr/bin:/bin:/usr/sbin:/sbin`), onde **nenhum** comando do script existe (`sed head cp mv ln chown chmod grep rm cat date sleep killall sbreload` — todos ausentes; no PATH do Procursus todos resolvem em `/var/jb/usr/bin`). Resultado: laço sem pausa, ~118 erros/s, `nova-locale.err` com 571.321.165 B (~8 milhões de linhas `sleep: command not found`) e nenhum comando processado. O fix do PATH (7804b60) chegou ao aparelho no Conectar das 11:37:33 (script idêntico ao do app, daemon novo PID 93721, `launchctl print`: `runs = 2`, `last terminating signal = Killed: 9`) e o log parou de crescer. Ping do helper novo testado no aparelho às 12:06 (com OK do usuário): `action=ping` consumido em ~1,5 s, status e log atualizados, stderr sem escrita.

**O que mudou (branch `agent/ios/locale-endurecer-20261107`, empilhada em `agent/ios/idioma-novaproxy-conectar-20261106`):**
1. `nova-locale.sh` v2 (`HELPER_VERSION=2`):
   - `sleep 1 || { ...; exit 1; }` — se o PATH quebrar de novo o serviço **encerra**; o launchd só reinicia depois de 10 s (≈1 linha a cada 10 s em vez de ~118/s). No sandbox sem `sleep`: v1 = 2.144 linhas/s sem parar; v2 = sai em 14 ms com 2 linhas.
   - `trim_logs`: ao subir e a cada ~10 min, zera `nova-locale.err`, `.out` e `.log` que passarem de 1 MB (o arquivo continua existindo). Roda como root, então **o primeiro start da v2 também zera os 571 MB** sem comando manual.
   - O status ao subir (e no `ping`) passa a ser `pronto v2` (antes `pronto`).
2. `setup.js` (Conectar): depois do `bootstrap || kickstart -k`, lê (sem sudo) `/var/tmp/nova-locale-status.json` por até ~10 s e só diz "nova-locale vN atualizado" quando o status traz `pronto vN` (N vem da linha `HELPER_VERSION=` do script enviado). Se não aparecer: "arquivos enviados, mas o serviço não confirmou a versão vN. Rode o Conectar de novo." Antes o `|| true` engolia a falha e a frase "atualizado" saía sempre; um reinício que falhasse deixaria o processo velho vivo (o bash segue com o arquivo antigo aberto) sem aviso. `module.exports` ganhou `__test` (só para teste).
3. Gêmeo `MAC/controle-celular-plataformas/geo-proxy/helper/nova-locale.sh` mantido idêntico.

**Arquivos novos:** `conexao-usb/locale-helper.test.cjs` (estático + roda o script de verdade num sandbox com caminhos reescritos + handshake com cliente SSH falso) e `conexao-usb/aplicar-locale-v2.cjs` (aplica no app instalado: simulação por padrão, `--aplicar` grava com backup `.bak-locale-v2-<data-hora>`, desfaz sozinho se `node --check`/`bash -n` falhar, âncoras exatas — **não** copia o `setup.js` do repo, porque o do app tem trechos próprios como o `iproxy -u <udid>`).

**Testes (07/11):** `locale-helper.test.cjs` (4 blocos) OK; `setup.test.cjs`, `botao.test.cjs`, `botao-servico.test.cjs` OK; `node --check setup.js` e `bash -n nova-locale.sh` OK. Ensaio do deploy em **cópia** dos arquivos do app: 3 hunks, diff só com o handshake, idempotente, âncora ausente recusa sem alterar nada, suite de testes passa contra a cópia patchada.

**Como aplicar no app instalado (NÃO feito — exige OK do usuário):** `node MAC/integracao-iphone/conexao-usb/aplicar-locale-v2.cjs` (simulação) e depois `... --aplicar`; fechar e abrir o Nova; Conectar uma vez (senha do iPhone). Como o primeiro start da v2 faz `trim_logs`, o `nova-locale.err` de 571 MB é zerado aí.

**Ficou sem testar / limites:** o Conectar real com o handshake (precisa da senha do usuário); `apply`/`revert` no aparelho (mexem no fuso e fazem respring); o `trim_logs` no aparelho (só no sandbox do Mac). **Achados fora do escopo:** (a) `/var/tmp` tem sticky bit, então o `rm -f /var/tmp/nova-locale-status.json` que o app faz como `mobile` falha em silêncio e `iosWaitLocaleStatus` pode ler status velho; (b) `revert` não restaura o fuso: `/var/mobile/.nova-locale-state` (criado em 04/11 sob PATH mínimo) tem `tz=` vazio e `nova-globalprefs-original.plist` não existe; (c) o `setup.js` do repo segue sem o `iproxy -u <udid>` do app instalado.

## Seletor de modelo no app (IPCs spoofer:*) + novaproxy release no Conectar — 06/11/2026

Com o OK do usuário: (1) IPCs do seletor implementados no app instalado (`main.js`: `spoofer:get-ios-models/apply-ios-model/clear-ios-model/get-ios-model`; `physicalMobileService.js` ganhou `getIosModels/applyIOSModel/clearIOSModel/getIOSModel` + `require('./ios-modelo')`; `ios-modelo.js` e `iosModels.json` copiados para `electron/services/` — fonte: `MAC/integracao-iphone/`, mesma implementação das branches do seletor). Backups: `main.js.bak-*`, `physicalMobileService.js.bak-*`; `node --check` OK. (2) `novaproxy.deb` do app e de `conexao-usb/` trocado pelo release 0.1 (14666 bytes, sha256 969ff5c4…; debug em `.bak-debug-*`). Depois de reiniciar o Nova e Conectar (senha uma vez): novaproxy instalado, nova-locale re-aplicado (PATH) e o seletor de modelo funciona pelo app. Branch `agent/ios/idioma-novaproxy-conectar-20261106`, sem merge/push.

## novaproxy em versão release (sem +debug) — 06/11/2026

Gerado o build release do `novaproxy` (antes só existiam builds `+debug`).

- **Build:** `THEOS=$HOME/theos PATH=$HOME/theos/bin:$PATH make package FINALPACKAGE=1 DEBUG=0` em `MAC/proxy-iphone/tool/` (o Makefile fica lá). `make clean` antes para garantir objeto de release.
- **Pacote:** `MAC/proxy-iphone/tool/packages/com.aquiles.novaproxy_0.1_iphoneos-arm64.deb` — sem `+debug` no nome, `Version: 0.1` no control (o control declara `Version: 0.1`; os `0.1-2..0.1-9+debug` eram o contador de build do theos em modo debug).
- **rootless/arm64 confirmado:** `Architecture: iphoneos-arm64`, binário `Mach-O 64-bit arm64` (não-fat), caminhos instalados em `/var/jb/usr/bin/novaproxy` e `/var/jb/Library/LaunchDaemons/com.aquiles.novaproxy.plist`.
- **sha256:** `969ff5c4c485f5a8f6dcd8b405529bbfceb7b073c9b2eac6cc4c87431fd996b9`.

**O que o app espera (lido no app instalado):**
- Detecta instalado via `/var/jb/usr/bin/dpkg-query -W -f='${Version}' com.aquiles.novaproxy` (qualquer versão retornada = instalado; **não há versão mínima**).
- Instala com `sudo -S -p '' /var/jb/usr/bin/dpkg -i /var/mobile/novaproxy.deb` (senha do modal).
- Espera o arquivo **renomeado** como `novaproxy.deb` em `electron/services/iphone-setup/` (junto do `camera.deb`), não o nome com versão.
- Executa `/var/jb/usr/bin/novaproxy proxy set|clear|status|check` via SSH.

**Pendente (não feito — exige OK do usuário):** o app instalado e o `MAC/integracao-iphone/conexao-usb/novaproxy.deb` ainda contêm o debug `0.1-9+debug` (20834 bytes). Para fechar, copiar o `.deb` release para esses dois lugares com o nome `novaproxy.deb`. **Não copiei nada para o app.**

**Comando de instalação no iPhone (para o iOS Engineer, com OK do usuário):**
```
scp com.aquiles.novaproxy_0.1_iphoneos-arm64.deb mobile@127.0.0.1:/var/mobile/novaproxy.deb
sudo -S -p '' /var/jb/usr/bin/dpkg -i /var/mobile/novaproxy.deb
```

## Conectar: corrige idioma UNDEFINED e instala novaproxy — 06/11/2026

Sintomas no PHONE CONTROL: "IDIOMA UNDEFINED" e "Falha: O novaproxy ainda não está instalado".

1. **Idioma:** o `nova-locale.sh` girava em erro `sleep: command not found` (launchd roda com PATH mínimo). Fix: `export PATH=/var/jb/usr/bin:/var/jb/bin:/usr/bin:/bin:/usr/sbin:/sbin` no topo do script. O Conectar agora **re-envia e reinicia o helper em toda conexão** (não só quando ausente), então o próximo Conectar aplica o script corrigido no aparelho.
2. **novaproxy:** o binário `/var/jb/usr/bin/novaproxy` não existia no aparelho (o reset apagou e o fluxo não instalava). O Conectar agora instala `com.aquiles.novaproxy` (deb `0.1-9+debug`, único build existente) com a senha do modal, igual ao novamodel/nova-locale.

Arquivos: `conexao-usb/setup.js` (blocos novos), `nova-locale.sh` (PATH) no helper canônico e na cópia do app; `novaproxy.deb` junto do setup (gitignored). App instalado atualizado com backups. Branch `agent/ios/idioma-novaproxy-conectar-20261106`, sem merge/push.

## Conectar instala novamodel + nova-locale com a senha já digitada — 06/11/2026

O usuário pediu que a senha digitada no Conectar seja usada para instalar o que falta (modelo e GPS/fuso), sem digitar senha de novo. O `conexao-usb/setup.js` agora, no mesmo fluxo do Conectar (com a senha do modal):
- **novamodel**: se o `.deb` existir ao lado do setup e o pacote não estiver instalado, sobe por sftp e instala via `sudo -S` + senha; se já instalado, só informa a versão.
- **nova-locale**: confere os arquivos do helper (`/var/jb/usr/libexec/nova-locale.sh` + `com.aquiles.novalocale.plist`); se faltar, sobe os arquivos (`nova-locale.sh` e `com.aquiles.novalocale.plist` agora vão junto do app), move com `sudo -S`, ajusta permissões e carrega o daemon com `launchctl bootstrap` (fallback `kickstart`).
- A senha continua sem ser salva (é zerada no `finally`); cada comando `sudo` recebe a senha só pelo stdin daquela execução.

App instalado: `setup.js` corrigido com backup (`setup.js.bak-20261106-*`) e `novamodel.deb`/`nova-locale.sh`/plist copiados para `electron/services/iphone-setup/`. Para instalar no aparelho, o usuário toca **Conectar** mais uma vez e digita a senha — o resto é automático. Branch `agent/ios/novamodel-locale-conectar-20261106`, sem merge e sem push.

## Fase A — merge do seletor de modelo + pacotes release — 06/11/2026

Merge na `main` (de `530920e`) das três branches do seletor de modelo do iPhone, em sequência: `agent/jailbreak/modelo-iphone-20261105` → `agent/ios/modelo-iphone-20261105` → `agent/frontend/modelo-iphone-20261105` (merge octopus falharia no `MAC/LEIA-ME.md`). Conflito resolvido mantendo as três seções no topo (tweak+CLI, serviço+IPC, seletor da UI). Commits de merge: `93c63a5`, `b9d3116`, `b5c3522` (não enviados — push pendente de autorização).

**Testes após o merge:** `integracao-modelo/test/teste-novamodel.cjs` (5 ok), `integracao-modelo-app/novamodel.test.cjs` (30 verificações), `conexao-usb/setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` passando. `integracao-sequestro-cam/controles-independentes.test.cjs` **falha pré-existente** (já falhava em `530920e`): o teste fixa a ponte em `0.1-38` e espera o fluxo de injeção anterior à bridge 0.1-39; não foi alterado nesta fase — precisa de decisão separada.

**Pacotes release (theos, `FINALPACKAGE=1 DEBUG=0`):**
- Tweak `com.aquiles.novamodel_0.1_iphoneos-arm64.deb` (rootless arm64, `Version: 0.1`) em `integracao-modelo/packages/`.
- Bridge `com.aquiles.obsgraph-bridge_0.1-39_iphoneos-arm64.deb` (`Version: 0.1-39`) em `integracao-iphone/bridge/packages/`, copiado como `camera.deb` para `conexao-usb/` (repo) e `electron/services/iphone-setup/` (app). Ambos fora do git (`*.deb` ignorado).

**setup.js:** backport do app instalado para o repo (`ensureTunnel()`, listeners de erro do ssh2 com `on`+guarda `settled`, `launchctl kickstart mediaserverd` após instalar a ponte). `TARGET` ajustado de `0.1-39-1+debug` para `0.1-39` para casar com o pacote release (o mesmo ajuste foi aplicado no `setup.js` do app instalado). O bloco de instalação do `novamodel.deb` já está no repo, mas ainda **não** no app instalado (pendente da Fase C; exige colocar `novamodel.deb` em `electron/services/iphone-setup/`).

**Bundle:** `conexao-usb/dist/index-Dun7lr2S.patched.js` reaplicado no app (`dist/assets/index-Dun7lr2S.js`), levando o seletor de modelo (IPC `spoofer:get-ios-models`).

**DMG:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-06.dmg`, gerado do app instalado com `CFBundleVersion=20261106.1` e `LSMinimumSystemVersion=26.0`.

```
sha256  4bf34a8c0210dc81ba933ed45471e5febe814e63cc8836a2917c412722ded685
```

Assinatura ad hoc, sem Developer ID nem notarização. Estado registrado: `spctl --assess` no app dentro do DMG → `invalid Info.plist (plist or signature have been modified)`; no app instalado → `a sealed resource is missing or invalid`. Uso em outro Mac: abrir com Ctrl+clique → Abrir.

## Spoofing de modelo do iPhone (tweak + CLI) — 05/11/2026

Criado o pacote `com.aquiles.novamodel` (rootless) para o iPhone reportar outro modelo (ex. "iPhone 13" → `iPhone14,5`), a contraparte iOS do spoofing de identidade que hoje só existe em Android. Só modelo — sem IMEI/serial.

- **Tweak `NovaModel.dylib`** (Substrate, carrega em todo processo): hooka `MGCopyAnswer`/`MGCopyAnswerWithError`/`MGGetStringAnswer` (whitelist fechado: `ProductType`, `HWModelStr`, `ModelNumber`, `ProductName`, `MarketingProductName`), `sysctlbyname`/`sysctl` (`hw.machine`, `hw.product`) e `UIDevice` (`model`, `localizedModel`, `modelName`/`_modelName` privados). Lê `/var/tmp/nova-model-control.json` com cache por mtime (aplicação instantânea).
- **CLI `/var/jb/usr/bin/novamodel`** (setuid root): `set <productType>` (valida no banco e grava o control file), `clear`, `status` (JSON `real`/`active`/`enabled`). Roda sem o tweak, então `status` lê o ProductType real.
- **Banco de modelos** `models.json` (27 modelos: iPhone 8 → 15), instalado em `/var/jb/usr/share/novamodel/models.json`.

Arquivos: `integracao-modelo/` (Tweak.x, main.m, models.json, Makefile, layout, test). Compila no theos e gera `.deb` rootless arm64 (`packages/com.aquiles.novamodel_0.1-*.deb`). Teste automatizado `test/teste-novamodel.cjs` valida banco, contrato do control file e whitelist MG. **Sem testar no aparelho real** (efeito em Ajustes/Sobre e apps, `dpkg -i`, setuid); `HWModelStr`/`ModelNumber` estão no whitelist mas não são spoofados na v1 (códigos de placa/número de modelo são por variante/região).

## Spoofing de modelo do iPhone — serviço + IPC + instalação do .deb — 05/11/2026

Integração no app para o tweak `com.aquiles.novamodel` (spec `NOVA-AI-MODELO-SPOOF-SPEC.md`). No `physicalMobileService` entraram `getIosModels()`, `applyIOSModel(deviceId, productType)`, `clearIOSModel(deviceId)` e `getIOSModel(deviceId)` — chamam `/var/jb/usr/bin/novamodel` via `iosSsh` (túnel USB). IPCs novos em `main.js`: `spoofer:get-ios-models`/`spoofer:apply-ios-model`/`spoofer:clear-ios-model`/`spoofer:get-ios-model` (nomes do contrato da UI). Banco de modelos em `iosModels.json`; instalação do `novamodel.deb` pelo fluxo Conectar (guarded: só quando o `.deb` existir ao lado do `camera.deb`).

- Arquivos: `integracao-iphone/ios-modelo.js` (novo), `integracao-iphone/iosModels.json` (novo), `integracao-iphone/physicalMobileService.patched.js`, `integracao-iphone/conexao-usb/setup.js`, `integracao-modelo-app/main.modelo.js`, `integracao-modelo-app/novamodel.test.cjs`, `integracao-modelo-app/README.md`.
- Testado: `node --check` nos arquivos tocados + `novamodel.test.cjs` (30 verificações com mock de SSH).
- Sem testar: instalação e execução real do CLI (o `.deb` do Jailbreak Specialist ainda não existe) e o IPC no Electron (só sintaxe + mock). Detalhes: `MAC/integracao-modelo-app/README.md`.

## Seletor de modelo do iPhone no painel "Identidade simulada" — 05/11/2026

Spoofing de modelo do iPhone na UI: no painel **Identidade simulada** (janela "Controle do Celular"), o seletor de modelo do iPhone agora é alimentado pelo banco de modelos iOS e tem botões **Aplicar modelo** e **Limpar modelo**.

- **Seletor:** populado dinamicamente via `spoofer:get-ios-models` (27 modelos do banco do serviço, `{productType, name}`); o bundle não tem mais lista fixa. Ex.: iPhone 13 = `iPhone14,5`.
- **Contrato de IPC (bundle → main):** `spoofer:get-ios-models` (sem args → `{success, models[]}`), `spoofer:apply-ios-model {deviceId, productType}` (aplica), `spoofer:clear-ios-model {deviceId}` (restaura o real) e `spoofer:get-ios-model {deviceId}` (lê `{real, active, enabled}`). Os handlers no `main.js`/`physicalMobileService` são do iOS Engineer; o bundle já chama esses canais. Se o IPC ainda não existir, o seletor mostra a falha no painel (estado "error").
- **Estados:** `applying` (spinner), `applied` (verde, "Modelo aplicado no iPhone"), `idle` (modelo real) e `error` (vermelho). Ao abrir a aba, `spoofer:get-ios-model` lê o estado atual.
- **Texto pt-BR**; nomes de modelo (dados de spoofing) não traduzidos.

Arquivos: `MAC/integracao-iphone/conexao-usb/dist/index-Dun7lr2S.patched.js` (patch no bundle). Reaplicado `aplicar-botao-iphone.py` (idempotente) e `node --check` OK.

Sem testar: execução real no app (bundle patcheado ainda não copiado para `/Applications/Nova AI Mac.app`) e o fluxo Aplicar/Limpar contra o tweak `novamodel` no iPhone (depende do iOS Engineer expor os IPCs e do Jailbreak Specialist instalar o `.deb`).

## Chave SSH do iPhone agora é do app — 04/11/2026

A chave usada para falar com o iPhone saiu de `~/.ssh/id_iphone` e passou para `~/Library/Application Support/nova_dsktp/iphone-ssh/` (modo 0600), junto com o `known_hosts` do aparelho. Todos os `ssh`/`scp` do app usam `-i` explícito, `IdentitiesOnly=yes` e `UserKnownHostsFile=` desse diretório, então não caem mais nas outras chaves do agente SSH do Mac.

- `services/iphone-ssh.js` é o único lugar que conhece o caminho; `setup.js`, `physicalMobileService.js`, `ios-camera.js`, `cam-live-iphone.js` e `ios-bridge.js` passaram a usar `sshOptions()`.
- Migração automática no boot (`migrateLegacy()`): se existir `~/.ssh/id_iphone` e ainda não houver a do app, ela é **movida** (não copiada) e a linha `[127.0.0.1]:2222` do `known_hosts` é herdada. É a mesma chave, o iPhone continua autorizando — não precisa refazer o Conectar.
- Em teste (`NOVA_SMOKE_TEST=1`) a migração não roda; `NOVA_USER_DATA` isola os caminhos.
- Não é isolamento criptográfico: qualquer processo do mesmo usuário do macOS ainda lê o arquivo (0600). O ganho é sair do `~/.ssh` (fora de dotfiles, backups e outras ferramentas) e ter par chave/known_hosts só do app.

Verificação: migração simulada com `HOME` falso moveu a chave com 0600, herdou o known_hosts e gerou as opções certas; 15 testes do CAM LIVE + `setup.test.cjs` + `botao-servico.test.cjs` passando. **Reinicie o Nova** para a migração acontecer. No repo, `integracao-camlive/`, `integracao-sequestro-cam/` e `encerramento-nova/` têm um shim `iphone-ssh.js` porque neles os arquivos não ficam lado a lado como em `electron/services/`.

## Cartão do iPhone: "Abrir controle" reaplicado — 04/11/2026

O bundle em uso (`dist/assets/index-Dun7lr2S.js`) estava **sem** o patch do botão do iPhone: o cartão de um aparelho já preparado mostrava **PARAR TRANSMISSÃO** (vermelho) em vez de **Abrir controle**, o que dá a impressão de transmissão ativa mesmo com o aparelho parado — o `streaming` do iOS é o registro de pareamento (`iphone-hosts.json`), não uma transmissão real. Outro patch de bundle aplicado depois (controle de celular/geo-proxy) sobrescreveu o trecho.

Reaplicado `conexao-usb/aplicar-botao-iphone.py` no app instalado: iPhone preparado agora mostra **Abrir controle** (ciano) e abre o console direto; Android continua com **Parar transmissão**. A lista de dispositivos já se atualiza sozinha a cada 5 s (o painel faz `setInterval` de `physical-mobile:get-status`), então desplugado deixa de aparecer. Cópia canônica do bundle em `conexao-usb/dist/index-Dun7lr2S.patched.js`; anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/index-Dun7lr2S.antes-botao.js`.

**Regra nova no `AGENTS.md`:** qualquer patch futuro no bundle precisa reaplicar este script (é idempotente) antes de copiar para o app, senão o botão volta a regredir. Recarregue com **Cmd+R** ou reinicie o Nova.

## Transporte camuflado Mac → iPhone (bridge 0.1-39) — 04/11/2026

O que a Câmera do iPhone consome deixou de ser `http://127.0.0.1:18999/frame.jpg`.

- O servidor do Mac (CAM LIVE e CAM HIJACK) só responde em `/s/<token de 32 hex>/frame.jpg` e `/s/<token>/audio`; sem o token a resposta é 404 neutro. O token é novo a cada sessão.
- O túnel SSH tenta primeiro um **socket Unix** em `/var/tmp/.nb-<8hex>.sock` (modo 666 para o mediaserverd). Nenhuma porta TCP fica escutando no iPhone. Se o sshd do aparelho recusar streamlocal, cai para uma **porta TCP aleatória** (20000–39999) com o mesmo token; o `-v` do ssh foi removido.
- O bridge 0.1-39 valida o caminho com token, aceita `socket` no control, recusa a rota antiga e **removeu o IP fixo `10.0.0.245:8900`** que vinha do projeto original.
- O sequestro (item 3) passou a pedir o endereço ao CAM LIVE (`mediaEndpoint()`): CAM LIVE, CAM HIJACK e sequestro compartilham o mesmo token/transporte em vez de repetir 18999.

Compatibilidade: pontes 0.1-38 e anteriores são recusadas ("atualize por USB") porque não conhecem o token. Atualize pelo **Conectar** em PHONE CONTROL — o `camera.deb` 0.1-39 já está incluído no app.

Arquivos: `integracao-iphone/bridge/Tweak.x` (0.1-39), `integracao-camlive/cam-live-iphone.js`, `integracao-iphone/ios-camera.js` (= `integracao-sequestro-cam/ios-camera.patched.js`), `conexao-usb/setup.js` (alvo 0.1-39) e `conexao-usb/camera.deb`. Reservas do instalado anterior em `integracao-camlive/reservas/instalado-antes-camuflagem-20261104/`. Testes: 15 passam (`node --test` em `integracao-camlive/test/`), incluindo token/404, socket Unix, fallback TCP e sequestro. **Não testado no aparelho**: se o sshd do iPhone aceita `-R` com socket Unix e se o mediaserverd (sandbox) consegue conectar; se recusar, o fallback TCP entra sozinho. Reinicie o Nova e refaça o Conectar para instalar a 0.1-39.

## Conexão do iPhone dentro do app — 04/11/2026

O **Conectar** dos iPhones em PHONE CONTROL deixou de abrir uma janela/página externa para a senha SSH. Agora o formulário, o progresso e o controle do iPhone são desenhados **dentro da janela do Nova**, como um modal do próprio app: fundo escurecido e embaçado, mesmo visual do Controle do Celular, X/Esc para fechar (bloqueado durante a preparação) e tempo decorrido.

A senha continua só em memória: o campo é limpo antes do envio ao processo principal, a senha não entra em log nem em mensagem de erro. O modal roda no preload (`inapp.js`), fora do bundle React — não depende do `index-Dun7lr2S.js`. Depois do sucesso, "Abrir controle e tela do iPhone" carrega o iPhone Console num `<webview>` dentro do app, com "Abrir em janela" como alternativa.

Depois de conectar, o cartão do iPhone não fica mais em **Conectar**: passa a **Abrir controle**, que abre o console dentro do app sem senha. O estado vem do registro `iphone-hosts.json` gravado por um Conectar bem-sucedido; Android segue com "Parar transmissão" e o botão **Refazer conexão** fica no topo do controle.

Arquivos: `integracao-iphone/conexao-usb/` (`inapp.js`, `setup.js`, `aplicar-botao-iphone.py`, `botao.test.cjs`, `botao-servico.test.cjs`, `setup.test.cjs`, `test/modal/`, `dist/index-Dun7lr2S.patched.js`, `docs/`), com os arquivos da janela antiga em `integracao-iphone/reservas/modal-externo-20261104/` e o estado anterior desta rodada em `integracao-iphone/reservas/botao-conectado-20261104/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: `node --check` nos quatro arquivos; testes do serviço (senha inválida, aparelho único, janela ausente); harness em Electron com o **preload real** abrindo o modal por IPC, enviando a senha e confirmando o campo vazio; estados idle/preparando/sucesso/erro e o webview do console renderizados sem exceção. **Conexão real no aparelho não refeita** (exige a senha do iPhone) e **reiniciar o Nova** para carregar.

## Foto ➔ Vídeo (Kling) acessível e corrigido — 03/11/2026

A função de animar foto em vídeo (Capítulo 3 do guia) existia no código, mas estava **sem botão de acesso** nesta versão: a seção "kling" da Suíte de Vídeo só abria por um evento interno (`nova-open-kling-video`) que nada disparava. Foram corrigidos 7 problemas no fluxo:

1. **Botão novo** "Foto ➔ Vídeo" na barra da Suíte e Estúdio de Vídeo (AI UPLOAD), entre "Criador de IA" e "Recortador Seguro" — abre a seção de selecionar foto → movimento → proporção/duração → converter.
2. **FFmpeg do Mac**: o serviço só procurava `ffmpeg.exe` (Windows); agora acha o `Resources/bin/ffmpeg` do macOS. Sem isso, o motor gratuito offline sempre falhava.
3. **Pasta de saída errada**: o vídeo era salvo em `cwd/youtube_auto/exports` (caía no Downloads) enquanto a biblioteca "Arquivos Exportados" lê `app/youtube_auto/exports` — o vídeo nunca apareceria na lista. Agora salva na pasta certa.
4. **Tamanho real do arquivo** na biblioteca (era fixo 5 MB).
5. **WebP** enviado com mime correto para a Kling Cloud.
6. **Tradução**: 12 textos em inglês esquecidos no fluxo ("Clear Picture", "Converting Picture into Video...", mensagens de status, "Library (n)" etc.).
7. **Assinatura** ad-hoc refeita após o patch (`codesign --verify` OK).
8. **Prévia do vídeo cinza (0:00)**: as URLs `file:///` eram montadas com padrão de Windows (`file:///` + caminho absoluto Unix = 4 barras), e o Chromium não achava o arquivo — o vídeo era gerado certo, mas o player ficava escuro. Corrigido para o player "✨ Vídeo Gerado Pronto" e para a prévia da foto escolhida via "Procurar Arquivos". O botão "Salvar Vídeo" e sua mensagem também foram traduzidos ("Save to Phone Storage" etc.).
9. **Vídeo saía parado (foto imóvel)**: o motor local usava `zoompan` com estado acumulado (`zoom+0.0012`) e `-loop 1`, combinação que congelava o efeito com certas fotos de entrada (verificado num caso real: 10 s de imagem imóvel, PSNR 61 entre quadros distantes). Reescrito com expressões puras em função do número do quadro (`on`), sem `-loop`, na receita canônica do FFmpeg para Ken Burns — o movimento agora vai do primeiro ao último quadro em todos os 5 presets. Teste `test/teste-movimento.cjs`: 20 combinações (5 presets × jpg/png/webp em vários tamanhos), todas com movimento medido (PSNR 6–13 entre 1 s e 8 s).
10. **"Salvar Vídeo" baixava HTML quebrado**: o botão usava download por âncora de URL `file://`, que o Chromium bloqueia — salvava uma página de erro de 15 KB com nome .mp4 (por isso "não pode ser aberto" no Mac). Novo IPC `kling:save-video` no `main.js` copia o arquivo real para o Downloads (sem sobrescrever: acrescenta -2, -3…), abre o Finder no arquivo e o botão usa esse IPC com fallback. As 3 cópias quebradas no Downloads do usuário foram substituídas pelos vídeos reais. Original do `main.js` antes deste patch em `reservas/instalado-antes-kling-2026-11-03-main.js`.
11. **IA do Sistema (Veo) no Foto ➔ Vídeo**: o app tinha chave Gemini configurada (`secret_key.json`, lida por `app.getGeminiToken()` — a mesma do Nova Studio), mas nenhum caminho de geração de vídeo. Adicionado o motor "IA do Sistema" no `kling-video-service.js` (`_generateSystemAIVideo`) com **auto-descoberta**: consulta `ListModels` (gratuito) e usa os modelos Veo que a chave tiver. **Testado com a chave atual: a API listou 60 modelos e nenhum é Veo** — ou seja, a chave do Nova não tem acesso a vídeo (Veo via API exige faturamento Google). O caminho fica pronto para o dia em que o faturamento for ativado.
12. **Motor fal.ai no Foto ➔ Vídeo (botão verde)**: como a chave do Nova não faz vídeo, o botão "Converter com IA fal.ai" usa a chave **fal-key do Chaveiro do Mac** (a mesma do projeto criar-videos, lida com `security find-generic-password`). Fila `queue.fal.run`, imagem em data URI, modelo mais barato primeiro (`fal-ai/bytedance/seedance/v1/lite/image-to-video`, fallbacks Wan 2.2 e Kling 2.1), 720p, duração 5/10 s, espera com progresso e download para `exports`. **Custa por vídeo na conta fal.ai** — confirmar antes de gerar. Reinicie o Nova para carregar.

Arquivos: `integracao-kling/` (fontes patcheadas + `reservas/` com os originais de antes + `test/teste-motor-local.cjs`). Teste de ponta a ponta do motor local passou no app instalado: imagem de teste → MP4 720×1280 válido em `app/youtube_auto/exports`, com progresso e limpeza automáticos. **Reinicie o Nova para carregar.** Sem chave da API Kling, usa o Nova Motion Engine local (grátis, Ken Burns por FFmpeg); com chave, envia para `api.klingai.com` (kling-v1) — a autenticação Bearer da Kling pode exigir JWT próprio dela, não validado (não há conta para testar). O DMG não foi regenerado.

## CAM LIVE direto para o iPhone por USB — 03/11/2026

O CAM LIVE agora transmite **sem OBS, MediaMTX nem servidor RTMP**. O destino padrão é "iPhone por USB — automático" (formato celular 720×1280): o renderer envia JPEG (`camlive:frame`) e PCM das cenas (`camlive:pcm`); o processo principal (`cam-live-iphone.js`) serve `/frame.jpg` e `/audio` em loopback, abre o túnel SSH reverso para a porta 18999 do iPhone, codifica o áudio em AAC-LC 44,1 kHz com o FFmpeg incluído e só ativa a câmera depois de haver imagem **e** áudio. RTMP continua em Configurações → Avançado. Não há IP, porta ou chave para digitar.

Pré-requisito: iPhone conectado por **Conectar** (PHONE CONTROL) — exatamente um iPhone, ponte 0.1-38 com hooks de foto prontos. O pacote 0.1-38 agora acompanha o Nova (`conexao-usb/camera.deb`) e é instalado/atualizado por Conectar no iPhone10,2 / iOS 16.7.16. Um `enabled:true` antigo na ponte com lease expirado já não bloqueia o início.

Arquivos: `integracao-camlive/` (cam-live.js, cam-live-audio.js, cam-live-service.js, cam-live-iphone.js); aplicado no app instalado, com cópia do `main.js` anterior em `integracao-camlive/reservas/instalado-antes-usb-*`. Testes: `test/iphone-*.cjs` (14 testes passam) e `test/harness-usb.js` (iPhone simulado: ~16 fps de JPEG válidos e PCM em tempo real chegaram; parar interrompe os dois). FFmpeg incluído gerou ADTS aceito pelo parser.

**Não testado:** transmissão real até a Câmera do iPhone (a imagem aparecer no app Câmera), aparelhos além do iPhone 8 Plus, e o DMG não foi regenerado — o instalador final ainda não contém esta mudança. Reinicie o Nova para carregar. Windows fica para depois.

## Pacote Mac portátil de 03/11/2026

**Arquivo para compartilhar:** `distribuicao/Nova-AI-Mac-AppleSilicon-2026-11-03-final.dmg`. Use a versão `-final`; a primeira imagem foi uma tentativa intermediária e foi preservada. A cópia final do app passou na verificação de assinatura local `codesign --verify --deep --strict`.

Destino inicial: Mac Apple Silicon com macOS 26+. Windows fica para uma etapa posterior. O requisito macOS 26 vem dos binários efetivamente incluídos, não do Electron: auditoria de 227 arquivos Mach-O encontrou requisito máximo 26.0 e nenhuma dependência carregada de Homebrew, `/usr/local` ou `/Users`.

Python/PortAudio e bibliotecas foram incluídos em `python-runtime-portable/`, Chromium em `browsers/`, e os serviços passaram a usar o Python interno. Validados importação de módulos de áudio/rede/compressão/SQLite, HTTPS com certificados incluídos e lançamento do navegador interno. O Python também executou na cópia em outra pasta. O pacote exclui o venv antigo e a tentativa incompleta de runtime; nenhuma dessas cópias originais foi apagada.

O Nova abriu com perfil vazio e PATH mínimo (`SMOKE_EXIT 0`), com interface React carregada e API Electron disponível. Evidências em `distribuicao/teste-perfil-vazio-1793726904588/` e `distribuicao/verificacao-binarios.json`. Isso não substitui teste em outro Mac limpo. Não há validação de todas as funcionalidades, nem adaptação da ponte 0.1-38. Upload automático do YouTube continua sem pipeline. Serviços online continuam dependendo de internet e contas próprias.

Scripts de reprodução e auditoria em `integracao-iphone/distribuicao/`. Os dados pessoais de Application Support, perfis de navegador e chaves SSH não são copiados para a distribuição. A assinatura é local, sem notarização Apple.

## Portabilidade — revisão inicial de 03/11/2026 (histórico)

As ferramentas USB iPhone (`iproxy`, `idevice_id`, `ideviceinfo`, `ideviceinstaller`) e nove bibliotecas agora estão em `Contents/Resources/ios-tools/`. Os serviços iPhone passaram a resolver apenas esses executáveis incluídos no app. Teste: todas as quatro ferramentas iniciam com `PATH=/usr/bin:/bin`; nenhum dos 13 arquivos Mach-O possui dependência absoluta de Homebrew. Licenças locais foram copiadas para `ios-tools/licenses/`. Script de reprodução: `integracao-iphone/distribuicao/empacotar-ferramentas.py`.

**Na revisão inicial, a distribuição ainda não estava pronta.** O Python incluído era um venv com `home` e executável de origem no Homebrew; precisa de um runtime portátil para funções Python. O instalador DMG/ZIP existente continua antigo. Falta testar em outro Mac sem ferramentas de desenvolvimento. Esta alteração não atualiza o EXE Windows. O iPhone ainda precisa ter jailbreak ativo e OpenSSH, e CatVNC tem configuração própria. Contas e credenciais devem ser configuradas por cada usuário, sem copiar dados de `Application Support` ou chaves SSH pessoais.

## Conexão iPhone por senha SSH — 03/11/2026

O botão dos iPhones em DEVICES agora mostra **Conectar** e abre uma janela para a senha SSH do usuário `mobile`. O fluxo exige jailbreak ativo e OpenSSH já instalado no iPhone. A senha fica apenas em memória durante a operação. O app prepara uma chave SSH, verifica o acesso e oferece abrir o console. Exige somente um iPhone conectado; não faz jailbreak automaticamente.

O pacote OBSGraphBridge 0.1-30 está incluído no app e pode ser instalado sem download externo no iPhone10,2 com iOS 16.7.16. Outras versões já instaladas são preservadas. Não há instalação automática do CatVNC nem suporte universal às funções Android: o fluxo informa essas limitações. CatVNC ainda exige instalação e configuração próprias.

Fontes e testes: `integracao-iphone/conexao-usb/`. Aplicado no app instalado, sem atualizar o DMG. Verificação: sintaxe do main, bundle em modo módulo, serviço, carregamento do SSH e testes de limites IPC/múltiplos aparelhos. **Conexão e instalação reais no aparelho ainda não testadas neste fluxo.** Reinicie o Nova para carregar as alterações.


## Tradução para pt-BR de 03/11/2026

O app instalado (`/Applications/Nova AI Mac.app`) foi traduzido inteiro para português do Brasil — só texto de interface, sem tocar em nenhuma função. Traduzidos: bundle da interface (`dist/assets/index-Dun7lr2S.js`, ~1.900 substituições), `dist/index.html`, PWA (`electron/pwa/`: index, admin, app.js, manifest), menus/diálogos do `electron/main.js`, mensagens visíveis dos services e a extensão nova-grab. **Reinicie o app para ver a tradução.** Cópia de todos os arquivos originais está em `../backup-antes-traducao/`. Nomes de hardware (Apple M1, Galaxy, GPUs — são valores de spoofing), modelos de IA e termos técnicos (Stop Loss, SKU, ADB) foram mantidos de propósito.

## Atualização local de 02/11/2026 — CAM HIJACK iPhone

O app instalado recebeu encaminhamento iOS para CAM HIJACK, correção do caminho do APK Android e textos de preparação por plataforma. Fontes, testes, reservas e o instalador iOS estão em `integracao-iphone/`.

**Pendente:** executar `integracao-iphone/instalar-iphone.command` no Terminal (sudo do iPhone) e validar a imagem na Câmera. O pacote nativo compilado é OBSGraphBridge 0.1-30 com suporte ao túnel USB em localhost:18999. O fluxo ativa a prévia nativa experimental; fotos/vídeos gravados e outros apps não estão validados nem habilitados nesta integração.

**O DMG abaixo é anterior a esta atualização e já não é idêntico ao app instalado.**

**Instalador anterior:** `Nova-AI-Mac-sem-ativacao.dmg` (1/11/2026, 789 MB) — é idêntico ao app **já instalado em `/Applications/Nova AI Mac.app`**, que é o que você usa no dia a dia. O `.zip` é o mesmo app em formato zip (backup).

## O que já foi feito ✅

### Port e base
- Port do instalador Windows (Electron) para macOS arm64, módulos nativos recompilados (SQLite, RobotJS).
- Ferramentas nativas embutidas: FFmpeg, ADB, scrcpy, cloudflared, yt-dlp.
- **Ativação removida**: sem tela de chave, sem formulário, sem consulta ao servidor de licença do fornecedor. Abre direto no painel.
- Instalado em `/Applications` (não precisa mais rodar do DMG).

### Segurança (endurecimento)
- **Túnel público do Cloudflare desligado por padrão** (só liga com `NOVA_REMOTE_TUNNEL=1` no terminal).
- **Todos os servidores internos escutam só em 127.0.0.1** (interface, WebSocket, RTMP) — nada exposto pra rede Wi-Fi ou internet.
- Correção crítica: o servidor RTMP interno não derruba mais o app quando a porta está ocupada.

### Recursos ativos
- **RTMP do Nova: porta 11935** (1935 é do MediaMTX). Para o Android via cabo nada muda (`adb reverse` entrega a 1935 dentro do celular). De outro computador: `rtmp://<ip-do-mac>:11935/live/nova`.
- **Wake word (ativação por voz): funcionando.** PortAudio + SpeechRecognition + sounddevice instalados no Python embutido. Precisa de internet (API de fala do Google) e permissão de microfone.
- **Mobile Cam Bridge**: câmera do celular alimentando o painel.
  - Android: página própria do app.
  - iPhone: Safari + túnel SSH por cabo (https://127.0.0.1:8899/pc-cam no celular) — nunca usa Wi-Fi.
- **PC → PHONE**: webcam do Mac aparecendo no celular (iPhone via túnel USB: https://127.0.0.1:8899/pc-cam).

### NOVO: iPhone integrado na aba PHONE CONTROL ✅
Com o iPhone 8 Plus **plugado no cabo** (jailbreak religado, OpenSSH ativo — a chave `~/.ssh/id_iphone` já está configurada):
- **DEVICES**: aparece como "iPhone 8 Plus (iOS 16.7.16)" na lista de aparelhos, igual um Android.
- **CONTROLS**: abre a janela **iPhone Console** dentro do sistema (sem navegador externo) — tela ao vivo controlável (clique = toque) via CatVNC + noVNC por cabo.
- **APPS**: listar apps instalados e abrir por nome — com tradução automática de pacotes Android→iOS (WhatsApp, Instagram, Chrome etc.).
- **BROWSER**: campo de URL abre o link no Safari do iPhone.
- **Screenshot**: salva imagem da tela (via canvas da tela ao vivo).
- Senha pedida na primeira conexão: a que você definiu em **Ajustes → CatVNC** (fica memorizada na página).
- Os túneis (iproxy 5900/2222) têm **auto-recuperação**: se caem, o app recria em segundos.

## O que ainda falta fazer ⏳

- **Fase 2 — SPOOFER / CAM HIJACK para iPhone**: vídeo do Mac virando a câmera NATIVA do iPhone, conectando o Nova ao seu tweak VCamMin (o equivalente do APK Android). É o último pedaço pra paridade total com o Android.
- **Toggles de Wi-Fi/Bluetooth** no CONTROLS para iPhone: respondem "não suportado por SSH" (Apple não expõe isso).
- **`youtube_auto/pipeline.py`**: o instalador original nem inclui esse arquivo — a automação de upload depende de reconstruí-lo.
- **Integrações que dependem das suas contas** (WhatsApp, Telegram, Google, chaves de IA): instaladas mas sem validação completa.
- **Câmera virtual completa, Antigravity, Stable Diffusion**: sem validação de fluxo completo.
- **Wake word com microfone real**: motor instalado e rodando; falta testar em uso com permissões do macOS.
- **Atualização automática**: não configurada (o feed do fornecedor é Windows-only).
- **Notarização Apple**: o app é assinado localmente (ad-hoc) — a primeira abertura sempre exige botão direito → Abrir.

## Arquivos desta pasta

| Arquivo | Papel |
|---|---|
| `Nova-AI-Mac-sem-ativacao.dmg` | **Instalador atual** (idêntico ao app instalado) |
| `Nova-AI-Mac-sem-ativacao.zip` | Mesmo app em zip (backup) — duplicado do DMG |
| `Nova-AI-Mac-Preview-com-ativacao.dmg` | Versão antiga com tela de ativação original (só se quiser usar a licença do fornecedor) |
| `LEIA-ME.md` | Este arquivo |

Gerado e mantido localmente. Não é distribuição oficial do fornecedor.

## 2026-11-15 — PR-A de paridade: o iPhone não derruba o Windows

- **O que mudou:** `ios-tools.js` ganhou `tryTool()`, `has()` e `available()` (não lançam; `tool()` segue igual). `getIosDevices()` devolve `[]` se as ferramentas do iPhone faltarem ou algo lançar, então `getStatus()` não rejeita e a lista Android continua. `ios-bridge.start()` devolve `{ ok: false }` sem ferramentas (sem `iproxy`, sem `UnhandledPromiseRejection`). O item "Console do iPhone" da bandeja só aparece quando as ferramentas existem; o IPC `ios-console-url` devolve o erro em vez de abrir página vazia.
- **Arquivos:** `app/electron/main.js`, `app/electron/services/ios-tools.js`, `ios-bridge.js`, `physicalMobileService.js`, `ios-devices.js` (novo: a listagem de aparelhos saiu de `physicalMobileService.js` para o arquivo grande não crescer); teste novo `MAC/integracao-iphone/tests/ferramenta-ausente.cjs` (`node --test`).
- **Mac:** com as ferramentas empacotadas, o comportamento é o mesmo. Só num Mac sem `ios-tools` o item da bandeja some.
- **Sem testar:** Mac, Windows e iPhone reais; `getStatus()` foi testado com o `getConnectedDevices` real e um `adb` falso que lista um aparelho Android.

## 2026-11-19 — M2 de paridade: "respondendo" real do Antigravity no Mac

- **O que mudou:** `getProcessStats()` no Mac deixou de devolver `responding:true` fixo. `macAntigravityStats()` (em `paridade-utils.js`) acha o PID com `pgrep -x Antigravity`, lê a memória com `ps -p <pid> -o rss=` e marca `responding:false` só quando o AppleScript do System Events estoura 3 s (processo morto por tempo). Outro erro do AppleScript (app aberto sem janela, falta de permissão de Automação) conta como respondendo, com título vazio. `cpu` continua `0` nos dois sistemas, como o PowerShell do Windows (`CPU:0`); ninguém lê esse valor. Sem processo, devolve `null` como o Windows.
- **Arquivos do app instalado no Mac que mudam:** `Contents/Resources/app/electron/services/antigravity-controller.js` e `Contents/Resources/app/electron/services/paridade-utils.js` (guardar os anteriores em `reservas/` antes; depois `node --check` e reiniciar o Nova). Nenhum arquivo do bundle da interface.
- **Teste:** `app/test/paridade-b.test.js` (`node --test`), com `pgrep`, `ps` e `osascript` falsos.
- **Sem testar:** Mac real com Antigravity instalado; o nome do processo `Antigravity` no `pgrep` (se não bater, trocar por `pgrep -f '/Antigravity\.app/Contents/MacOS/'`) e o limite de 3 s do AppleScript; Windows real.

## 2026-11-19 — P10: `cloudflared` no Windows também em `resources\bin\` e no PATH

- **O que mudou:** `remote-access.js` procura o `cloudflared` com `tool-paths.tool()` nos dois sistemas (antes: Mac por `mac-native.tool`, Windows só `resources\cloudflared.exe`). `resources\cloudflared.exe` segue como último recurso no Windows. Nada foi removido além do ramo `darwin` do ternário (1 linha trocada por 2).
- **Arquivos do app instalado no Mac que mudam:** `Contents/Resources/app/electron/services/remote-access.js` (guarde o anterior em `reservas/`; reaplicar com `cp`). Nenhum outro.
- **Mac:** mesma ordem de pastas (`resources/bin`, Homebrew, PATH); comportamento igual. O túnel segue desligado por padrão (`NOVA_REMOTE_TUNNEL=1`).
- **Teste:** `app/electron/services/testes/cloudflared-caminho.test.js` (`node --test`, com `exists` falso).
- **Sem testar:** Windows e Mac reais, túnel real da Cloudflare.
