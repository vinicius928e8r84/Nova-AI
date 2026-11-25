# Como contribuir

Este repositório é público e compartilhado por vários agentes e pessoas. Estas regras são conferidas por máquina em toda PR; o que não passa não é mesclado. Elas só olham as linhas que a PR acrescenta ou toca; o que a PR não toca nunca falha. Linha tocada é linha que mudou, foi reindentada ou movida: um comentário antigo nessa linha conta, e converter um arquivo inteiro (por exemplo, o fim de linha) toca todas as linhas.

Antes de começar, siga o `AGENTS.md` (uma branch por tarefa, nada direto na `main`).

## O que a máquina confere

Rode tudo localmente com `node scripts/regras/verificar.js --base origin/main` (use a branch-alvo da sua PR no lugar de `origin/main`). Para o ESLint rodar, instale-o (`npm i -g eslint@9`) ou aponte `ESLINT_BIN` para o `eslint.js`. Para a `saude-do-codigo` rodar, instale o analisador uma vez (`npm ci --prefix scripts/regras/analisador`) e tenha o Python 3 (ou aponte `PYTHON=`); sem eles a regra só avisa e pula na sua máquina, e no CI falha. No GitHub, as regras que valem são as da **branch-alvo** (a PR não consegue afrouxá-las; a mudança vale a partir da PR seguinte), e só na PR que cria as regras valem as da própria PR.

