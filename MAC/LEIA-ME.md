# Nova AI para macOS (Apple Silicon) — estado do projeto

## GPS: monta a Developer Disk Image antes de aplicar localização — 06/11/2026

Causa do erro "Proxy em Sayreville … Command failed: idevicesetlocation …": a Developer Disk Image cai a cada reboot do iPhone e o `idevicesetlocation` (libimobiledevice 1.4.0) **não avisa** — com a DDI desmontada ele sai com código 0 em silêncio (a conexão ao serviço `com.apple.dt.simulatelocation` é resetada, só visível com `-d`), ou falha com a mensagem real escrita no **stdout** (o app só lia stderr, então mostrava o genérico `Command failed`).

Fix em `physicalMobileService.js`:
- `iosSetLocation` agora chama `mountDeveloperImage` (auto-mount idempotente) **antes** de aplicar, em vez de só como fallback que nunca disparava (regex testava stderr, mas o erro está no stdout).
- `runIdevicesetlocation` passa a juntar stdout+stderr no campo de erro, para não esconder a causa.

App instalado (`/Applications/Nova AI Mac.app/…/physicalMobileService.js`) **ainda não** foi patcheado — falta OK do usuário. Contorno imediato já aplicado: `pymobiledevice3 mounter auto-mount --udid 47f4fc34…` rodado e o comando do app passou sem erro (40.4592726 -74.3609833). Branch `agent/backend/gps-ddi-automount-20261106`, sem merge e sem push.

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
