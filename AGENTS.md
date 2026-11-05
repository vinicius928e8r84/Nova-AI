# AGENTS.md — regras de trabalho neste repositório

Este repositório é compartilhado por vários agentes (Claude, Codex, DeepSeek, ZCode).
O objetivo destas regras é **não haver desencontro**: cada um edita em uma branch
própria e a união passa por `main`.

## 1. `main` é o tronco estável

- **Ninguém edita `main` diretamente.** Nem commit, nem `amend`, nem force-push.
- `main` só recebe código por merge de branch (PR ou `git merge --no-ff`).
- Antes de começar qualquer tarefa:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
```

## 2. Uma branch por tarefa e por agente

Formato do nome:

```
agent/<ferramenta>/<tarefa-curta>-AAAAMMDD
```

Exemplos: `agent/deepseek/cam-unix-socket-20261104`, `agent/codex/modal-iphone-20261105`.

```bash
git switch -c agent/<ferramenta>/<tarefa>-$(date +%Y%m%d)
```

- Trabalhe **só** nessa branch até terminar.
- Commits pequenos e com mensagem dizendo o que mudou no app e nos fontes.
- Faça `git push -u origin <branch>` cedo, para os outros verem o que está em voo.

## 3. Antes de unir

```bash
git fetch origin
git rebase origin/main          # resolve conflito na sua branch, nunca no main
# rodar os testes da área mexida
git push --force-with-lease origin <branch>
gh pr create --base main --head <branch> --fill
```

- Quem revisa/une faz merge (squash ou `--no-ff`), nunca rebase em `main`.
- Se dois agentes mexeram no mesmo arquivo, o segundo **rebaseia** e relê o arquivo
  inteiro antes de commitar. Não sobrescreva a versão do outro com a sua.

## 4. O que não entra no git

- Instaladores e binários grandes: `.dmg`, `.exe`, `.zip`, `.tgz`, `.deb`
  (ver [`.gitignore`](.gitignore)).
- Cópias completas do app, perfis Chromium, `node_modules`, `.theos/`,
  backups `distribuicao/pacote-*` e `encerramento-nova/teste/`.
- **Chaves e segredos**: nunca commitar `secret_key.json`, `*_key.json`,
  `remote_tokens.json`, `id_iphone`, sessões de WhatsApp/Telegram. As chaves do
  app vivem em `~/Library/Application Support/nova_dsktp/`, fora do repositório.
- Snapshots de `reservas/` do **bundle minificado** (`index-Dun7lr2S*.js`) são
  aceitos por tamanho (7,3 MB cada), mas evite criar cópias novas sem necessidade.

## 5. Aplicar no app instalado

O código fonte fica neste repositório; o app instalado em
`/Applications/Nova AI Mac.app` é atualizado à mão.

- Sempre guarde o arquivo anterior na pasta `reservas/` da integração antes de
  substituir o do app instalado.
- No PR, liste **exatamente** quais arquivos do app foram trocados e como
  reaplicar (script ou `cp`).
- Depois de mexer em `main.js`/`preload.js`, valide com `node --check` e reinicie
  o Nova para carregar.

## 6. Convenções deste projeto

- Código e comentários novos em **pt-BR**; nomes de API/hardware como estão.
- Não traduza nada que seja valor de spoofing (nomes de GPU, modelos de celular).
- Toda alteração de comportamento precisa de registro em `MAC/LEIA-ME.md`
  (data, o que mudou, arquivos, o que ficou sem testar).