| Regra | O que pede | Por quê |
| --- | --- | --- |
| `sem-comentario-novo` | Nenhum comentário nas linhas que a PR acrescenta (JS, Python, shell, CSS e HTML). Vale também para C, Objective-C, Swift, Logos (`.x`), YAML, TOML, plist e script sem extensão com `#!`. Passam só o `#!` da linha 1, as diretivas de ferramenta (`noqa`, `@ts-ignore`, `coding:`…) e o cabeçalho de licença; `eslint-disable` não passa e o ESLint ignora diretiva em linha. Em Python, docstring nova também conta. | Comentário envelhece sozinho e o próximo agente o copia como regra. O nome carrega a ideia; a decisão vai no corpo da PR. |
| `limite-de-linhas` | Arquivo de código novo tem no máximo 1000 linhas; a marca `@generated` não isenta. Os que já passavam estão em `scripts/regras/linha-de-base.json` e não podem crescer. Essa lista só encolhe: rode `--atualizar-linha-de-base` depois de reduzir um arquivo. | Arquivo gigante não cabe na cabeça, e toda PR esbarra na do outro. |
| `sem-segredo` | Nenhuma chave, token, senha, chave privada nem arquivo como `secret_key.json`, `remote_tokens.json`, `id_iphone`, `.env`, sessões de WhatsApp/Telegram. | O repositório é público; o que entra não sai. |
| `sem-binario-nem-lixo` | Nenhum instalador (`.dmg`, `.exe`, `.zip`, `.deb`…), binário, arquivo novo acima de 8 MB nem cópia de backup (`*.bak-*`, `*.orig`, `*.antes-*`), mesmo que idêntica a um arquivo que já existe. | O git já guarda o arquivo anterior. Para trocar o do app instalado, a cópia vai em `MAC/<área>/reservas/` (`AGENTS.md` seção 5). |
| `sem-depuracao-esquecida` | Nenhum `console.log` (nem `console['log']`), `debugger`, `.only` de teste, `breakpoint()` nas linhas novas. Scripts, testes e `MAC/` podem imprimir. | Depuração esquecida vira ruído no app. |
| `sintaxe-valida` | Os arquivos mudados compilam: `node --check`, compilação do Python, `bash -n`, JSON. | `AGENTS.md` já exige `node --check` antes de aplicar no app. |
| `eslint-nas-linhas-novas` | ESLint (`scripts/regras/eslint.config.mjs`) sem erro nas linhas novas: variável não usada ou não declarada, código inalcançável, `==`. | Pega código morto e erro de digitação sem cobrar o código antigo. |
| `saude-do-codigo` | Nenhum arquivo de código que a PR toca (`.js`, `.mjs`, `.cjs`, `.py`) piora a saúde do código. O arquivo tocado é medido inteiro, em pontos acima dos limites do CodeScene menos um: complexidade até 8, aninhamento até 3, 1 bloco aninhado por função (o ternário conta como nível), 1 operador lógico por condição, 4 argumentos, 69 linhas por função, complexidade média do arquivo abaixo de 4 e 599 linhas de código por arquivo Python. Os arquivos que já passavam estão na chave `saude-do-codigo` de `scripts/regras/linha-de-base.json`, que só desce: piorar uma função que já é ruim falha (de 21 para 22 é um ponto a mais), melhorar passa e avisa que a linha de base pode descer. A folga é de cada arquivo: arquivo novo nasce dentro dos limites e a folga não passa para outro arquivo; só `git mv` a leva junto (`--atualizar-linha-de-base --regra saude-do-codigo` muda a entrada de nome). Refatorar de verdade é separar decidir de fazer, dar nome à condição composta, trocar a cascata por tabela, agrupar argumentos num objeto do domínio e dividir o arquivo por responsabilidade; picar a função sem nome do domínio, trocar argumentos por um saco de opções ou esconder a lógica em closures não conta. | A nota do CodeScene não bloqueia o merge e o servidor dele pode estar fora do ar; esta trava é determinística e roda no job obrigatório. Sem ela, cada PR aberta pode criar a dívida que outra acabou de pagar. |
| `autoria` | Todo commit novo da PR (os que a branch-alvo ainda não tem, sem os de merge) tem autor com o e-mail do repositório e committer com o mesmo e-mail ou `noreply@github.com`; o e-mail fica na chave `autoria` de `scripts/regras/configuracao.json`. Só são julgados os commits com data de autor a partir de `julgaCommitsAPartirDe` (chave única de `configuracao.json`, a mesma do `limite-de-tamanho`): os de antes dessa data passam mesmo com outro e-mail, e um `rebase` não os traz para o julgamento porque preserva a data do autor. Para refazer a autoria: `git config user.email <e-mail>` e `git rebase --exec 'git commit --amend --no-edit --reset-author' origin/main`. | O repositório tem uma conta só; commit com outro e-mail mostra quem é o dono de uma máquina e quebra a atribuição. A data de corte evita reprovar as PRs que já estavam abertas, sem deixar a trava sem efeito para o que vem depois. |
| `limite-de-tamanho` | Todo arquivo de texto que a PR acrescenta ou muda tem no máximo 20000 bytes, o que dá 5000 tokens a 4 bytes por token (chave `tamanhoDeArquivo` de `scripts/regras/configuracao.json`); o fim de linha CRLF conta como um byte. Vale para código, Markdown e JSON, e os lugares isentos são os da lista abaixo. O teto de um arquivo que já passava do limite é o tamanho dele na branch-alvo: ele pode ser editado e encolhido, nunca crescer, e um `git mv` leva o teto junto. Arquivo novo, cópia ou arquivo que sai de um lugar isento tem de caber no limite. Só são julgados os arquivos tocados por um commit com data de autor a partir de `julgaCommitsAPartirDe` e os que ainda não têm commit (o pre-commit os pega); o que as PRs já abertas têm de antes dessa data passa. Não há lista para editar: depois que a PR é mesclada o teto passa a ser o tamanho novo, então ele só desce. | Arquivo de milhares de tokens não cabe no contexto de quem o lê e toda PR esbarra na do outro; `limite-de-linhas` não pega JSON, Markdown nem linha comprida. |
| Auditoria de dependências | Só quando uma `package-lock.json` muda: nenhuma vulnerabilidade alta ou crítica nova (`npm audit --omit=dev`). | Dependência é a porta de entrada mais barata de código ruim. |

