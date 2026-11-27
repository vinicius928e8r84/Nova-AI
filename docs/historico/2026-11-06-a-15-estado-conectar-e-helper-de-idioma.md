# Histórico — 06 a 15/11/2026: estado do projeto, Conectar e helper de idioma

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
- **Reaplicar no app instalado:** copiar `android-tools-mac.js` e `physicalMobileService.js` para `Resources/app/electron/services/` (guardar o anterior em `~/Nova-AI-reservas/`) e reiniciar o Nova.

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

## Conectar: mensagem clara quando o dpkg trava no iPhone — 06/11/2026

O modal Conectar mostrava o dump cru do `dpkg` (`rm command for cleanup subprocess was killed by signal (Segmentation fault: 11)`), o que parece erro de senha. Agora, quando o texto do erro tem `dpkg:`, `Segmentation fault` ou `was killed by signal`, o modal explica: **não é a senha**, nada foi alterado no Mac, **não tocar em "Tentar novamente"** e que o aparelho precisa ser recuperado (modo seguro) antes de repetir.

- Arquivo: `MAC/integracao-iphone/conexao-usb/inapp.js` (cópia instalada em `electron/services/iphone-setup/inapp.js`). Testes `setup.test.cjs`, `botao.test.cjs`, `botao-servico.test.cjs` OK.

## Conectar: "Senha aceita, mas a chave de acesso não foi validada" — 06/11/2026

Sintoma: no modal Conectar iPhone por USB a senha era aceita e a mensagem em vermelho dizia que a chave de acesso não foi validada (parecia senha errada). Não era a senha nem o `known_hosts` em si.

Causa: em `electron/services/iphone-ssh.js` → `sshOptions()` a opção ia sem aspas: `UserKnownHostsFile=/Users/…/Application Support/nova_dsktp/iphone-ssh/known_hosts`. O parser de configuração do `ssh` **separa por espaço**, então ele lia o arquivo `~/Library/Application` (um resto de 98 bytes com a chave de host **velha**, de 04/11) e recusava com `Host key for [127.0.0.1]:2222 has changed and you have requested strict checking`. A verificação `iosSsh('test -d /var/jb')` falhava e o app mostrava a mensagem enganosa.

- Correção: o valor de `UserKnownHostsFile` agora recebe aspas quando o caminho tem espaço (`MAC/integracao-iphone/iphone-ssh.js`).
- Verificado com as mesmas opções do app via `execFile`: `CONECTOU` / `JB_OK` / `mobile` — ou seja, a chave do app **já estava** instalada no aparelho; só a checagem estava quebrada.
- App instalado corrigido com backup ao lado: `electron/services/iphone-ssh.js.bak-20261106-182841`. Branch `agent/frontend/conectar-known-hosts-20261106`, sem merge e sem push.
- Sobra do bug no Mac: o arquivo `~/Library/Application` (98 bytes, chave de host antiga). Com a correção não é mais lido; pode ser removido com o OK do usuário.

### Conectar: senha digitada uma vez só neste modal

- O campo era limpo antes da chamada, então um erro no Conectar obrigava a **digitar a senha outra vez** para "Tentar novamente". Agora a senha fica só na memória do modal durante a sessão: falhou → volta no campo já preenchido; o modal fecha → o campo é limpo. Nada é gravado em disco.
- Texto de ajuda corrigido: antes dizia apenas "Ela não é salva"; agora explica que é usada **só neste Conectar** e que depois o app entra pela chave, sem senha.
- Arquivo: `MAC/integracao-iphone/conexao-usb/inapp.js` (cópia instalada em `electron/services/iphone-setup/inapp.js`, com backup). Testes `setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` passando.
- O que ainda pede senha: instalar pacote em `/var/jb` (`novamodel`, `nova-locale`) usa `sudo`, que não está liberado sem senha. Para resolver de vez: incluir esses installs no mesmo Conectar (usa a senha que a pessoa acabou de digitar) ou instalar a regra de `sudo` sem senha no aparelho — ambos no `setup.js` (iOS Engineer).

