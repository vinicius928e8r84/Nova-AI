# Como cada peça do PerpetualMiner entra na Nova-AI

Pesquisa do ticket [Pesquisa: como cada peça do PerpetualMiner entra na Nova-AI](https://github.com/vinicius928e8r84/Nova-AI/issues/135), do mapa [Nova-AI na nota 10 no CodeScene: o plano, com a fila de lotes e as regras que seguram](https://github.com/vinicius928e8r84/Nova-AI/issues/120). A decisão que usa este achado é [As regras que seguram a nota: o desenho que entra](https://github.com/vinicius928e8r84/Nova-AI/issues/136).

Feita em 23/11/2026. A Nova-AI foi lida na `main` em `1b45c3f`. O PerpetualMiner foi lido na `main` em `d4554151` (23/11 08:13), e a PR [A linha de base desce no merge: comando, regra e job](https://github.com/vinicius928e8r84/PerpetualMiner/pull/758) no head `465b2243`. Esta pesquisa não muda código de produto. Os testes rodaram num clone descartável da Nova-AI, fora do repositório, que já foi apagado.

## A resposta em poucas linhas

São cinco peças. Três já existem prontas na `main` do PerpetualMiner: os dois ganchos e o teto com a linha de base de tamanho, que juntos ficam em `scripts/ganchos/`. Uma está pronta numa PR aberta: a linha de base que desce no merge. A última ainda não foi escrita lá: o check da diretiva `@codescene`.

- **Teto, gancho de pre-commit e linha de base de tamanho.** O código do PerpetualMiner se copia quase inteiro. Ele só precisa de Node e git e lê o tamanho do índice do git, não da cópia de trabalho. Muda a lista do que fica de fora: o `dist/` do PerpetualMiner esconderia `app/dist/cam-live.js`, que é código vivo. Saem também os 13 comentários que a `sem-comentario-novo` da Nova-AI barraria, e o nome `limite-de-tokens`, que cai no glob `**/*token*` das credenciais. Rodei a ferramenta de verdade sobre a `main`: **a linha de base de partida tem 27 arquivos**, listados na seção 2.
- **Gancho de pre-push.** Ele chama `scripts/ci/autoria.js`, que a Nova-AI não tem, e por isso barra todo push. Basta tirar essa linha. O resto roda as regras da Nova-AI (`verificar.js --base`) do jeito que está; testei no Windows, no `bash` e no `dash` do Linux.
- **Linha de base que desce no merge.** Depende da PR #758 do PerpetualMiner. Ela está com os checks verdes e uma revisão CLEAN de outro agente, mas em conflito com a `main` de lá. Na Nova-AI, a `limite-de-linhas` precisa passar a aceitar folga, como a `saude-do-codigo` já aceita. O dono do commit vem de `autoria.js`, que a Nova-AI não tem.
- **Check da diretiva.** A issue [#803 do PerpetualMiner](https://github.com/vinicius928e8r84/PerpetualMiner/issues/803) está aberta e sem código, então não há o que copiar. Na Nova-AI, a diretiva numa linha nova **já é barrada** pela `sem-comentario-novo`; testei. O que passa hoje é `.codescene/code-health-rules.json`, e é isso que falta barrar.
- **`CODING_STANDARDS.md`.** Do que serve à Nova-AI, já estão no `CONTRIBUTING.md` a regra de comentário e a catraca. São novos: o arquivo curto para o revisor, os três níveis do veredito, "todo teste está no portão", "teste exercita a função e não o texto do código", "a PR diz a sua issue" e a linha de base que desce no merge. A regra do portão pega um buraco real: 10 testes passam no Windows e a CI não os roda.

**Ordem:** o check da `.codescene/` e o `CODING_STANDARDS.md` podem entrar já. Depois entram o teto e os dois ganchos numa PR só, com a linha de base gerada no dia do merge. Por último, a linha de base que desce no merge, depois da #758 do PerpetualMiner. Tudo isso entra antes do primeiro lote.

## Como foi feito

- **Fontes do PerpetualMiner:** os arquivos da `main` (`git show origin/main:<arquivo>`), principalmente `scripts/ganchos/` (`LEIA-ME.md`, `pre-commit`, `pre-push`, `instalar.mjs`, `limite-de-tokens.js` e `.json`, `linha-de-base-de-tamanho.json`, os módulos de apoio e os testes), `.github/workflows/regras.yml`, `e2e/package.json`, `scripts/testes.json` e `CODING_STANDARDS.md`. Também li a PR #758 (`gh pr view`, os arquivos do head `465b2243` e o diff de `docs/CODING_STANDARDS.md` e `AGENTS.md`) e a issue #803.
- **Fontes da Nova-AI:** `AGENTS.md`, `CONTRIBUTING.md`, `scripts/regras/` (`verificar.js`, `regra-linhas.js`, `linha-de-base.js`, `configuracao.json`, `caminhos-sensiveis.json`, `globs.js`, `escopo.js`), `.github/workflows/regras.yml`, `app/package.json`, `scripts/regras/analisador/package.json` e o mapa #120.
- **Fonte do CodeScene:** a página "Code Health" da documentação oficial ([codescene.io/docs/guides/technical/code-health.html](https://codescene.io/docs/guides/technical/code-health.html)). A mesma página vem embutida no servidor do painel, em `/docs/guides/technical/code-health.html`; foi lida ali com um GET sem token. As duas dizem o mesmo sobre as diretivas e sobre `.codescene/code-health-rules.json`. O token do painel não foi usado.
- **Os testes de verdade.** Fiz um clone raso da `main` da Nova-AI numa pasta temporária, copiei `scripts/ganchos/` do PerpetualMiner e rodei:
  1. `limite-de-tokens.js --gerar-linha-de-base` com a lista do que fica de fora adaptada à Nova-AI. É de onde sai a lista da seção 2.
  2. `instalar.mjs` e commits de verdade com o gancho ligado: um arquivo novo de 25 KB, o `main.js` crescendo, o `main.js` encolhendo, um teste de 25 KB e um arquivo que só passa de 20.000 bytes com CRLF. Tudo no Git Bash, e o mesmo commit pelo `cmd.exe` e pelo PowerShell.
  3. O `pre-push` do PerpetualMiner como está e o adaptado, contra um remoto local.
  4. Na VPS (Linux, git 2.43, Node 24), um repositório pequeno com os ganchos: o pre-commit com o modo `100644` e com o `100755`, e o pre-push adaptado no `bash` e no `dash`.
  5. Os nove testes de `scripts/ganchos/` do PerpetualMiner dentro do clone da Nova-AI.
  6. `verificar.js` da Nova-AI sobre os arquivos copiados, sobre uma diretiva `@codescene` nova e sobre um `.codescene/code-health-rules.json` novo.
  7. `npm ci --prefix scripts/regras/analisador`, com e sem `--ignore-scripts`, com um `prepare` acrescentado.
  8. `node --test` em cada teste de `MAC/` que a CI não roda.
- **O que não foi testado:** nada rodou num Mac. A máquina desta pesquisa é Windows e não há Mac no `~/.ssh/config`. O Linux da VPS faz as vezes do Mac no que é POSIX (o bit de execução e o `/bin/sh`); o que é próprio do macOS está marcado como não conferido.

## 1. Peça por peça

### 1.1 O teto de 20.000 bytes e o gancho de pre-commit

**Arquivos de origem** (PerpetualMiner, `main` em `d4554151`, tamanhos do blob):

| Arquivo | Bytes | O que faz |
| --- | ---: | --- |
| `scripts/ganchos/pre-commit` | 259 | `sh` que chama `node scripts/ganchos/limite-de-tokens.js`; sem `node`, avisa e deixa passar |
| `scripts/ganchos/limite-de-tokens.js` | 14.803 | o teto: lê o índice (`git diff --cached --raw`, `git cat-file --batch-check`), a lista do que fica de fora, a linha de base; modos `--base <ref>` (CI e pre-push), `--gerar-linha-de-base` e `--atualizar-linha-de-base` |
| `scripts/ganchos/limite-de-tokens.json` | 2.523 | `limiteDeBytes` 20000, `linhasDoCabecalho`, `marcasDeGerado` e `ignorar` (glob e motivo) |
| `scripts/ganchos/linha-de-base-de-tamanho.json` | 3.373 | caminho e bytes dos arquivos que já passavam; só desce |
| `scripts/ganchos/configuracao-do-indice.js` | 3.518 | lê a configuração do índice e barra o commit que a afrouxa |
| `scripts/ganchos/entrada-do-gancho.js` | 4.651 | valida o JSON da configuração e da linha de base |
| `scripts/ganchos/mensagens-de-tamanho.js` | 6.098 | a mensagem de "como dividir" por tipo de arquivo |
| `scripts/ganchos/globs.js` | 1.015 | glob para regex |
| `scripts/ganchos/LEIA-ME.md` | 7.372 | o manual |
| `scripts/ganchos/test_*.js` (oito, fora o do pre-push) | 48.792 | provas, com `assert` puro, rodadas por `scripts/testar.mjs ferramentas` |

O módulo é fechado em si: só usa `child_process`, `fs`, `path` e os próprios arquivos (`require` conferido em cada um). No clone da Nova-AI, sete dos oito testes do teto passaram sem mudança. O oitavo, `test_limite_de_tokens.js`, falhou num caso que lê a configuração de verdade: `dist/app.js` era `ignorado` no PerpetualMiner e passou a `excede` com a lista da Nova-AI. Isso é esperado, e o teste precisa ganhar os casos da Nova-AI.

**O que muda para o molde da Nova-AI:**

1. **A lista `ignorar`.** O `dist/` do PerpetualMiner casa com qualquer pasta `dist` e tiraria do teto `app/dist/cam-live.js` (93.959 bytes), que a Nova-AI cobra como código (`CONTRIBUTING.md`). Na primeira rodada da ferramenta no clone, foi exatamente isso: o arquivo sumiu da lista. Entram no lugar `app/dist/assets/` e `MAC/**/dist/`. Também saem `vendor/`, `third_party/`, `build/` e `coverage/`: o `CONTRIBUTING.md` diz que uma pasta com esses nomes fora dos lugares listados é código, e hoje nenhuma existe (`git ls-files`). Saem ainda as duas linhas do catálogo da Voz. Entram os testes, as cópias de reserva, os bundles e a licença. A lista inteira, com o motivo de cada linha, está na seção 2.3.
2. **`marcasDeGerado` vazia.** O PerpetualMiner isenta arquivo com `@generated`, `DO NOT EDIT` ou `Code generated` nas cinco primeiras linhas. A Nova-AI diz o contrário para o limite de linhas: "a marca `@generated` não isenta" (`CONTRIBUTING.md`, `limite-de-linhas`). Para as duas regras dizerem a mesma coisa, a lista fica vazia, e um arquivo gerado entra por glob em `ignorar`, com o motivo.
3. **Sem os 13 comentários.** O `verificar.js` da Nova-AI, rodado sobre a cópia, barrou 13 linhas de comentário: 3 em `instalar.mjs`, 3 em `limite-de-tokens.js` e 7 nos testes. A cópia sai sem eles.
4. **Dois testes acima da catraca.** A `saude-do-codigo` mede teste também. Arquivo novo nasce em 0, e `test_limite_de_tokens.js` tem 6 pontos e `test_pre_push.js` tem 11, os dois por complexidade no topo do arquivo (14 e 19, com limite 8). Eles precisam de corte na cópia.
5. **Os testes no molde da Nova-AI.** A CI roda `node --test "scripts/regras/test/*.test.js"`, e os testes do PerpetualMiner são `test_*.js` com `assert` solto. Eles passam a `scripts/ganchos/test/*.test.js` (o `node --test` aceita `assert` solto: o arquivo passa se sai com 0) e ganham uma linha no job.
6. **O nome.** Na Nova-AI, `limite-de-tokens.js` e `limite-de-tokens.json` casam com `**/*token*`, da lista `credenciais` de `scripts/regras/caminhos-sensiveis.json`. Toda PR que mexer neles conta como atenção ALTA por "credenciais", o que é falso. O `verificar.js` mostrou isso no clone. **Recomendo `limite-de-bytes`**, que é também o que o teto mede. A alternativa é estreitar o glob das credenciais, o que mexe numa regra mais sensível.
7. **A pasta vira caminho sensível.** `scripts/ganchos/**` entra na lista `regras-do-repositorio` de `caminhos-sensiveis.json`, ao lado de `scripts/regras/**` e `scripts/ci/**`: mexer no gancho é mexer nas regras.
8. **A CI usa o teto da base.** O job "Regras de revisão" da Nova-AI roda as regras da branch-alvo: ele extrai `scripts/regras` da base com `git archive` para a PR não conseguir afrouxá-las. O teto precisa da mesma proteção. O passo passa a extrair `scripts/regras scripts/ganchos` e roda `node "$GANCHOS_DIR/limite-de-bytes.js" --base "origin/$BASE"` **dentro do mesmo job**. Assim nenhum check obrigatório novo aparece e `scripts/regras/checks-obrigatorios.json` não muda. O PerpetualMiner roda o teto como um passo do mesmo job, "Limite de tamanho dos arquivos" (`regras.yml`, linha 37).
9. **O bit de execução.** No Windows, o `git add` grava `pre-commit` e `pre-push` com o modo `100644`, porque `core.filemode` é `false`; foi o que aconteceu no clone. No Linux, um gancho `100644` **não roda**: o git só avisa "The 'scripts/ganchos/pre-commit' hook was ignored because it's not set as executable" e o commit de 25 KB passou. Com `100755`, o mesmo commit foi barrado. O macOS segue a mesma regra do git, mas isso não foi conferido num Mac. A PR que cria os ganchos precisa gravá-los com `git add --chmod=+x`, e um teste deve conferir o modo com `git ls-files -s scripts/ganchos/pre-*`. No PerpetualMiner os dois são `100755`.
10. **O teto lê o índice, e isso importa no Windows.** O clone do Windows tem `core.autocrlf=true` (config do sistema do Git for Windows), e a cópia de trabalho ganha um byte por linha. O `main.js` tem 158.315 bytes no git e 162.598 no disco; o `Tweak.x` tem 85.710 e 87.297. Quem mede pelo disco no Windows conta a mais. O caso real é `app/electron/services/agent-swarm-controller.js`, com 19.566 bytes no git e 20.038 no disco. No teste, o arquivo foi aumentado até 19.956 bytes no índice (20.428 no disco) e o commit passou, porque a ferramenta do PerpetualMiner lê o blob. **A regra a manter é medir o blob, nunca a cópia de trabalho.** É também por isso que os números desta pesquisa divergem dos do mapa (seção 2.4).

**Depende do PerpetualMiner aberto:** nada. Está tudo na `main` de lá. A PR #758 muda três linhas de `limite-de-tokens.js` e uma de `mensagens-de-tamanho.js` (as mensagens passam a mandar esperar o merge). Isso só interessa à peça 1.3.

### 1.2 O gancho de pre-push

**Arquivo de origem:** `scripts/ganchos/pre-push` (1.537 bytes, `sh`), com o teste `scripts/ganchos/test_pre_push.js` (8.108 bytes). Para cada branch empurrada, fora a `main`, o gancho roda contra `<remoto>/main` (ou `origin/main`): `verificar.js --base`, `limite-de-tokens.js --base` e `scripts/ci/autoria.js`.

**O que muda para o molde da Nova-AI:**

1. **Sai a autoria.** A Nova-AI não tem `scripts/ci/autoria.js` (só tem `scripts/ci/codescene-na-refatoracao.js`). O gancho copiado como está **barrou todo push** no clone, com `Cannot find module '…\scripts\ci\autoria.js'`. Sem essa linha e sem as palavras "e de autoria" das mensagens, o gancho adaptado:
   - barrou a branch com um teste quebrado: `limite-de-linhas`, `sintaxe-valida` e `saude-do-codigo` falharam, e o push parou;
   - deixou passar a branch limpa: "regras ok (8)", e o git seguiu para o envio;
   - no Linux, barrou um arquivo de 25 KB que tinha sido commitado com `--no-verify`, no `bash` e no `dash`.
2. **O teste.** `test_pre_push.js` importa `../ci/autoria.js` e `../yaml-de-workflow.js`, que a Nova-AI não tem. Ele confere que o gancho roda cada conferência do job "Regras" que não lê o corpo da PR. Na Nova-AI, ele lê `.github/workflows/regras.yml` com o leitor que `scripts/regras/test/` já usa para conferir `checks-obrigatorios.json`.
3. **As ferramentas que faltam na máquina.** Sem ESLint e sem o analisador, o `verificar.js` da Nova-AI avisa e pula `eslint-nas-linhas-novas` e `saude-do-codigo` (aconteceu no clone). Então o pre-push só é "a CI antes da CI" se os dois estiverem instalados. O analisador se instala com o mesmo `npm ci` que liga os ganchos (seção 3). O ESLint, o `CONTRIBUTING.md` já manda instalar (`npm i -g eslint@9`); o `instalar.mjs` deve dizer quando ele falta. Com o analisador instalado, o `verificar.js` levou 0,7 s no clone.

**Depende do PerpetualMiner aberto:** nada. **Ordem:** entra junto com o teto, porque roda o teto com `--base`.

### 1.3 A linha de base que desce depois do merge

**Arquivos de origem** (PR #758, head `465b2243`, ainda não estão na `main` do PerpetualMiner):

| Arquivo | Bytes | O que faz |
| --- | ---: | --- |
| `scripts/regras/baixar-no-merge.js` | 4.554 | na `main` limpa: `verificar.js --base HEAD --atualizar` e `limite-de-tokens.js --atualizar-linha-de-base`; se algo desceu, um commit "Linha de base: desce no merge", só com os dois arquivos, com a autoria do dono e sem push |
| `scripts/regras/linha-de-base-no-merge.js` | 4.536 | a regra que barra a PR que edita as duas linhas de base à mão; deixa passar esse commit, a regra nova e a renomeação com o mesmo valor |
| `scripts/regras/apoio-de-linha-de-base.js` | 2.535 | o repositório de mentira dos testes |
| `scripts/ci/linha-de-base-refeita.js` | 4.614 | o job "Linha de base refeita": refaz o commit a partir do pai e compara as árvores |
| `scripts/regras/comum.js` | 14.983 | ganha `renomeacoes`, que antes estava em `verificar.js` |
| mudanças em `limite-de-linhas.js`, `saude-do-codigo.js`, `verificar.js` e nos ganchos | — | a folga passa a valer na PR, e as mensagens mandam esperar o merge |

**Estado da PR #758:** aberta, `mergeable: CONFLICTING`, com todos os checks verdes (Regras de revisão, Linha de base refeita, testes, e2e, CodeScene) e uma revisão CLEAN de outro agente no head `465b2243`. O conflito vem de `CODING_STANDARDS.md`, que voltou de `docs/` para a raiz na `main` de lá (`623cb2fe`, 23/11) enquanto a PR edita `docs/CODING_STANDARDS.md`. O corpo da PR diz que ela só mescla depois das PRs dos lotes 9 a 14 (#732 a #737).

**O que muda para o molde da Nova-AI:**

1. **A `limite-de-linhas` precisa aceitar folga.** Hoje, em `scripts/regras/regra-linhas.js`, um arquivo da linha de base que encolheu numa PR **falha** ("tem N linhas e a linha de base do ramo diz M: ajuste com --atualizar-linha-de-base"), e um que ficou abaixo de 1.000 também ("tire-o da linha de base"). Ou seja, a PR é obrigada a editar a linha de base. A `saude-do-codigo` (`regra-saude.js`) já faz o que a #758 quer: melhorar passa e só avisa que a linha de base pode descer. A mudança vale para a `limite-de-linhas`.
2. **Uma regra no molde `regra-*.js`.** A `linha-de-base-no-merge` vira `scripts/regras/regra-linha-de-base-no-merge.js`, registrada em `verificar.js`. Ela vigia as duas linhas de base da Nova-AI: as chaves `arquivos` e `saude-do-codigo` de `scripts/regras/linha-de-base.json` e a de tamanho que a peça 1.1 cria.
3. **A autoria.** `baixar-no-merge.js` importa `EMAIL_DO_DONO` de `scripts/ci/autoria.js`, que a Nova-AI não tem. É preciso decidir de onde vem o autor do commit: a identidade do git de quem roda ou uma constante nova. O job "Linha de base refeita" compara árvores, não autores, então funciona com qualquer uma das duas.
4. **O comando de atualizar.** No PerpetualMiner é `verificar.js --atualizar`; na Nova-AI é `--atualizar-linha-de-base`, com `--regra`.
5. **O job novo.** "Linha de base refeita" entra em `.github/workflows/regras.yml`. Se o dono quiser que ele seja obrigatório, o nome entra em `checks-obrigatorios.json`, cujo teste confere com os workflows. No PerpetualMiner ele ainda está fora dos obrigatórios: o corpo da #758 diz que incluí-lo é decisão do dono.
6. **O mesmo cuidado com a ordem.** Depois do merge, toda PR que editar a linha de base à mão é barrada. Os lotes abertos no dia precisam ter entrado antes, como a #758 exige das #732 a #737.

**Depende do PerpetualMiner aberto:** sim, da #758. Copiar o head de hoje traz o risco de copiar algo que o merge de lá ainda mude: o conflito e a "Prova que falta". **Ordem:** depois do teto, porque baixa as duas linhas de base, e depois do merge da #758.

### 1.4 O check que barra a diretiva `@codescene` e a configuração do CodeScene

**Origem:** a issue [#803](https://github.com/vinicius928e8r84/PerpetualMiner/issues/803), aberta e sem comentários. **Não há código para copiar.** A issue pede uma regra em `scripts/regras/` que recuse a diretiva `@codescene` em arquivo de código e um arquivo novo ou mudado em `.codescene/`, ou um `code-health-rules.json`. A exceção é a linha "exceção <regra> até AAAA-MM-DD, aprovada por <pessoa>: <motivo>".

**Por que importa** (documentação do CodeScene, igual na do servidor do painel): uma diretiva é "a source code comment instructing CodeScene to ignore a certain smell", como `// @codescene(disable:"Complex Method")` e `// @codescene(disable-all)`. E "the code health rules are customized by adding a .codescene/code-health-rules.json file to your Git repositories". As duas sobem a nota sem refatorar.

**O que a Nova-AI já barra, testado:**

- **A diretiva numa linha nova já é barrada.** Acrescentei `// @codescene(disable-all)` a `app/electron/services/ios-devices.js` no clone, e o `verificar.js` falhou em `sem-comentario-novo` ("comentário novo: “@codescene(disable-all)”"). A diretiva é um comentário, e a Nova-AI só deixa passar o `#!`, as diretivas de ferramenta listadas (`noqa`, `@ts-ignore`, `coding:`…) e o cabeçalho de licença.
- **`.codescene/code-health-rules.json` passa.** O mesmo `verificar.js` deu as oito regras verdes com esse arquivo novo, porque JSON não entra na regra de comentário.
- **Hoje:** `git grep @codescene` na `main` não acha nada, contando as cópias de reserva, e `git ls-files` não tem nenhum `.codescene/` nem `code-health-rules.json`.

**O que muda para o molde da Nova-AI:** uma regra pequena, `scripts/regras/regra-codescene.js`, com id `sem-config-do-codescene` ou parecido, que barra arquivo acrescentado ou mudado sob `.codescene/`, ou com nome `code-health-rules.json`, em qualquer pasta. A parte da diretiva pode ficar com a `sem-comentario-novo`, com um teste que a fixe: uma linha nova `@codescene` falha. A Nova-AI não tem a linha de exceção do PerpetualMiner, e a saída aprovada pelo dono é a de sempre: uma PR de regras, atenção ALTA, revisão do dono.

**Depende do PerpetualMiner aberto:** não. Esperar a #803 não traz nada, porque lá também não há código. **Ordem:** pode entrar já, sozinha.

### 1.5 Um `CODING_STANDARDS.md` curto para o revisor

**Arquivo de origem:** `CODING_STANDARDS.md` na raiz do PerpetualMiner (10.574 bytes; voltou de `docs/` em `623cb2fe`). Em inglês: 16 regras numeradas, mais a tabela "Open the surface's skill first" e a seção "What blocks a merge". A #758 acrescenta a regra 17 e muda a 16.

**O que muda para o molde da Nova-AI:** o arquivo sai em pt-BR, pela convenção da seção 6 do `AGENTS.md`, só com as regras que servem; a comparação está na seção 4. Ele aponta para o `CONTRIBUTING.md` em vez de repeti-lo. As regras que a máquina confere continuam lá, e o `CODING_STANDARDS.md` fica com o que o revisor julga.

**Depende do PerpetualMiner aberto:** só a regra 17, que vem da #758. **Ordem:** pode entrar já, sem a regra 17. Ela entra com a peça 1.3.

### 1.6 A ordem

| # | O que entra | Depende de | Por quê |
| --- | --- | --- | --- |
| 1 | Regra `.codescene/` e o teste que fixa a diretiva na `sem-comentario-novo` | nada | pequena; fecha a única porta aberta hoje |
| 2 | `CODING_STANDARDS.md`, sem a regra 17 | nada | documento; o revisor dos lotes já precisa dele |
| 3 | Teto, pre-commit, pre-push, `instalar.mjs`, o `prepare` do analisador, o passo na CI e a linha de base de tamanho | as PRs em voo que encolhem arquivos (a limpeza de comentários, a [#101](https://github.com/vinicius928e8r84/Nova-AI/pull/101) e a saída dos protótipos da [#131](https://github.com/vinicius928e8r84/Nova-AI/issues/131)) | a linha de base se gera com `--gerar-linha-de-base` no dia, sobre a `main` de então; cada arquivo que encolher antes entra com o teto mais baixo, e os protótipos que saírem antes não entram |
| 4 | A linha de base que desce no merge, com a regra 17 | o merge da [#758](https://github.com/vinicius928e8r84/PerpetualMiner/pull/758) e a peça 3 | baixa as duas linhas de base; sem lote aberto no dia |
| — | O primeiro lote | 1 a 4 | o lote já nasce com o teto, os ganchos e a linha de base fora do caminho do merge |

As quatro são PRs de ferramenta, de atenção ALTA, porque mexem em `scripts/regras/**`, `.github/**` ou, com a mudança da peça 1.1, `scripts/ganchos/**`.

## 2. O teto: a linha de base de partida

### 2.1 O que conta como produto, ferramenta e teste

- **Produto:** o que roda na máquina do usuário ou no aparelho. É o app em `app/electron/**`, o código escrito à mão de `app/dist/` (`cam-live.js`, `cam-live-audio.js`, `index.html`), a página do PWA (`app/electron/pwa/*`) e o que se instala no iPhone ou no Mac a partir de `MAC/**` (`Tweak.x`, os `.m`, os `.sh` instalados).
- **Ferramenta:** o que roda na máquina de quem desenvolve ou na CI: `scripts/**`, `app/scripts/**`, os scripts de patch e de empacotamento de `MAC/**` (`aplicar*.py`, `empacotar-*.sh`, `gerar-*.py`).
- **Teste (fora do teto):** pastas `test/`, `tests/`, `teste/` e `testes/` em qualquer lugar (com os `*.palco.js`, `*.cenas.js`, `*.esperado.json` e ajudantes que moram nelas), arquivos `*.test.*` e `teste-*`, e `fixtures/`.
- **Documentação:** o dono decidiu "produto e ferramenta" e não disse nada sobre documentação. O PerpetualMiner conta documentação (`MAC/LEIA-ME.md` teria par lá: `docs/design/auditoria/README.md` está na linha de base dele). **Recomendo contar.** O teto existe porque o agente lê o arquivo inteiro, e o agente lê a documentação. Com essa escolha, só `MAC/LEIA-ME.md` entra na lista. Fica para a #136 confirmar.

Produto e ferramenta seguem a mesma regra. A diferença só serve para ler a lista.

### 2.2 A lista de partida

Gerada por `limite-de-tokens.js --gerar-linha-de-base`, com a lista `ignorar` da seção 2.3, sobre a `main` em `1b45c3f`. Os tamanhos são do blob do git. São **27 arquivos**:

| Arquivo | Bytes | Tipo |
| --- | ---: | --- |
| `app/electron/main.js` | 158.315 | produto |
| `app/electron/services/physicalMobileService.js` | 115.926 | produto |
| `app/dist/cam-live.js` | 93.959 | produto |
| `MAC/integracao-iphone/bridge/Tweak.x` | 85.710 | produto (iPhone) |
| `app/electron/services/browserFarmService.js` | 80.631 | produto |
| `app/electron/services/global-spoof-service.js` | 79.789 | produto |
| `app/electron/services/whatsapp-manager.js` | 38.698 | produto |
| `app/electron/services/cam-live-service.js` | 32.464 | produto |
| `app/electron/pwa/admin.html` | 31.383 | produto (HTML) |
| `app/electron/services/child-worker-agent.js` | 30.655 | produto |
| `app/electron/services/telegram-manager.js` | 28.711 | produto |
| `app/electron/services/remote-access.js` | 27.685 | produto |
| `app/electron/services/kling-video-service.js` | 25.868 | produto |
| `app/electron/nova-grab-extension/content.js` | 25.353 | produto |
| `app/electron/services/live-cam-paginas.js` | 24.966 | produto |
| `app/electron/services/cam-live-iphone.js` | 24.507 | produto |
| `app/electron/services/browser-manager.js` | 23.125 | produto |
| `app/electron/services/iphone-setup/inapp.js` | 22.864 | produto |
| `app/electron/services/gemini-browser-engine.js` | 22.822 | produto |
| `app/electron/services/live-cam-bridge.js` | 21.388 | produto |
| `app/electron/services/ytdlp-manager.js` | 21.283 | produto |
| `app/electron/services/antigravity-controller.js` | 21.266 | produto |
| `MAC/controle-celular-plataformas/aplicar.py` | 28.093 | ferramenta (patch do bundle) |
| `MAC/integracao-iphone/conexao-usb/aplicar-identidade.py` | 20.607 | ferramenta (patch do bundle) |
| `prototype-cam-live/index.html` | 115.318 | protótipo; sai pela [#131](https://github.com/vinicius928e8r84/Nova-AI/issues/131) |
| `prototype-cam-live/index.antigo-simulado.html` | 65.301 | protótipo; sai pela [#131](https://github.com/vinicius928e8r84/Nova-AI/issues/131) |
| `MAC/LEIA-ME.md` | 132.638 | documentação (seção 2.1) |

São 22 de produto, 2 de ferramenta, 2 protótipos e 1 documento. Se os protótipos saírem antes do teto, como a #131 propõe, a lista fica com 25. Sem contar documentação, fica com 24.

**Logo abaixo do teto:** `app/electron/services/agent-swarm-controller.js` tem 19.566 bytes e só pode crescer 434. Quem medir pelo disco no Windows o vê acima (seção 1.1, item 10).

**Fora da lista por serem teste** (sete arquivos de código acima de 20.000 bytes): `app/electron/services/test/browser-manager.cenas.js` (30.556), `inventory-manager.cenas.js` (30.125), `browser-manager.palco.js` (23.043), `celular-fisico-adb.test.js` (27.599), `telegram-manager.test.js` (38.655), `app/electron/services/testes/remote-access.test.js` (35.580) e `scripts/regras/test/saude.test.js` (26.011). Além deles, há os dados de teste em JSON, como `browser-manager.esperado.json` (732.916) e `inventory-manager.esperado.json` (719.338).

### 2.3 O que fica de fora, com o motivo

Esta é a lista `ignorar` usada para gerar a seção 2.2, já sem as quatro linhas que não casam com nada na Nova-AI (`vendor/`, `third_party/`, `build/`, `coverage/`). Tirá-las não muda o resultado, porque nenhum arquivo casava com elas.

| Glob | Motivo |
| --- | --- |
| `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `*.lock` | trava de pacotes, escrita pela ferramenta (`app/package-lock.json` tem 340.434 bytes) |
| `*.min.*` | arquivo minificado de terceiros (`app/electron/pwa/marked.min.js`) |
| `*.map` | source map |
| `node_modules/` | dependências de terceiros |
| `app/dist/assets/` | bundle minificado da interface e bibliotecas de terceiros (face-api, MediaPipe); o resto de `app/dist/` é código |
| `MAC/**/dist/`, `MAC/**/index-Dun7lr2S*.js` | o bundle gerado da interface e os patches dele (`index-Dun7lr2S.patched.js`, 7,7 MB) |
| `MAC/**/reservas/`, `MAC/**/backup-*/`, `backup-antes-traducao/` | cópia de reserva (`AGENTS.md` seção 5). Saem da lista quando a [#101](https://github.com/vinicius928e8r84/Nova-AI/pull/101) apagar as cópias |
| `test/`, `tests/`, `teste/`, `testes/`, `*.test.*`, `teste-*` | teste, fora do teto por decisão do dono |
| `fixtures/` | dados de teste (`MAC/integracao-camlive/test/fixtures/`) |
| `LICENSE` | texto da licença, copiado como é (34.523 bytes) |
| imagem, fonte, pacote, áudio, vídeo e PDF por extensão, mais qualquer arquivo com byte nulo nos primeiros 8.000 bytes | binário. Pega os `.wav` de `app/audio/`, `app/dist/audio/` e `app/public/audio/`, os `.png` e `.ico`, os modelos `.bin` de `app/dist/models/`, os PDFs de `GUIA/` e os seis `.mp4` de `app/youtube_auto/exports/` |

Ela diz o mesmo que `ignorarCodigo` de `scripts/regras/configuracao.json`, mais os testes, a licença e os binários. Se a #136 quiser uma fonte só, o teto pode ler `ignorarCodigo` e acrescentar só o que é dele. Nesse caso vale o teste de `exclusoes.test.js`, que exige que cada glob case com algum arquivo vivo.

**Achado à parte:** os seis vídeos de `app/youtube_auto/exports/` (7,6 MB no total) estão versionados. A `sem-binario-nem-lixo` não proíbe `.mp4`. Não é assunto deste mapa.

### 2.4 Por que o mapa diz 34 e aqui são 33

O mapa diz "34 arquivos vivos passam de 20.000 bytes; 9 deles são de teste". Medindo pelo disco deste clone do Windows, com CRLF, chego aos mesmos 34 arquivos de código (`wc -c` sobre `git ls-files`). Medindo pelo blob, que é o que o gancho e a CI medem, são 33: `agent-swarm-controller.js` só passa no disco. Desses 33, 7 são teste, 24 são produto e ferramenta, e os outros 2 são os protótipos. A diferença entre os 9 testes do mapa e os 7 daqui não foi rastreada. Somando `MAC/LEIA-ME.md`, que não é código, chega-se aos 27 da lista.

## 3. Como os ganchos se ligam num clone

O mecanismo é o do PerpetualMiner: `node scripts/ganchos/instalar.mjs` grava `git config core.hooksPath scripts/ganchos` no clone. Ele não troca uma pasta de ganchos que já esteja configurada, não faz nada na CI (`process.env.CI`) e lista os ganchos de `.git/hooks` que deixam de rodar.

**Quem chama o `instalar.mjs` sozinho.** No PerpetualMiner é o `prepare` de `e2e/package.json`. A Nova-AI não tem `package.json` na raiz. Há dois candidatos:

- **`scripts/regras/analisador/package.json` (recomendado).** É o `npm ci` que o `CONTRIBUTING.md` já manda rodar uma vez para a `saude-do-codigo`, e é ferramenta, não produto. Testado no clone, com `"scripts": {"prepare": "node ../../ganchos/instalar.mjs"}`:
  - `npm ci --no-audit --no-fund --prefix scripts/regras/analisador` imprimiu "ganchos ligados (core.hooksPath = scripts/ganchos)";
  - a segunda vez imprimiu "ganchos já ligados";
  - com `--ignore-scripts`, que é como a CI da Nova-AI chama esse `npm ci`, não ligou nada.

  Ligar os ganchos e instalar o analisador viram o mesmo passo, e isso também resolve o pre-push sem analisador (seção 1.2).
- **`app/package.json`.** Não recomendo. É produto, está em `caminhos-sensiveis.json` (dependências), já tem `postinstall`, e o `npm install` do app roda nas máquinas de build e de prova, não só na de quem desenvolve.

Num clone que já existe, ou sem `npm`: `node scripts/ganchos/instalar.mjs`, uma vez.

**Worktrees.** `git config` sem escopo grava na configuração comum do repositório, e por isso todos os worktrees de um clone passam a usar os ganchos. O caminho relativo `scripts/ganchos` é lido a partir da raiz de cada worktree. Isso vem da documentação do git (`core.hooksPath` em `git help config`) e **não foi testado**, para não mexer na configuração do clone de verdade da Nova-AI, que vários agentes usam.

### 3.1 No Windows (testado)

- Git for Windows 2.54 e Node 24.15, no Git Bash. O git roda os ganchos com o `sh` que vem com ele, então o comando `git` funciona igual chamado do PowerShell e do `cmd.exe`. Testei os três: o commit de 25 KB foi barrado nos três, e no `cmd.exe` o commit não entrou (`git log` continuou no anterior).
- O pre-commit e o pre-push rodaram com CRLF na cópia de trabalho (`file` mostrou "with CRLF line terminators"). Não é preciso `.gitattributes` para eles no Windows.
- O tamanho vem do índice, sem a conversão CRLF (seção 1.1, item 10).
- O bit de execução se perde ao commitar do Windows (item 9). A PR que cria os ganchos precisa de `git add --chmod=+x scripts/ganchos/pre-commit scripts/ganchos/pre-push`, senão os ganchos não rodam no Mac.
- O pre-push depende do `origin/main` local. Com ele velho, os commits que a `main` ganhou contam como da branch. O `LEIA-ME.md` do PerpetualMiner já avisa: `git fetch origin main`.

### 3.2 No Mac (não testado num Mac)

- Mesmo comando: `npm ci --prefix scripts/regras/analisador` ou `node scripts/ganchos/instalar.mjs`.
- **O bit de execução é obrigatório.** O git ignora um gancho sem ele e só avisa. Testado no Linux da VPS: com `100644`, o commit de 25 KB passou com a dica "hook was ignored because it's not set as executable"; com `100755`, foi barrado. O git do Mac tem o mesmo comportamento, mas isso não foi conferido num Mac.
- O `/bin/sh` dos ganchos: o pre-push adaptado rodou igual no `bash` e no `dash` do Linux. O do Mac é outro `sh` e não foi testado.
- **O `node` no PATH do git.** O gancho procura `node` com `command -v node` e, sem ele, avisa e deixa passar. Quem commita por um aplicativo gráfico de git no Mac pode não ter o `node` do Homebrew ou do `nvm` no PATH, e o gancho passa calado. Não conferido.
- Os testes da CI rodam em `ubuntu-24.04`, não em macOS. O teto e o pre-push só usam Node e git, sem nada próprio do sistema.

## 4. O que do `CODING_STANDARDS.md` é novo em relação ao `CONTRIBUTING.md`

Regra por regra do `CODING_STANDARDS.md` da `main` do PerpetualMiner, mais a 17 da #758. "Já coberto" quer dizer que o `CONTRIBUTING.md` da Nova-AI diz o mesmo ou mais.

| Regra do PerpetualMiner | Na Nova-AI |
| --- | --- |
| Abertura: "what the reviewer enforces… anything not listed here follows the surrounding code" | **Novo.** O `CONTRIBUTING.md` diz o que a máquina confere; não há uma lista curta do que o revisor julga, nem a regra de seguir o código em volta |
| "Open the surface's skill first" (tabela arquivo → skill) | **Novo em espírito, não serve como está.** A Nova-AI não tem skills no repositório. O que serve é a tabela de "o diff toca X → leia Y": `MAC/LEIA-ME.md`, `docs/windows.md`, o README da área e o ADR da decisão |
| 1 a 6: textos da Voz, tokens do Veio, componentes, `html-cru`, `IDIOMAS`, status verdadeiro | Não serve (o mapa já tirou a Voz, o Veio e as regras do DOM da extensão) |
| 7: escrita de `frases` pelo `Historico` | Não serve (armazenamento da extensão) |
| 8: e2e confere a tela e o que ficou guardado; relógio parado | Não serve como está (não há e2e na Nova-AI). O princípio "o teste compara com um valor concreto" já está nas caracterizações `palco`/`cenas`/`esperado` |
| 9: teste novo de Python exercita a rota ou a função, **nunca o texto do código** | **Novo e serve.** A Nova-AI tem testes que leem o texto do fonte, como os testes de texto do código do iPhone na CI (pesquisa [#133](https://github.com/vinicius928e8r84/Nova-AI/issues/133)) e o `botao.test.cjs`, que confere o bundle. A regra vale para teste novo, em qualquer linguagem |
| 10: referência visual só com aprovação do dono | Não serve |
| 11: arquivo novo ganha linha em `docs/arquivos/` e é carregado onde é usado | **Novo em parte.** A Nova-AI não tem `docs/arquivos/`. Serve a metade "arquivo novo é carregado onde é usado" (o `require` no `main.js`, o `preload`, o `package.json` do build), que importa nos cortes |
| 12: **todo teste está num grupo, e a CI só roda os grupos** | **Novo e serve, com um buraco real.** A CI da Nova-AI roda globs de `app/` e `scripts/regras/test/` e uma lista fixa de nove testes de `MAC/`. Rodei com `node --test` os testes de `MAC/` e da raiz que ficam de fora. Passaram no Windows e ninguém roda: `conexao-usb/botao.test.cjs`, `botao-servico.test.cjs` e `windows-hide.test.cjs`, `tests/android-install.cjs`, `chave-de-host.cjs`, `ios-tools-windows.cjs`, `routing.cjs` e `wireless.cjs`, `geo-proxy/teste-geo.cjs` e `prototype-proxy-tipo/teste-proxy-parse.js`. Falharam no Windows, e não investiguei se pedem Mac: `integracao-camlive/test/iphone-media.cjs` (2 de 3), `tests/relay.cjs`, `integracao-kling/test/teste-motor-local.cjs`, `teste-movimento.cjs` e `navegador-mac/tests/navegador.cjs` (1 de 7). Os `.m` e `.sh` de teste do iPhone pedem Mac. A regra pede um portão: a lista de grupos e um teste que falha quando um arquivo de teste fica fora |
| 13: contrato da Conexão com o Anki | Não serve |
| 14: nenhum comentário novo | **Já coberto** (`sem-comentario-novo`, com mais linguagens que o PerpetualMiner). A Nova-AI é mais estrita: `eslint-disable` não passa e não há linha de exceção |
| 15: **a PR diz a sua issue** (`Closes <URL>`, `Refs <URL>`, `Prova que falta:`, `Sem issue`), cobrado pelo Registro da PR | **Novo.** O Registro da PR da Nova-AI cobra Descrição, Atenção, Prova real e Revisão, mas não a issue. A Nova-AI fecha a prova pendente com issues "Prova real pendente" abertas à mão (27 hoje), e `Prova que falta:` + `Closes` faria isso no corpo da PR |
| 16: a nota não piora; refatorar de verdade; **nem diretiva `@codescene`** | **Já coberto** (`saude-do-codigo`, com a mesma lista do que é e do que não é refatorar), menos a menção à diretiva. A diretiva numa linha nova já é barrada pela `sem-comentario-novo` (seção 1.4) |
| 17 (#758): a linha de base desce no merge, não na PR | **Novo**; depende da peça 1.3 |
| "What blocks a merge": **bloqueia** um achado ALTA ou uma regressão contra a `main`; **conserta se for barato** um MÉDIA novo; **vira issue** o resto | **Novo.** A "Atenção" da Nova-AI mede o risco da mudança (pede prova real), não o peso do achado do revisor. O `Veredito` do registro só diz CLEAN ou não; não há regra do que trava o merge |

Resumindo o que é novo e serve: a lista curta do revisor, as regras 9, 12, 15 e 17, a metade de "carregar onde é usado" da 11 e os três níveis do veredito. Isso dá um arquivo bem menor que os 10.574 bytes do PerpetualMiner.

## 5. O que fica para a decisão [#136](https://github.com/vinicius928e8r84/Nova-AI/issues/136)

Cada item com a minha recomendação:

1. **Documentação no teto.** Recomendo contar (só `MAC/LEIA-ME.md` entra).
2. **O nome do teto.** Recomendo `limite-de-bytes`, para não cair no glob de credenciais.
3. **Onde mora o teto.** Recomendo `scripts/ganchos/`, como no PerpetualMiner, protegida como as regras: extraída da base na CI e listada em `caminhos-sensiveis.json`. Reescrever como `regra-*.js` em `scripts/regras/` também serve, mas perde os testes prontos e a leitura do índice que o pre-commit precisa.
4. **Uma lista `ignorar` só ou duas.** Recomendo a do teto ler `ignorarCodigo` de `configuracao.json` e só acrescentar testes, licença e binários.
5. **A autoria do commit da linha de base.** Recomendo a identidade do git de quem roda, enquanto a Nova-AI não tiver uma regra de autoria.
6. **O job "Linha de base refeita" obrigatório ou não.** Recomendo obrigatório. A Nova-AI tem uma conta só, e o check é o que distingue o commit da ferramenta de uma edição à mão.
7. **O portão dos testes (regra 12).** É uma PR de ferramenta própria, fora das cinco peças. Os dez testes que passam e ninguém roda devem entrar na CI antes dos cortes que eles cobrem (`conexao-usb/` e `integracao-iphone/tests/`).

## Fontes

- PerpetualMiner, `main` em `d4554151`: [`scripts/ganchos/`](https://github.com/vinicius928e8r84/PerpetualMiner/tree/main/scripts/ganchos), [`CODING_STANDARDS.md`](https://github.com/vinicius928e8r84/PerpetualMiner/blob/main/CODING_STANDARDS.md), [`.github/workflows/regras.yml`](https://github.com/vinicius928e8r84/PerpetualMiner/blob/main/.github/workflows/regras.yml), [`e2e/package.json`](https://github.com/vinicius928e8r84/PerpetualMiner/blob/main/e2e/package.json), [`scripts/testes.json`](https://github.com/vinicius928e8r84/PerpetualMiner/blob/main/scripts/testes.json).
- PerpetualMiner: PR [#758](https://github.com/vinicius928e8r84/PerpetualMiner/pull/758) (head `465b2243`), issue [#803](https://github.com/vinicius928e8r84/PerpetualMiner/issues/803), issue [#729](https://github.com/vinicius928e8r84/PerpetualMiner/issues/729).
- Nova-AI, `main` em `1b45c3f`: `AGENTS.md`, `CONTRIBUTING.md`, `scripts/regras/` (`verificar.js`, `regra-linhas.js`, `regra-saude.js`, `linha-de-base.js`, `configuracao.json`, `caminhos-sensiveis.json`), `.github/workflows/regras.yml`, `scripts/regras/analisador/package.json`, `app/package.json`.
- CodeScene, "Code Health": [codescene.io/docs/guides/technical/code-health.html](https://codescene.io/docs/guides/technical/code-health.html), e a mesma página no servidor do painel (versão 7.5.20), em `/docs/guides/technical/code-health.html`.
- git: `git help config` (`core.hooksPath`) e `git help githooks`; o comportamento do gancho sem bit de execução foi observado no git 2.43 do Linux.