Só estes lugares ficam fora da contagem de linhas, de comentário, de depuração, de sintaxe, de ESLint e de saúde do código, com o caminho completo em `scripts/regras/configuracao.json`: `app/dist/assets/`, `MAC/**/dist/`, `MAC/**/reservas/`, `backup-antes-traducao/`, `MAC/**/backup-*/`, `MAC/**/fixtures/`, o bundle `MAC/**/index-Dun7lr2S*.js`, `marked.min.js`, `*.map` e as travas de pacote. Uma pasta com o mesmo nome em outro lugar (`vendor/`, `dist/` dentro de `app/electron/`) é código e é cobrada, e o resto de `app/dist/` (`cam-live.js`, `cam-live-audio.js`, `index.html`) também. A lista de exclusões do CodeScene fica em `docs/codescene-exclusoes.md` e diz a mesma coisa que esta; `scripts/regras/test/exclusoes.test.js` compara as duas com os arquivos do repositório. JSON e Markdown de dados não entram. Cópia idêntica de um arquivo que já existe no repositório não é cobrada por comentário, mas é cobrada pela regra de backup e pelo limite de linhas. Acrescentar um lugar a essa lista é mudar as regras: PR própria, atenção ALTA, revisão do dono (`.github/CODEOWNERS`).

## Ganchos locais

Os mesmos conferidores do CI rodam antes do commit e do push. Instale uma vez em cada clone, e em cada worktree não precisa repetir:

```
git config core.hooksPath .githooks
```

- `.githooks/pre-commit` roda `verificar.js` contra `origin/main` com todas as regras menos `autoria` (o commit ainda não existe). Um commit barrado não é criado.
- `.githooks/pre-push` roda `verificar.js` completo, com `autoria`, contra `<remoto>/main` (ou `origin/main`) quando o que sobe é o `HEAD` de um ramo; não julga a `main`.
- Sem `node` ou sem `origin/main` o gancho avisa e deixa passar; `git fetch origin main` traz a base. `--no-verify` pula o gancho, e o CI barra do mesmo jeito. `.gitattributes` mantém os ganchos com fim de linha LF, que o `sh` do Windows exige.

## O corpo da PR (check "Registro da PR")

Use `.github/PULL_REQUEST_TEMPLATE.md`. O check confere, no commit exato (`head`) da PR:

1. **Descrição**: o que muda e por quê (pelo menos 40 caracteres de texto).
2. **Atenção**: uma linha `Atenção: BAIXA`, `Atenção: MÉDIA` ou `Atenção: ALTA`.
3. **Atenção ALTA** exige a seção abaixo, com uma única linha `Head:` com o SHA inteiro (40 caracteres, `git rev-parse HEAD`) do último commit, e uma explicação de pelo menos 40 caracteres do que foi provado no app de verdade:

   ```
   ## Prova real

   PROVADO 100% REAL
   Head: <SHA de 40 caracteres>

   <o que você rodou no app e o que apareceu>
   ```

   A seção não vale se diz `NÃO COBERTO` (ou `NAO COBERTO`) ou `BLOQUEADA`: prova parcial não é `PROVADO 100% REAL`. O `registrar-na-pr.js prova` pede `--cobertura total|parcial`; `parcial` escreve `BLOQUEADA-iPhone` no lugar da frase, e o check fica vermelho enquanto a atenção for ALTA.

4. **Revisão independente**: alguém que não escreveu a mudança registra uma revisão (comentário de revisão) na PR no head exato. `Autor` e `Revisor` precisam ser diferentes:

   ```
   Veredito: CLEAN
   Head: <SHA de 40 caracteres>
   Autor: <quem escreveu>
   Revisor: <quem revisou>
   Risco: <BAIXA, MÉDIA ou ALTA, o risco que o revisor viu>
   ```

   A atenção que vale é a maior entre a linha `Atenção:` do corpo e o `Risco:` das revisões do head: corpo `MÉDIA` com revisor `ALTA` exige a prova real; corpo `ALTA` com revisor `BAIXA` continua ALTA.

   Só vale o registro de quem o GitHub marca como dono, membro ou colaborador do repositório (o check não sabe se essa pessoa tem escrita, então só convide colaborador em quem pode revisar). O `Revisor` não pode ser quem abriu a PR nem o `Autor`. Um `Veredito` diferente de `CLEAN` no head não se desfaz com outro registro: conserte e faça um commit novo. Um commit novo muda o head: revisão e prova do commit anterior deixam de valer. Para escrever tudo isso sem errar o SHA: `node scripts/regras/registrar-na-pr.js --help`. O `revisao --publicar` publica o registro como revisão da PR (evento que roda o check sozinho); um comentário comum não dispara o check.