## Correção do guard `this.mobile` no CAM LIVE (branch, sem merge) — 06/11/2026

Branch `agent/backend/cam-spoof-guard-20261106` (a partir de `main` `67673e3`), **sem merge na main e sem push**. Corrige o defeito que o QA achou no caminho "ligar a injeção antes de transmitir": `TypeError: Cannot read properties of undefined (reading 'iosSsh')` em `_camouflagedForward()`.

- Causa: `this.mobile` só era atribuído dentro de `_start()`; quem clicava em "Ligar" sem iniciar o CAM LIVE antes nunca passava por `_start()`, então `this.mobile` ficava `undefined`. A linha do `chmod` era engolida pelo `catch(_)` e a do `rm -f` (dentro do catch) estourava.
- `ensureTransport()`: antes de `_tunnel()`, adicionada a guarda `if (!this.mobile) this.mobile = this.getMobileService?.();` (a mesma que o app já usa em `_readState()`).
- `_camouflagedForward()`: o `catch(_)` silencioso agora lança `"Abra PHONE CONTROL e conecte o iPhone antes de ligar a injeção."` quando `this.mobile` não existe (em vez de engolir o erro).
- Aplicado nas duas cópias do repo: `integracao-camlive/cam-live-iphone.js` e `integracao-sequestro-cam/cam-live-iphone.patched.js`. **App instalado em `/Applications` não foi tocado** (fica para o Security & Infra, com aprovação).
- Teste `integracao-sequestro-cam/controles-independentes.test.cjs` atualizado: `version: '0.1-38'` → `'0.1-39'` e a rota `/frame.jpg` → `live.media.framePath` (`/s/<token>/frame.jpg`).

**Verificação:** `controles-independentes.test.cjs` 2 de 2 passando; `setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` OK; `node --check` nos arquivos tocados OK.

## GPS: monta a Developer Disk Image antes de aplicar localização — 06/11/2026

Causa do erro "Proxy em Sayreville … Command failed: idevicesetlocation …": a Developer Disk Image cai a cada reboot do iPhone e o `idevicesetlocation` (libimobiledevice 1.4.0) **não avisa** — com a DDI desmontada ele sai com código 0 em silêncio (a conexão ao serviço `com.apple.dt.simulatelocation` é resetada, só visível com `-d`), ou falha com a mensagem real escrita no **stdout** (o app só lia stderr, então mostrava o genérico `Command failed`).

Fix em `physicalMobileService.js`:
- `iosSetLocation` agora chama `mountDeveloperImage` (auto-mount idempotente) **antes** de aplicar, em vez de só como fallback que nunca disparava (regex testava stderr, mas o erro está no stdout).
- `runIdevicesetlocation` passa a juntar stdout+stderr no campo de erro, para não esconder a causa.

App instalado (`/Applications/Nova AI Mac.app/…/physicalMobileService.js`) **patcheado agora** com o mesmo fix (backup em `MAC/integracao-iphone/reservas/physicalMobileService.js.bak-20261106-195601`), `node --check` OK. Requer reiniciar o Nova para carregar (o require cache segura a versão antiga). Contorno imediato já aplicado: `pymobiledevice3 mounter auto-mount --udid 47f4fc34…` rodado e o comando do app passou sem erro (40.4592726 -74.3609833). Branch `agent/backend/gps-ddi-automount-20261106`, sem merge e sem push.

## Injeção de câmera explícita para Safari — 06/11/2026

