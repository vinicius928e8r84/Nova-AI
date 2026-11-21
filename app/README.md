# app/ — código do sistema Nova AI

Código-fonte do app **Nova AI** (Electron 34, versão 1.1.15), comum a Mac e Windows.
É o port para macOS do app Windows original, mantendo os ramos de Windows.

- **Base:** o app instalado no Mac (`Nova AI Mac.app`). Em 15/11/2026 foi comparado arquivo
  por arquivo com o pacote `Nova-AI-Mac-AppleSilicon-2026-11-10.dmg`: o código é idêntico
  (a única diferença é a chave do Google neutralizada em `electron/pwa/admin.html`).
- **`dist/`** = bundle compilado da interface (não há fonte React neste repositório)
- **`electron/`** = processo principal, serviços (iPhone/GPS/idioma/proxy/câmera), PWA
- **`public/`, `audio/`, `youtube_auto/`, `physical_mobile/`, `wake_word_bg.py`** = assets e módulos auxiliares
- **`scripts/`** = utilitários de build/instalação (ver abaixo)

## Requisitos

| O quê | Versão | Observação |
|---|---|---|
| Node.js | **22 LTS** | Testado com 22.23. Com Node 26 o `postinstall` do Electron termina sem erro mas não extrai o binário (`node_modules/electron/path.txt` não existe) |
| Python | 3.11 ou mais novo, como `python3` | Exigido pelo `preinstall` do `youtube-dl-exec`. Sem ele: `YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm install` |
| macOS | Xcode Command Line Tools (`xcode-select --install`) | Para compilar módulos nativos se não houver binário pronto |
| Windows | Visual Studio Build Tools (carga "Desktop development with C++") | Só se `@jitsi/robotjs` ou `better-sqlite3` precisarem compilar |

## Rodar

```bash
npm install
npm start
```

- O `postinstall` recompila os módulos nativos (`better-sqlite3`, `@jitsi/robotjs`, ...) para o Electron
  e instala o `ssh2` de `electron/services/iphone-setup/` (usado pela conexão do iPhone).
- npm 11 ou mais novo bloqueia scripts de instalação de dependências. Os que o app precisa estão
  liberados em `allowScripts` no `package.json`; o `puppeteer` fica de fora de propósito (baixaria
  um Chrome que o app não usa). No npm 10, se quiser evitar esse download: `PUPPETEER_SKIP_DOWNLOAD=1 npm install`.