O check confere que o registro existe, é do head certo e tem as linhas certas; não prova que a revisão ou o teste aconteceram. Quem mescla é quem confere o conteúdo.

### Quando a atenção é ALTA sozinha

Mexer em qualquer caminho de `scripts/regras/caminhos-sensiveis.json` conta como ALTA, e declarar BAIXA ou MÉDIA nesse caso falha. A lista cobre licença e Firebase, credenciais, keychain, atualização e dependências, IPC e preload, execução de processos e arquivos fora da pasta do app, ponte do iPhone, SSH, e as próprias regras e workflows. Código novo que registra canal IPC, executa processo, apaga arquivo, usa `safeStorage` ou `autoUpdater` também conta, em qualquer arquivo de código.

## Proteção da branch `main` (para quem administra o repositório)

Configure em Settings → Branches → Branch protection rule (ou Rulesets) para `main`. O repositório tem uma conta só e o GitHub não deixa o autor aprovar a própria PR, então a proteção não exige aprovação:

- Require status checks to pass before merging, e marque como obrigatórios:
  - `Regras de revisão`
  - `Registro da PR`
  - `Auditoria de dependências`
- Require branches to be up to date before merging.
- Não exigir aprovação de revisão (Require approvals desligado) e não exigir Code Owners (o `.github/CODEOWNERS` fica só como mapa de quem é dono de cada área).
- Do not allow bypassing the above settings: nem administrador ignora (enforce_admins); bloqueie force-push e exclusão da branch.

Se um job for renomeado nos workflows, o nome obrigatório muda junto, senão o merge fica esperando um check que não existe: `scripts/regras/checks-obrigatorios.json` lista os nomes e um teste confere com os workflows. O mesmo vale para toda branch-alvo de PR que se queira proteger (por exemplo, uma branch de integração): a regra de proteção é por branch, e sem ela nenhum check bloqueia o merge.

## Limites conhecidos

- Os workflows rodam as regras da branch-alvo e não as da PR (só a PR que cria as regras usa as próprias). Mas o arquivo do workflow vem da PR: quem muda `.github/workflows/` pode desligar um check. Como a proteção não exige aprovação nem Code Owners, nenhuma máquina fecha essa porta: o que sobra é a PR contar como atenção ALTA (prova real e revisão independente no head exato, que o check `Registro da PR` cobra) e quem mescla ler o diff de `.github/` e `scripts/regras/` antes. Os testes das regras rodam depois das regras, para um teste da PR não trocar o código que confere a própria PR.
- O check de registro confere texto, SHA e quem publicou (dono, membro ou colaborador); `Autor` e `Revisor` são os nomes que o registro declara. Se os agentes e o dono usam a mesma conta do GitHub, nenhuma máquina distingue uma revisão independente de uma auto-aprovação: quem mescla confere.
- A heurística de segredo pega padrões conhecidos e valores longos em campos como `senha` ou `token`; não pega todo segredo.
- Limites conhecidos das regras de código: `-->` logo depois de um `/* */` de várias linhas em JS não é visto como comentário; um `.plist` binário falha como código com byte nulo (converta com `plutil -convert xml1`); variantes de `rem` no `cmd.exe` (`@ rem`, `if x rem`) passam e `echo a ^& rem b` é falso positivo; a palavra `falso` dentro de um valor de segredo o isenta; `#!/usr/bin/env VAR=x cmd` conta como comentário; um symlink para uma pasta isenta passa; a API do GitHub devolve no máximo 3000 arquivos por PR, e acima disso o `Registro da PR` pode não ver um caminho sensível.
- Os testes das regras estão em `scripts/regras/test/` (`node --test "scripts/regras/test/*.test.js"`).