Pedido do usuário: a injeção de câmera também deve chegar ao Safari. A ponte 0.1-39 já cobria qualquer app pelo curinga (`appIDs:['*']`) e o `Tweak.x` já trata o grafo do Safari (`com.apple.WebKit.GPU`: dimensões próprias e caminho de stop específico). O ajuste torna o alvo explícito e auditável: nos dois configs de injeção (`enable()` do vídeo local e `setCameraInjection()` do CAM LIVE), `appIDs` agora lista `['*','com.apple.camera','com.apple.WebKit.GPU','com.apple.mobilesafari','com.apple.facetime']` — o curinga continua, então nenhum app perde cobertura. A mensagem de sucesso agora cita Câmera, FaceTime e Safari. Arquivos: `MAC/integracao-iphone/ios-camera.js`, `MAC/integracao-sequestro-cam/ios-camera.patched.js` e o app instalado (`electron/services/ios-camera.js`, backup `ios-camera.js.bak-*`). Branch `agent/ios/injetar-safari-20261106`, sem merge/push. Lembrete: no app instalado, iniciar CAM LIVE antes de Ligar (bug `this.mobile`, conserto na branch `5406337`).

## nova-locale v2 (complemento): auto-checagem de comandos e recusas do helper root — 07/11/2026

Revisão da v2 do iOS Engineer (7a5dcba) por quem cuida do helper. Medido rodando o script de verdade num sandbox do Mac (caminhos trocados por uma pasta temporária; nada do aparelho tocado). Três furos, os três corrigidos aqui:
1. **Status falso.** Com a v2 original, se faltar o `sleep` (ou outro comando) na partida, o script grava `{"ok":true,"message":"pronto v2"}` e só depois sai com 1. O handshake do Conectar procura exatamente esse texto e diria "atualizado" com o serviço em laço de reinício. Agora, antes de dizer pronto, o script confere `sleep sed head grep cp mv ln chown chmod rm`; se faltar algum, grava `{"ok":false,"message":"helper sem comandos: ..."}`, 1 linha no `.err` e sai com 78. O `sleep 1 || exit 1` do laço continua, para o caso de o `sleep` sumir com o serviço já rodando. O `trim_logs` passou a rodar antes dessa checagem.
2. **`trim_logs` seguia link simbólico.** `: >` segue o link: um `nova-locale.out` apontando para outro arquivo zerava o arquivo apontado (medido: 2 MiB → 0). Agora link simbólico é ignorado.
3. **`plist=` com `..`.** `/var/tmp/../x.plist` passava no teste de prefixo e só o `<?xml` na primeira linha segurava; como o helper é root e o `.cmd` é gravável por qualquer processo, dava para copiar um plist qualquer para as preferências do `mobile`. Agora `..` e link simbólico são recusados. O app atual só manda `tz`, então nada muda para ele.

Arquivos: `conexao-usb/nova-locale.sh` e o gêmeo `geo-proxy/helper/nova-locale.sh` (idênticos); `conexao-usb/locale-helper.test.cjs` (o teste 2a mudou de "exit 1 + pronto v2" para "exit 78 + ok:false, nunca pronto v"; novos 2c = `sleep` some com o serviço no ar e 2d = link simbólico/plist). `HELPER_VERSION` continua 2: a v2 ainda não foi para o aparelho. Branch `agent/jailbreak/locale-selfcheck-20261107`, empilhada em `agent/ios/locale-endurecer-20261107`, sem merge/push. Substitui a primeira tentativa (`agent/jailbreak/locale-script-endurecer-20261107`), que reescrevia o script por conta própria.

Testes (07/11): `locale-helper.test.cjs` (1, 2a, 2b, 2c, 2d, 3), `setup.test.cjs`, `botao.test.cjs` e `botao-servico.test.cjs` OK. O 2a novo falha contra o script v2 original, como deve. No launchd real do Mac (agente temporário, `KeepAlive`, sem `sleep` no PATH) o script com esta checagem religou em t=0/10/20/30 s, 1 linha de 81 bytes por vez, `last exit code = 78: EX_CONFIG`, sem nenhum "pronto".

**Sem testar:** o aparelho (nada foi instalado nem executado lá), o bash 5 do Procursus e o `ThrottleInterval` do launchd do iOS 16 (medi o do macOS).

