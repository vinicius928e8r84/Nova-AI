# Como contribuir

Este repositório é público e compartilhado por vários agentes e pessoas. Estas regras são conferidas por máquina em toda PR; o que não passa não é mesclado. Elas só olham o que a PR muda: código antigo nunca falha.

Antes de começar, siga o `AGENTS.md` (uma branch por tarefa, nada direto na `main`).

## O que a máquina confere

Rode tudo localmente com `node scripts/regras/verificar.js --base origin/main` (use a branch-alvo da sua PR no lugar de `origin/main`). Para o ESLint rodar, instale-o (`npm i -g eslint@9`) ou aponte `ESLINT_BIN` para o `eslint.js`.

| Regra | O que pede | Por quê |
| --- | --- | --- |
| `sem-comentario-novo` | Nenhum comentário nas linhas que a PR acrescenta (JS, Python, shell, CSS e HTML). Passam só o `#!` da linha 1, as diretivas de ferramenta (`eslint-disable`, `noqa`, `@ts-ignore`, `coding:`…) e o cabeçalho de licença. Em Python, docstring nova também conta. | Comentário envelhece sozinho e o próximo agente o copia como regra. O nome carrega a ideia; a decisão vai no corpo da PR. |
| `limite-de-linhas` | Arquivo de código novo tem no máximo 1000 linhas. Os que já passavam estão em `scripts/regras/linha-de-base.json` e não podem crescer. Essa lista só encolhe: rode `--atualizar-linha-de-base` depois de reduzir um arquivo. | Arquivo gigante não cabe na cabeça, e toda PR esbarra na do outro. |
| `sem-segredo` | Nenhuma chave, token, senha, chave privada nem arquivo como `secret_key.json`, `remote_tokens.json`, `id_iphone`, `.env`, sessões de WhatsApp/Telegram. | O repositório é público; o que entra não sai. |
| `sem-binario-nem-lixo` | Nenhum instalador (`.dmg`, `.exe`, `.zip`, `.deb`…), binário, arquivo novo acima de 8 MB nem cópia de backup (`*.bak-*`, `*.orig`, `*.antes-*`). | O git já guarda o arquivo anterior. Para trocar o do app instalado, a cópia vai em `reservas/` (`AGENTS.md` seção 5). |
| `sem-depuracao-esquecida` | Nenhum `console.log`, `debugger`, `.only` de teste, `breakpoint()` nas linhas novas. Scripts, testes e `MAC/` podem imprimir. | Depuração esquecida vira ruído no app. |
| `sintaxe-valida` | Os arquivos mudados compilam: `node --check`, compilação do Python, `bash -n`, JSON. | `AGENTS.md` já exige `node --check` antes de aplicar no app. |
| `eslint-nas-linhas-novas` | ESLint (`scripts/regras/eslint.config.mjs`) sem erro nas linhas novas: variável não usada ou não declarada, código inalcançável, `==`. | Pega código morto e erro de digitação sem cobrar o código antigo. |
| Auditoria de dependências | Só quando uma `package-lock.json` muda: nenhuma vulnerabilidade alta ou crítica nova (`npm audit --omit=dev`). | Dependência é a porta de entrada mais barata de código ruim. |

Arquivos de `dist/`, `build/`, `node_modules/`, `vendor/`, `reservas/`, `backup*/`, minificados, `*.map`, travas de pacote e JSON/Markdown de dados não entram na contagem de linhas nem de comentários. As listas estão em `scripts/regras/configuracao.json`. Cópia idêntica de um arquivo que já existe no repositório não é cobrada por comentário, mas continua sujeita ao limite de linhas (fora de `reservas/`).

## O corpo da PR (check "Registro da PR")

Use `.github/PULL_REQUEST_TEMPLATE.md`. O check confere, no commit exato (`head`) da PR:

1. **Descrição**: o que muda e por quê (pelo menos 40 caracteres de texto).
2. **Atenção**: uma linha `Atenção: BAIXA`, `Atenção: MÉDIA` ou `Atenção: ALTA`.
3. **Atenção ALTA** exige a seção abaixo, com o SHA inteiro (40 caracteres, `git rev-parse HEAD`) do último commit, e uma explicação do que foi provado no app de verdade:

   ```
   ## Prova real

   PROVADO 100% REAL
   Head: <SHA de 40 caracteres>
   ```

4. **Revisão independente**: alguém que não escreveu a mudança registra um comentário na PR no head exato. `Autor` e `Revisor` precisam ser diferentes:

   ```
   Veredito: CLEAN
   Head: <SHA de 40 caracteres>
   Autor: <quem escreveu>
   Revisor: <quem revisou>
   ```

   Só vale o comentário (ou revisão) de quem tem acesso de escrita ao repositório. Um commit novo muda o head: revisão e prova do commit anterior deixam de valer. Para escrever tudo isso sem errar o SHA: `node scripts/regras/registrar-na-pr.js --help`. Comentário não dispara o check; o `registrar-na-pr.js revisao --publicar` já roda o check de novo.

O check confere que o registro existe, é do head certo e tem as linhas certas; não prova que a revisão ou o teste aconteceram. Quem mescla é quem confere o conteúdo.

### Quando a atenção é ALTA sozinha

Mexer em qualquer caminho de `scripts/regras/caminhos-sensiveis.json` conta como ALTA, e declarar BAIXA ou MÉDIA nesse caso falha. A lista cobre licença e Firebase, credenciais, keychain, atualização e dependências, IPC e preload, execução de processos e arquivos fora da pasta do app, ponte do iPhone, SSH, e as próprias regras e workflows. Código novo que registra canal IPC, executa processo, apaga arquivo, usa `safeStorage` ou `autoUpdater` também conta, em qualquer arquivo de código.

## Proteção da branch `main` (para quem administra o repositório)

Configure em Settings → Branches → Branch protection rule (ou Rulesets) para `main`:

- Require a pull request before merging, com **1 aprovação** e "Dismiss stale pull request approvals when new commits are pushed".
- Require status checks to pass before merging, e marque como obrigatórios:
  - `Regras de revisão`
  - `Registro da PR`
  - `Auditoria de dependências`
- Require branches to be up to date before merging.
- Require conversation resolution before merging.
- Do not allow bypassing the above settings (inclui administradores); bloqueie force-push e exclusão da branch.
- Opcional: um `.github/CODEOWNERS` cobrindo `scripts/regras/`, `.github/` e `CONTRIBUTING.md`, com "Require review from Code Owners", para ninguém afrouxar as regras sem revisão.

Se um job for renomeado nos workflows, o nome obrigatório muda junto, senão o merge fica esperando um check que não existe. O mesmo vale para toda branch-alvo de PR que se queira proteger (por exemplo, uma branch de integração): a regra de proteção é por branch.

## Limites conhecidos

- O workflow roda da própria PR: uma PR pode editar as regras. Por isso `.github/` e `scripts/regras/` contam como atenção ALTA, e o CODEOWNERS acima é o que fecha essa porta.
- O check de registro confere texto e SHA; `Autor` e `Revisor` são os nomes que o registro declara.
- Os testes das regras estão em `scripts/regras/test/` (`node --test "scripts/regras/test/*.test.js"`).
