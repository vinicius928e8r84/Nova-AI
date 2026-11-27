# O que o painel e as regras fazem com um arquivo que muda de pasta

Resposta da [Pesquisa: o que o painel e as regras fazem com um arquivo que muda de pasta](https://github.com/vinicius928e8r84/Nova-AI/issues/195), do mapa [Pastas com nomes em português](https://github.com/vinicius928e8r84/Nova-AI/issues/194).

Medido sobre a `main` em `2eb4212`, com o painel na análise 164 (a mais nova, sobre o mesmo commit). As regras rodaram num clone descartável, com `git mv` de verdade da árvore proposta inteira (146 arquivos, todos `R100`). O painel só foi lido (GET).

## Resposta curta

1. **O painel segue o arquivo.** A nota, o hotspot e o histórico de mudanças vão para o caminho novo, e o caminho velho some da lista. Isso vale desde que o `git mv` fique num commit só. A lista de exclusões do painel não muda. O check `CodeScene Code Health Review (main)` de uma PR que só move arquivos deve ficar verde.
2. **Hoje as regras pedem `--atualizar-linha-de-base`.** Sem ela, `saude-do-codigo` falha em 19 arquivos e `limite-de-linhas` falha no `Tweak.x`. A `teto-de-comentarios` só avisa. Depois da [Catracas sem lista](https://github.com/vinicius928e8r84/Nova-AI/issues/179), o teto vai junto com o `git mv` e não há lista para editar.
3. **O bloqueio de verdade é `configuracao.json`.** O CI roda as regras da `main`, e não as da PR. Por isso o bundle `MAC/integracao-iphone/conexao-usb/dist/index-Dun7lr2S.patched.js`, ao sair de `MAC/**/dist/`, faz 8 regras falharem. E isso acontece mesmo que a PR da troca conserte os globs. Os globs novos precisam entrar na `main` **antes**, numa PR própria de regras.
4. **Atenção ALTA:** a PR da troca é ALTA pela **origem**, porque o `Registro da PR` olha o nome antigo e o novo. Ela também é ALTA por alguns destinos. Depois do merge, 84 arquivos deixam de ser ALTA, se `caminhos-sensiveis.json` não ganhar as pastas novas.

## 1. O painel (CodeScene da VPS, projeto 2)

### O que a documentação diz

- "CodeScene tracks renamed content. That is, if you move or rename a file, we make sure to fetch its past history even if you've renamed the file multiple times." ([X-Ray, "Know the limitations of Method-level analyses"](https://codescene.io/docs/guides/technical/xray.html))
- "Normal file renames work fine, but if the deletion step and the adding of the new file are performed in separate commits then CodeScene won't be able to maintain the link". As metas (goals) de um hotspot movido viram "Lost Notes" nesse caso. ([Augmented analysis, "Know The Edge Cases When Tracking Hotspots"](https://codescene.io/docs/guides/technical/augmented-analysis.html))
- As exclusões são globs com o nome do repositório na frente. `**` casa qualquer pasta. ([Project configuration, "Exclude Specific Files and Folders" e "A Brief Guide to Glob Patterns"](https://codescene.io/docs/configuration/project-config/index.html))

### O que o painel mostra hoje

O repositório tem uma só mudança de nome de código na história: `app/electron/services/android-tools-mac.js` → `android-tools.js`, no commit `dd37822`, com 63% de semelhança, na PR #15.

| Onde | O que aparece | Leitura |
| --- | --- | --- |
| Arquivos da análise 164 (`/api/v2/projects/2/analyses/164/files`) | `android-tools.js` com `change_frequency` 7 e `hotspot: true`; o nome antigo não aparece | `git log --no-merges` dá 4 commits no nome novo e 7 com `--follow`: o painel conta a história inteira |
| Delta da PR #15 (`/api/v2/projects/2/delta-analyses/467`, base `95510aa`) | `android-tools.js` com `old_loc` 192 e `old_code_health` 8,65 | Na base só existia `android-tools-mac.js` (209 linhas): a comparação usou o arquivo antigo, e não tratou o novo como arquivo novo |
| Check da PR #15 (head `87d2305`) | `CodeScene Code Health Review (main)`: `success` | O check aceitou o arquivo de nome trocado |

O painel lê hoje 34 arquivos de `MAC/`, e 28 deles têm nota. Depois da troca, eles aparecem com o caminho novo e com a mesma nota e a mesma frequência de mudança. Como o hotspot depende da frequência, ele também não muda. A tendência por arquivo (`month_score` e `year_score`) ainda está "-" em todos os arquivos, porque o projeto tem menos de um mês. Então a tendência não tem nada a perder agora.

### A lista de exclusões (`docs/codescene-exclusoes.md`)

**Não muda.** As quatro linhas não citam `MAC/`: `Nova-AI/**/index-Dun7lr2S*.js` casa o bundle em qualquer pasta, e as outras três apontam para `app/`. `scripts/regras/test/exclusoes.test.js` passou (5 de 5) na árvore nova, já com os globs da seção 3. Só o texto da tabela ("as cópias dele em `MAC/`") e o parágrafo sobre `MAC/**/reservas/` ficam velhos. Isso é só texto.

### O check da PR que só move

Ele deve ficar verde: com `R100`, a nota de cada arquivo não muda, e o delta compara com o arquivo antigo (como na #15). Essa parte é inferida e não provada: nenhuma PR só de `git mv` passou pelo painel, e provar exigiria abrir uma PR. Há duas condições:

- **Um commit só com o `git mv`.** As PRs entram por `--no-ff`, então os commits da branch ficam na história da `main`. Um commit que apaga e outro que cria quebram o elo, como diz a documentação.
- **Mover sem editar no mesmo commit.** O que mudar de conteúdo vai em outro commit. A troca de caminhos dentro de um arquivo movido pode ir junto, se o arquivo continuar parecido o bastante (acima de 50%) para o git ver a mudança de nome.

## 2. As regras (`scripts/regras/`)

### Hoje (com a linha de base)

| Experimento no clone (base `2eb4212`) | Resultado |
| --- | --- |
| E1: só `MAC/proxy-iphone` → `iphone/proxy` (22 arquivos `.m`, `.h`, `.sh`, `.plist`) | `regras ok (11)`; 15 avisos de `teto-de-comentarios` dizendo que a entrada antiga pode sair |
| E3: a árvore inteira, sem tocar em mais nada | 8 regras falham (o bundle, ver seção 3); `saude-do-codigo` falha em 19 arquivos `.py`/`.js` ("o arquivo veio de MAC/…: leve a entrada para o nome novo"); `limite-de-linhas` falha em `iphone/camera/Tweak.x` ("saiu da linha de base") e em `MAC/integracao-iphone/bridge/Tweak.x` ("não existe mais neste caminho") |
| E4a: a árvore inteira sobre uma `main` que já tem os globs novos, rodando **as regras da base** como o CI | 2 regras falham: `saude-do-codigo` (os mesmos 19) e `limite-de-linhas` (`Tweak.x`) |
| E4b: E4a + `verificar.js --atualizar-linha-de-base` (a linha de base vai no mesmo commit) | `regras ok (11)`; `linha-de-base.json`: `arquivos` 6 → 6, `saude-do-codigo` 54 → 54 (19 nomes trocados), `comentarios` 117 → 58 |

Cada regra faz o seguinte, segundo o código:

- **`limite-de-tamanho`** (bytes) já não tem lista. Com `R`, o teto é o tamanho do nome antigo na base (`origemNaBase`, em `regra-tamanho.js`). Ela passa sem nada.
- **`teto-de-comentarios`** passa sem editar nada: o teto é a contagem do nome antigo na base (`tetoDe`, em `regra-teto-de-comentarios.js`). A entrada velha só gera aviso. As 59 entradas que saíram com o `--atualizar` já estavam em 0 na `main`: lá, 112 das 117 entradas de `comentarios` contam 0 hoje.
- **`saude-do-codigo`** falha. Em `permitidoPara`, um arquivo `R` cuja entrada ainda está no nome antigo recebe folga 0. O `--atualizar` passa a entrada para o nome novo.
- **`limite-de-linhas`** falha por dois motivos: o arquivo novo "saiu da linha de base", e o nome antigo continua listado. O `--atualizar` troca a chave.
- As outras regras só olham linhas acrescentadas. Um `R100` não acrescenta nenhuma, então elas passam, menos no caso da seção 3.

Num arquivo que fica `D` + `A` (movido e muito editado, abaixo de 50% de semelhança), as regras usam `git diff -M`, o padrão de 50%. Então ele é tratado como arquivo novo: 1000 linhas, 0 comentário, 0 ponto e 20000 bytes.

### Depois da [Catracas sem lista](https://github.com/vinicius928e8r84/Nova-AI/issues/179)

O ticket pede exatamente o caso da troca: "Com `git mv`, o arquivo leva o teto. Uma cópia não leva". A folga é medida "no blob da base; com `git mv`, no nome antigo". Também saem `--atualizar-linha-de-base` e a lista. Pelo código de hoje, falta pouco. A `teto-de-comentarios` e a `limite-de-tamanho` já leem o nome antigo. A `saude-do-codigo` e a `limite-de-linhas` só precisam medir o blob de `item.antigo` em vez da entrada da lista. Com a ordem do mapa (a #179 entra entre as PRs de preparação, antes da troca), **a PR da troca passa sem editar nenhuma lista**. Continua valendo a condição do `R`: se o git não vir a mudança de nome, o arquivo é tratado como novo.

Isso é leitura do ticket e do código: a #179 ainda não tem PR.

## 3. Os globs que param de casar

O `regras.yml` e o `registro-da-pr.yml` copiam `scripts/regras/` da **branch-alvo** (`git archive "origin/$BASE" scripts/regras`). O `verificar.js` lê `configuracao.json` e `caminhos-sensiveis.json` da própria pasta. Só a linha de base vem da PR (`ctx.ler`, na raiz da PR). Então mudar um glob na PR da troca não vale para a própria PR.

### `configuracao.json`

| Glob | Casa hoje | Na árvore nova | Efeito na PR que move |
| --- | --- | --- | --- |
| `MAC/**/dist/` e `MAC/**/index-Dun7lr2S*.js` | `MAC/integracao-iphone/conexao-usb/dist/index-Dun7lr2S.patched.js` (7,7 MB, 2582 linhas) | nada | O arquivo "sai da isenção" (`saiuDaIsencao`, em `git.js`), e todas as linhas dele contam como novas. Falham `sem-comentario-novo` (808), `teto-de-comentarios`, `limite-de-linhas`, `sem-segredo`, `sem-depuracao-esquecida` (36), `eslint-nas-linhas-novas`, `saude-do-codigo` (12874 pontos) e `limite-de-tamanho`. Provado com as regras da base (E3c) |
| `MAC/**/fixtures/` | 4 arquivos de mídia de `MAC/integracao-camlive/test/fixtures/` | nada | Nenhum na PR que move, porque são binários sem linha de texto. A isenção some sem fazer falta |
| `MAC/**/reservas/`, `MAC/**/backup-*/` | nenhum arquivo versionado | nada | Nenhum hoje. Também estão fixos em `regra-binario.js` (`MAC/**/reservas/`) e no texto do `AGENTS.md` (seção 5) e do `CONTRIBUTING.md` |
| `consolePermitidoEm` `MAC/` | toda ferramenta de `MAC/` | nada | Nenhum na PR que move, porque `R100` não acrescenta linha. Na PR seguinte, um `console.log` novo em `iphone/conexao-usb/proxy-parse.js` falha (provado: ✗ com as regras de hoje, ✓ com `iphone/`). Os testes continuam liberados por `test/`, `teste/` e `*.test.*` |

O que funcionou no clone (E4a/E4b): uma PR de regras **antes** da troca, que acrescenta sem tirar `{iphone,interface,mac}/**/dist/`, `…/reservas/`, `…/backup-*/`, `…/fixtures/`, `…/index-Dun7lr2S*.js` e, em `consolePermitidoEm`, `iphone/`, `interface/` e `mac/`. Os globs de `MAC/` saem depois. Com ela na base, a troca passou com as regras da base. O `{a,b}` funciona em `globs.js`. Um glob como `mac/`, sem `/` no meio, casa uma pasta `mac/` em **qualquer** nível, como o `MAC/` de hoje. Hoje não existe outra pasta com esses nomes, mas isso fica anotado.

### `caminhos-sensiveis.json` (atenção ALTA)

Param de casar: `MAC/integracao-iphone/**`, `MAC/proxy-iphone/**`, `MAC/controle-celular-plataformas/**`, `MAC/integracao-sequestro-cam/**`, `MAC/integracao-camlive/**` (`ponte-do-iphone`) e `MAC/distribuicao/**` (`atualizacao-e-dependencias`). `MAC/encerramento-nova/**` já não casa nada.

Com `classificar` de `risco.js` sobre os 146 pares da troca:

| Classificação | Arquivos | Onde |
| --- | --- | --- |
| ALTA só pela origem | 84 | `integracao-iphone` 44, `proxy-iphone` 18, `integracao-camlive` 8, `controle-celular-plataformas` 6, `integracao-sequestro-cam` 4, `distribuicao` 4 |
| ALTA pela origem e pelo destino | 32 | casam pelo nome do arquivo (`**/*iphone*`, `**/*.command`, `**/*.sh`, `**/*.plist`, `**/geo-proxy*`) |
| ALTA só pelo destino | 0 | |
| Nem um nem outro | 30 | `integracao-modelo*`, `traducao-interface`, `kling`, `navegador-mac`, `GUIA`, `pesquisas`, `docs/research`, `LEIA-ME.md` |

- **A PR que move conta como ALTA pela origem e pelo destino.** O `Registro da PR` (`registro-da-pr.js`) acrescenta o `previous_filename` que o GitHub devolve em cada arquivo `renamed`, e classifica os dois nomes. Basta um deles casar. O `verificar.js` local (`descreverRisco`) só classifica o nome novo, então mostra menos que o CI. Na troca ele ainda diz ALTA, por causa dos 32.
- **Depois do merge**, os 84 arquivos deixam de ser ALTA nas PRs seguintes. Entre eles estão `iphone/camera/Tweak.x`, `iphone/proxy/tool/*.m`, `iphone/conexao-usb/aplicar-*.py` e `mac/distribuicao/**`. Isso só não acontece se a mesma PR de regras de antes da troca acrescentar `iphone/camera/**`, `iphone/conexao-usb/**`, `iphone/idioma/**`, `iphone/distribuicao/**`, `iphone/proxy/**`, `iphone/test/**`, `iphone/*` (os arquivos soltos de `integracao-iphone`), `interface/controle-do-celular/**`, `interface/sequestro-de-camera/**`, `mac/camlive/**` e `mac/distribuicao/**`. A lista exata depende da árvore final. `scripts/regras/test/registro.test.js` usa caminhos de `MAC/` como exemplo de ALTA, e ele quebra se os globs antigos saírem antes dos arquivos.

## O que isso muda para o mapa

- O painel não perde nota nem histórico. Então a ordem do mapa (troca antes do lote 1) não volta ao dono.
- O plano das PRs ([As PRs da troca](https://github.com/vinicius928e8r84/Nova-AI/issues/198)) ganha um passo obrigatório: **uma PR de regras antes da troca**, que acrescenta os globs novos em `configuracao.json` e `caminhos-sensiveis.json` sem tirar os de `MAC/`. Ela é ALTA, porque mexe em `scripts/regras/**`, e precisa de revisão do dono. Os globs velhos saem numa PR depois da troca.
- Na PR da troca: o `git mv` num commit só, sem edição de conteúdo; o `--atualizar-linha-de-base` no mesmo commit, se a #179 ainda não estiver na `main`; a atenção ALTA com prova real.

## Visto fora da pergunta (pertence à [Pesquisa: tudo o que cita cada pasta](https://github.com/vinicius928e8r84/Nova-AI/issues/196))

- O job "Testes de MAC/ que rodam sem Mac" do `regras.yml` cita 9 caminhos de `MAC/`.
- Os testes de `MAC/` sobem até `app/` por caminho relativo (`../../../app/...`). Quando a profundidade muda, eles quebram: `iphone/conexao-usb/tool-paths.test.cjs` deu `Cannot find module '../../../app/electron/services/tool-paths'`.

## Como reproduzir

```bash
git clone --no-hardlinks <repo> /tmp/x && cd /tmp/x && npm ci --prefix scripts/regras/analisador
# mover a árvore com git mv num commit; depois, com as regras da base como o CI:
git archive <base> scripts/regras | tar -x -C /tmp/regras-da-base
REGRAS_BASE=<base> REGRAS_EXIGE_FERRAMENTAS=1 node /tmp/regras-da-base/scripts/regras/verificar.js --raiz /tmp/x
```

A suíte `node --test "scripts/regras/test/*.test.js"` passou na árvore nova (287 testes, 283 pass, 0 fail).