- O app abre direto, sem a tela **Controle de Acesso**; a chave de API do Gemini se informa em Configurações. Os dados do usuário
  ficam em `~/Library/Application Support/nova_dsktp/` (Mac) ou `%APPDATA%\nova_dsktp\` (Windows).
- Teste rápido sem abrir janela e sem tocar nos seus dados:
  `NOVA_SMOKE_TEST=1 NOVA_SMOKE_DIR=/tmp/nova-smoke npm start` grava `screen.png` e `result.json` em
  `NOVA_SMOKE_DIR` e sai com código 0.
- O app grava segredos do usuário dentro de `app/` quando roda com `npm start`: `config_bak_C.dat` (ação de
  exportar a configuração, na pasta atual), `youtube_auto/.env` (chave Gemini) e `youtube_auto/client_secret.json`
  (OAuth do Google), `data/`, entre outros. Eles estão no `.gitignore` **e** fora do instalador: `build.files`
  exclui, em qualquer pasta, `.env*`, `config_bak_C.dat`, `secret_key.json`, `*_key.json`, `remote_tokens.json`,
  `id_iphone*`, `known_hosts`, `iphone-hosts.json`, `*.db*`, `*.sqlite*`, `*.log`, `*.antes-proxy-*`, e, na raiz,
  `data/`, `Nova_Vault/`, `youtube_auto/client_secret.json`, `youtube_auto/token*.json` e `youtube_auto/exports/`.
  **Nunca** remova essas exclusões: o electron-builder não lê o `.gitignore`. Antes de publicar um instalador,
  confira com `find <app empacotado> -name '.env*' -o -name '*client_secret*' -o -name 'config_bak_C.dat'`.

## Gerar instalador

| Comando | Resultado | Rodar em |
|---|---|---|
| `npm run dist:mac` | `release/Nova-AI-Mac-AppleSilicon-1.1.15.dmg` (Apple Silicon, assinatura ad hoc) | macOS |
| `npm run dist:win` | `release/Nova AI-Setup-1.1.15.exe` (NSIS, x64) | **Windows** |

Usam `electron-builder` (configuração no campo `build` do `package.json`). `asar` fica desligado porque
o app executa Python, ffmpeg e outros arquivos de dentro da própria pasta. O `.dmg` identifica-se como
`local.nova.ai.mac` / "Nova AI Mac", o mesmo do app instalado, para o macOS manter as permissões já concedidas.

- Só entra no instalador o que estiver nas pastas `resources/` e `browsers/` (ambas fora do git) mais `public/` e
  `wake_word_bg.py`. Sem elas o instalador sai pequeno (~350 MB no Mac) e o app depende do que houver no sistema.
- O instalador do Windows não pode ser gerado no Mac: os módulos nativos precisam ser compilados no próprio Windows.
- Primeira abertura no Mac (app sem notarização Apple): botão direito > Abrir, ou
  `xattr -dr com.apple.quarantine "/Applications/Nova AI Mac.app"`.
- No Windows o SmartScreen avisa porque o instalador não é assinado.

Passo a passo completo do Windows: [`../docs/windows.md`](../docs/windows.md).

## O que o app precisa em runtime e fica fora do git

Onde o código procura, em produção, é `process.resourcesPath` (= `Contents/Resources` no Mac, `resources\` no
Windows); no modo `npm start` é `app/resources/` (e `app/browsers/` para navegadores).

| Item | Onde o app procura | Destino | Como obter |
|---|---|---|---|
| `ffmpeg` | `resources/bin/` (Mac: também Homebrew) | **fora do git** (binário) | Mac: `brew install ffmpeg`. Windows: `ffmpeg.exe` de gyan.dev (build "essentials") |
| `yt-dlp` | `resources/bin/` ou `node_modules/youtube-dl-exec/bin/` | **fora** (o `npm install` já baixa o de `node_modules`) | github.com/yt-dlp/yt-dlp/releases |
| `cloudflared` | Mac: `resources/bin/` ou Homebrew. Windows: `resources\cloudflared.exe` | **fora** | Mac: `brew install cloudflared`. Windows: github.com/cloudflare/cloudflared/releases. Em dev usa o do pacote npm |
| `adb`, `scrcpy`, `scrcpy-server` | `resources/bin/`, `resources/platform-tools/`, `resources/scrcpy/` | **fora** | Mac: o app baixa sozinho (ADB do Google com SHA-1 do manifesto oficial; scrcpy v5.0.1 com SHA-256 fixo) para `~/Library/Application Support/nova_dsktp/physical_mobile/`; ou `brew install android-platform-tools scrcpy`. Windows: platform-tools do Google + scrcpy (github.com/Genymobile/scrcpy/releases) |
| Chromium embutido | `browsers/chromium-<rev>/` (Mac em dev: `app/browsers/`; empacotado: `Resources/browsers/`) | **script**: `npm run browsers` | Baixa o Chromium do Playwright (~370 MB) para `app/browsers/`. Sem isso o app usa Chrome/Firefox instalados ou o cache do Playwright |
| Navegadores da Fazenda (`vivaldi`, `brave`, `firefox`, `chrome`) | `browsers/<nome>/` ou instalação do sistema | **fora** (1 GB cada) | Instale o navegador normalmente; o app também procura nos locais padrão do sistema |
| Python e pacotes | Mac: `resources/python-runtime-portable/run-python`, `resources/python-env/bin/python3`, senão `python3` do sistema. Windows: `resources\python\python.exe` (opcional, ver `docs/windows.md`), senão `python` do PATH | **script**: `pip install -r requirements.txt` | Python 3.11+. O pacote Mac antigo embutia o Python 3.15 do Homebrew (~150 MB); não é necessário para desenvolver |
| Ferramentas do iPhone (`iproxy`, `idevice_id`, `ideviceinfo`, `ideviceinstaller`) | `<Resources>/ios-tools/bin/` (o código não procura no Homebrew nem no `PATH`) | **fora** | Mac: copie `Contents/Resources/ios-tools/` do app instalado para `app/resources/ios-tools/` antes de `npm run dist:mac`. Windows: no shell MSYS2 UCRT64 rode `MAC/integracao-iphone/distribuicao/empacotar-ferramentas-windows.sh` (gera `app\resources\ios-tools\bin\*.exe` + DLLs) antes de `npm run dist:win`; o driver USB não vai junto: instale o Apple Devices ou o iTunes no PC. Com `npm start` o `<Resources>` é o do Electron, então o iPhone por USB não acha as ferramentas (use o app instalado para isso). Receita do Mac: `MAC/integracao-iphone/distribuicao/empacotar-ferramentas.py` |
| `nova-cam-spoofer.apk` | `resources/nova-cam-spoofer.apk` | **fora** (binário sem fonte neste repo) | Copie do app instalado ou do pacote `.dmg`/`.exe` |
| `.deb` do iPhone (`camera.deb`, novamodel, novalanguage) | `electron/services/iphone-setup/` | **fora** (`*.deb` no `.gitignore`) | Gere com Theos a partir de `MAC/` ou copie do app instalado |
| Modelos de rosto, áudios, ícones | `public/`, `audio/` | **dentro** do git (pequenos, sem segredo) | — |
| Chave do Google/Firebase de `electron/pwa/admin.html` | trecho `apiKey` | **fora**: está como `__GOOGLE_API_KEY_NEUTRALIZADA__` | Crie a sua no Google Cloud (ou use a do admin) e coloque no lugar, só na sua cópia local |
| Chaves de IA, WhatsApp, Telegram, sessões | pasta de dados do usuário | **fora** | Cada pessoa configura as suas dentro do app |

Nada de chave, token, senha, perfil de navegador, `.deb` ou binário de terceiros deve entrar no git.

## Arquivos que ficaram de fora do snapshot
- `node_modules/` (instale com `npm install`; o `package-lock.json` fixa as versões) e
  `electron/services/iphone-setup/node_modules/`.
- Arquivos `.bak*` (backups de edição), bancos `.db` e os `.deb` de `electron/services/iphone-setup/`.
- `.mp4` de exportação e `.wav` entraram: são parte do que o sistema produz.
