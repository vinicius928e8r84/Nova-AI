# Nova AI — macOS + iPhone

Port local do Nova AI (Electron, Windows de origem) para macOS Apple Silicon, com as
integrações de iPhone por USB, CAM LIVE, CAM HIJACK e tradução da interface.

- Estado do projeto e histórico das alterações até 20/11/2026: [`MAC/LEIA-ME.md`](MAC/LEIA-ME.md). As alterações seguintes ficam no corpo de cada PR.
- Integração iPhone (ponte nativa, SSH, câmera): [`MAC/integracao-iphone/README.md`](MAC/integracao-iphone/README.md)
- CAM LIVE (transmissão direta para o iPhone): [`MAC/integracao-camlive/`](MAC/integracao-camlive/)
- Guia do usuário: `GUIA/`

## Estrutura

| Pasta | O que é |
|---|---|
| [`app/`](app/README.md) | Código do app (Electron), **comum a Mac e Windows**: `npm install`, `npm start`, `npm run dist:mac`, `npm run dist:win` |
| `MAC/` | Específico do Mac e do iPhone: integrações, tweaks `.deb` (fontes), scripts, histórico em `LEIA-ME.md` |
| [`docs/windows.md`](docs/windows.md) | Passo a passo do Windows e comparação com o app Windows instalado |
| `WINDOWS/` | Só local (ignorada pelo git): onde fica o instalador `.exe` do Windows |
| `GUIA/`, `pesquisas/`, `backup-antes-traducao/` | Guia do usuário e estudos |

O app instalado vive em `/Applications/Nova AI Mac.app`; o código que roda nele é
copiado a partir das pastas de integração. Os instaladores (`.dmg`, `.exe`), os
perfis de navegador e as cópias completas do app **não** entram no git — ver
[`.gitignore`](.gitignore).

## Fluxo de trabalho entre agentes

Leia [`AGENTS.md`](AGENTS.md) antes de editar. Resumo: `main` é o tronco estável;
cada agente trabalha em `agent/<ferramenta>/<tarefa>-AAAAMMDD` e a união é feita
por PR/merge, nunca editando `main` direto.

## Aviso

Base de terceiros (autor original: The Carl Moon) com modificações locais. Não é
distribuição oficial e não deve ser publicada sem revisar licença e dados pessoais.
