# O que cita cada pasta que muda: anexo

Continuação de [o-que-cita-cada-pasta.md](o-que-cita-cada-pasta.md), da pesquisa do ticket [Pesquisa: tudo o que cita cada pasta que muda e quebra na troca](https://github.com/vinicius928e8r84/Nova-AI/issues/196). Aqui ficam o que vale para todas as pastas, a prova e as fontes.

## O que vale para todas as pastas

- **CI, `.github/workflows/regras.yml`.** Os nove testes de "Testes de MAC/ que rodam sem Mac" são caminhos fixos, e um arquivo que não existe faz `node --test` sair com 1 (testado). O glob dos testes de `app/` não quebra.
- **Regras, `scripts/regras/`.** `caminhos-sensiveis.json` (6 globs de pasta), `configuracao.json` (`ignorarCodigo` com `MAC/**/dist/`, `MAC/**/reservas/`, `MAC/**/backup-*/`, `MAC/**/fixtures/` e `MAC/**/index-Dun7lr2S*.js`, e `consolePermitidoEm: MAC/`), `eslint.config.mjs` (os mesmos cinco globs), `regra-binario.js` (`MAC/**/reservas/` fixo no código), `linha-de-base.json` (entradas de `MAC/`: 1 de 6 arquivos grandes, 19 de 54 na saúde do código e 61 de 117 nos comentários, mais 1 de `pesquisas/`) e os testes de `scripts/regras/test/` (`globs`, `correcoes`, `saude`, `tamanho`, `limite`, `teto-de-comentarios` e `endurecimento` usam `MAC/x/...` como exemplo de caminho isento; `exclusoes.test.js` compara com o repositório de verdade). Como o CI lê as regras da branch-alvo, os globs novos têm de estar na `main` antes da PR que move. O texto de `CONTRIBUTING.md` (linha 18: "Scripts, testes e `MAC/` podem imprimir") e o de `regra-debug.js` mudam junto.
- **Painel.** `docs/codescene-exclusoes.md` só cita `**/index-Dun7lr2S*.js`, que continua casando, mas a tabela da página fala em "cópias dele em `MAC/`". O projeto 2 não tem componentes de arquitetura (GET em `/api/v2/projects/2/components` devolve `[]`), então não há glob de pasta para trocar lá. `scripts/painel/lista-do-painel.js` classifica `^MAC/.+\.py$` e `^pesquisas/` como ferramenta.
- **Clone do dono (`~/Desktop/Nova-AI`).** O `git pull` da troca deixa em `MAC/` tudo o que o git ignora: `.theos/`, `tool/packages/*.deb`, `conexao-usb/node_modules/`, `distribuicao/pacote-*/` e `inspecao-binarios/`. Os `.command` de dois cliques (`instalar-iphone.command`, `instalar-proxy-iphone.command` e `instalar-helper-idioma.command`) mudam de lugar no Finder. Dois scripts têm `~/Desktop/Nova-AI/MAC/...` fixo.
- **Documentação.** `README.md` (5 citações de pasta), `AGENTS.md` (seção 4: `distribuicao/pacote-*` e `encerramento-nova/teste/`; seção 5: o roteiro do bundle), `CONTRIBUTING.md` (só `MAC/` na regra de depuração), `app/README.md` (2), `docs/windows.md` (2), três ADRs (0061, 0090 e 0093) e os READMEs das pastas. O `CONTEXT.md` não cita caminho.
- **Issues e PRs abertas.** Fora deste mapa, 17 issues abertas citam caminhos que mudam: #68, #87, #90, #99, #105, #106, #110, #117, #120, #143, #144, #167, #175, #176, #180, #184 e #192. O mapa #194 e os tickets #195 a #197 também. Das 2 PRs abertas, a #193 acrescenta 3 arquivos em `pesquisas/nota-10/` e cita 15 caminhos de `MAC/` em `fila-lotes.md`; a #199 só mexe no `CONTEXT.md`. A fila da nota 10 é a parte que vira a spec e precisa dos caminhos novos.

## Como foi provado

Na `main` (`2eb4212`), com `npm ci --ignore-scripts` em `app/` e em `scripts/regras/analisador/`:

| Comando | `main` | Simulação |
| --- | --- | --- |
| `node --test "scripts/regras/test/*.test.js"` | 283 passam, 0 falham, 4 pulados | `exclusoes.test.js`: 1 falha (`iphone/conexao-usb/dist/index-Dun7lr2S.patched.js` "fora da análise do CodeScene mas cobrado pelas regras") |
| `node --test scripts/painel/test/lista-do-painel.test.js` | 4/0 | 4/0 (o teste usa strings, não arquivos) |
| Testes de `app/` (glob da CI) | 744/0 | 744/0 |
| Os 9 testes de `MAC/` da CI, nos caminhos novos | 32/0 | 8 falham; só `teste-novamodel.cjs` passa |
| 18 testes que rodam no Linux fora da CI | 14 passam; `relay` estoura o tempo; `iphone-media` e os 2 de kling falham | 13 falham por caminho; passam `teste-novamodel-saida`, `teste-geo` e `geo-proxy.test` |
| `node scripts/regras/verificar.js --base origin/main` | — | sai com 1: ALTA pedida para 38 arquivos; falham comentário novo, teto de comentários, limite de linhas, segredo, depuração, ESLint e saúde do código |
| `casaAlgum` de `caminhos-sensiveis.json` em 14 pares velho/novo | 11 com ALTA | 0 com ALTA |

Os erros dos testes na simulação são todos de caminho: `Cannot find module '../../../app/...'`, `ENOENT .../worktrees/app/electron/...` (subiu um nível a mais), `ENOENT iphone/integracao-iphone/iosModels.json` e `ENOENT interface/integracao-camlive/test/fixtures/tiny.jpg`.

## Fontes

- Os arquivos citados, na `main` em `2eb4212`.
- `.github/workflows/regras.yml`, passos "Usar as regras da base" e "Testes de MAC/ que rodam sem Mac".
- `scripts/regras/git.js` (`diff --name-status -M` e `saiuDaIsencao`) e `scripts/regras/verificar.js` (`configuracao.json` lido de `__dirname`, que é a cópia da base).
- `gh issue list --state open` e `gh pr list --state open` em 27/11/2026.
- Painel: `GET /api/v2/projects/2` e `/api/v2/projects/2/components` no CodeScene local (porta 3003), só leitura.
