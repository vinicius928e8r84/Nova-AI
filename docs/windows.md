# Nova AI no Windows — rodar e gerar o instalador

> **Estado dos testes:** o passo a passo abaixo **não foi executado em um Windows**. Foram
> testados no Mac (Apple Silicon): `npm install`, `npm start` e `npm run dist:mac`. Para o
> Windows foi testado só que a configuração do NSIS é válida (gerou um `.exe` de 295 MB no Mac com
> `--config.npmRebuild=false`, sem módulos nativos de Windows, por isso esse arquivo não serve para uso).
> Se algum passo falhar no Windows, anote o erro: é o primeiro teste real.

## 1. Instalar o que falta (uma vez)

Em um PowerShell:

```powershell
winget install Python.Python.3.12         # Python 3.11+ (o npm install exige)
winget install Git.Git
```

Node.js: instale a versão **22 LTS** pelo instalador de nodejs.org/en/download (aba v22). Não use Node 26.

Feche e abra o PowerShell, depois confira: `node -v` (22.x), `npm -v`, `python --version`.

Se o `npm install` pedir compilador para `better-sqlite3` ou `@jitsi/robotjs`, instale o *Visual Studio Build Tools 2022* com a carga
"Desenvolvimento para desktop com C++".

## 2. Baixar o código e instalar dependências

```powershell
git clone https://github.com/vinicius928e8r84/Nova-AI.git
cd Nova-AI\app
npm install
```

Se o `npm install` reclamar do Python (`youtube-dl-exec needs Python 3.11 or newer as python3`),
o Windows não tem um `python3` no PATH. Pule a checagem com `$env:YOUTUBE_DL_SKIP_PYTHON_CHECK=1; npm install`
(no Windows o `yt-dlp` é um `.exe` independente do Python).

## 3. Rodar

```powershell
npm start
```

O app abre direto, sem a tela "Controle de Acesso". A chave de API do Gemini se informa em Configurações. Dados do usuário em
`%APPDATA%\nova_dsktp\`.

## 4. Complementos que ficam fora do git

Coloque dentro de `app\resources\` (crie a pasta; ela é ignorada pelo git e entra no instalador):

| Arquivo | Caminho | Onde obter |
|---|---|---|
| `ffmpeg.exe` | `resources\bin\ffmpeg.exe` | gyan.dev/ffmpeg/builds, build "essentials" |
| `yt-dlp.exe` | `resources\bin\yt-dlp.exe` | github.com/yt-dlp/yt-dlp/releases |
| `adb.exe` (+ DLLs) | `resources\bin\` ou `resources\platform-tools\` | developer.android.com/tools/releases/platform-tools |
| `scrcpy.exe` (+ DLLs, `scrcpy-server`) | `resources\bin\` ou `resources\scrcpy\` | github.com/Genymobile/scrcpy/releases |
| `cloudflared.exe` | `resources\cloudflared.exe` | github.com/cloudflare/cloudflared/releases |
| `nova-cam-spoofer.apk` | `resources\nova-cam-spoofer.apk` | copie do app instalado (`...\Nova AI\resources\`) |

Os `.exe` de acesso remoto/Android só são necessários se for usar essas funções.
Para ter o Chromium embutido: `npm run browsers` (baixa para `app\browsers\`).
Python do assistente de voz: `pip install -r requirements.txt`.

A lista completa, incluindo o que é só do Mac, está em [`../app/README.md`](../app/README.md).

## 5. Gerar o instalador

```powershell
npm run dist:win
```

Resultado: `app\release\Nova AI-Setup-1.1.15.exe` (NSIS, x64, instalação por usuário, com escolha de pasta).
Instale dando duplo clique. O instalador não é assinado: o SmartScreen mostra "Mais informações" > "Executar assim mesmo".

Gere sempre no Windows: no Mac o `electron-builder` recusa (`node-gyp does not support cross-compiling`),
porque os módulos nativos precisam ser compilados para Windows.

## 6. O app do Windows é o mesmo código de `app/`?

Em 15/11/2026 o `app.asar` do app instalado no PC (`...\Programs\Nova AI\resources`, versão 1.1.15, de 30/10/2026)
foi comparado, arquivo por arquivo, com `app/` (fora `node_modules`):

- **115** arquivos no `app.asar`: **88 idênticos**, **27 diferentes**, nenhum existe só no Windows.
- **36** arquivos de `app/` não existem no Windows: o port para Mac (serviços do iPhone, CAM LIVE, `mac-native.js`,
  idioma/identidade, `.mp4` de exportação) e arquivos de apoio do repositório (`README.md`, `.gitignore`, `package-lock.json`).
- As 27 diferenças são, em ordem de peso:
  1. **Licença/ativação do fornecedor** (verificação Firebase de chave de licença e de máquina, em `main.js` e no bundle da UI).
     O port para Mac a removeu ("sem ativação"). Está **só no app Windows original** e traz uma chave de API embutida,
     por isso **não foi copiada para o repositório público**.
  2. **Ramos por plataforma**: o port troca `ffmpeg.exe`/`yt-dlp.exe`/`powershell`/`cmd.exe` por ramos
     `process.platform === 'darwin' ? ... : <original Windows>`. O ramo Windows foi preservado.
  3. **Textos traduzidos para pt-BR** (mensagens, títulos de diálogos, bandeja).
  4. **Mudanças do port sem ramo por plataforma**, que valem também no Windows:
     - `electron/services/rtmp-server.js`: porta RTMP **11935** (era 1935) e `adb reverse tcp:1935 tcp:11935`.
     - `electron/services/remote-access.js`: servidor escuta só em `127.0.0.1` (era `0.0.0.0`) e o túnel público do
       Cloudflare fica desligado, a menos que `NOVA_REMOTE_TUNNEL=1`. Acesso remoto/pelo celular na rede local
       **não funciona** com esses padrões.
     - `electron/main.js`: blocos novos do iPhone/CAM LIVE e as variáveis `NOVA_SMOKE_TEST`/`NOVA_TEST_PORT`/
       `NOVA_TEST_INSTANCE` (inofensivas). A atualização automática só é desligada no Mac.
  5. `package.json`: scripts, `electron-builder` e `build` (este trabalho); `@novnc/novnc` só existe na versão do repositório.
- Fora do `app.asar`, o Windows ainda traz `resources\bin\vcam.dll` (câmera virtual), `scrcpy\`, `platform-tools\`, `browsers\`
  (Chromium 1208, `vivaldi`, `aloha`), `.env.example`, `app-update.yml` (feed de atualização do fornecedor) e `stt_test.py`.
  São binários ou arquivos sem valor de código, então ficam fora do git.

Os itens do ponto 4 são decisões do port para o Mac: se quiser o comportamento antigo no Windows, é uma mudança de
código à parte (guardar por `process.platform`), não de build.
