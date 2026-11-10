# app/ — código do sistema Nova AI

Código-fonte do app **Nova AI Mac** (Electron), copiado do app instalado em
`/Applications/Nova AI Mac.app/Contents/Resources/app`. É a metade que faltava no
repositório: aqui está o que roda; em `MAC/` e no restante do repo está o entorno
(jailbreak, tweaks `.deb`, scripts do iPhone, distribuição, documentação).

- **Data do snapshot:** 09/11/2026
- **Origem:** app instalado (que é a versão em uso — inclui correções que não estavam no repositório antigo)
- **`dist/`** = bundle compilado da interface que roda no app
- **`electron/`** = processo principal, serviços (iPhone/GPS/idioma/proxy/câmera), PWA
- **`public/`, `audio/`, `youtube_auto/`, `physical_mobile/`, `wake_word_bg.py`** = assets e módulos auxiliares

## O que NÃO está aqui
- **`node_modules/`** — dependências não versionadas; instale com `npm install` (o `package-lock.json` fixa as versões). No app instalado elas somam 1,1 GB.
- Os arquivos com sufixo `.bak*` (backups de edição) e bancos `.db`.
- **Segredo neutralizado:** em `electron/pwa/admin.html` a chave de API do Google/Firebase
  aparece como `__GOOGLE_API_KEY_NEUTRALIZADA__`. Ela foi removida antes de publicar.
  Se precisar dela em execução, coloque a sua no lugar.

## O que ficou de fora e por quê
- **`*.deb`** de `electron/services/iphone-setup/` (camera, novamodel, novaproxy, novalanguage):
  barrados pela regra `*.deb` do `.gitignore` da raiz. O `.deb` canônico ainda está em
  discussão (0.2-2 × 0.2-3); as fontes ficam em `MAC/`.
- `.mp4` de exportação e `.wav` entraram: são parte do que o sistema produz.

## Rodar
```bash
npm install
npm start
```
