# A árvore nova das pastas da Nova-AI

Resposta do ticket [A árvore nova, pasta a pasta e arquivo a arquivo](https://github.com/vinicius928e8r84/Nova-AI/issues/197), do mapa [Nomes e estrutura das pastas da Nova-AI](https://github.com/vinicius928e8r84/Nova-AI/issues/194). O dono decidiu em 27/11/2026, numa página do Lavish (sessão `374ce793150e14be`), as dez perguntas na recomendação, sem observação, e confirmou a tabela.

**Base:** `main` em `168ff1b`. Nada foi renomeado: este ticket só decide. A tabela arquivo a arquivo (162 arquivos) está em [arvore-nova-anexo.md](arvore-nova-anexo.md). Um script conferiu que nenhum destino se repete e que nenhum já existe no repositório. As `prototype-*` não entram: saem antes da troca ([issue #132](https://github.com/vinicius928e8r84/Nova-AI/issues/132)).

## A regra

Cada arquivo vai para onde o código dele vai:

- `iphone/`: o que vai para o aparelho (os Pacotes do iPhone, os instaladores deles e os testes deles).
- `interface/`: os Patches da interface, o que eles leem e o bundle já reescrito.
- `test/`: os testes do código de `app/` que hoje moram em `MAC/`, uma subpasta por área.
- `distribuicao/`: o que monta e confere o app de desktop, no Mac e no Windows.
- `docs/`: guia, pesquisas e histórico.

Um teste fica com o pacote ou o patch só quando testa o próprio pacote ou patch.

## O que o dono decidiu

| # | Pergunta | Decisão |
| --- | --- | --- |
| 1 | Os testes do código do app que moram em `MAC/` | `test/` na raiz, por área: `test/iphone/`, `test/cam-live/`, `test/foto-em-video/` (Kling) e `test/navegador/`. Não vão para `app/test/`, porque o `.dmg` leva `app/` inteiro (`asar: false`, `files: **/*`). |
| 2 | `conexao-usb/` | Divide. Os cinco `aplicar-*.py`, o `proxy-parse.js`, o `README.md`, as capturas de `docs/` e o `botao.test.cjs` vão para `interface/controle-do-celular/iphone/`. Os testes do app vão para `test/iphone/`. Nada dela ia para o aparelho. |
| 3 | O bundle já reescrito | `interface/dist/index-Dun7lr2S.patched.js`: é o resultado de todos os patches, não só do botão. |
| 4 | O helper de idioma repetido | As duas cópias de `MAC/` (iguais byte a byte) viram uma, em `iphone/idioma/helper/`, com os dois instaladores. A cópia de `app/electron/services/iphone-setup/` não muda. |
| 5 | `geo-proxy/` | Divide. `aplicar-geo.py` e o `README.md` vão para `interface/controle-do-celular/localizacao-pela-proxy/`; `helper/` vai para `iphone/idioma/helper/`; `teste-geo.cjs` vai para `test/iphone/`. |
| 6 | Os soltos de `integracao-iphone/` | `README.md` e `CONTROLS-IPHONE-WIFI-BLUETOOTH.md` vão para `iphone/`; `instalar-iphone.command` e `prepare_tweak.py` vão para `iphone/camera/`; `iosModels.json` vai para `iphone/modelo/`; `tests/` vai para `test/iphone/`. |
| 7 | Os dois `README.md` do modelo | Um só: o texto do `README.md` de `integracao-modelo-app/` vira uma seção no fim do `README.md` do pacote, num commit de texto separado do `git mv`. `novamodel.test.cjs` vai para `test/iphone/`. |
| 8 | `distribuicao/` e `mac/` | As duas `distribuicao/` (a de `MAC/` e a de `integracao-iphone/`) se juntam em `distribuicao/` na raiz. **`mac/` não existe.** Isto muda a rodada 1: a de `integracao-iphone/` monta o app de desktop (Mac e Windows), não o iPhone, e sem ela `mac/` ficaria só com `distribuicao/`. |
| 9 | `MAC/LEIA-ME.md` | `docs/historico.md`: é o histórico do projeto todo, não só do Mac. É o único arquivo que troca de nome. |
| 10 | `docs/research/nota-10-global-spoof/` | `docs/pesquisas/nota-10-global-spoof/`, com o nome de hoje. |

## A árvore

```
iphone/                     README.md, CONTROLS-IPHONE-WIFI-BLUETOOTH.md
  camera/                   ← integracao-iphone/bridge + instalar-iphone.command + prepare_tweak.py
  idioma/                   ← integracao-iphone/idioma-iphone (teste/ → test/)
    helper/                 ← controle-celular-plataformas/geo-proxy/helper
  modelo/                   ← integracao-modelo + iosModels.json
  proxy/                    ← proxy-iphone (tool/teste/ → tool/test/)
interface/
  controle-do-celular/      ← controle-celular-plataformas (aplicar.py, README.md, docs/)
    iphone/                 ← os patches de integracao-iphone/conexao-usb
    localizacao-pela-proxy/ ← controle-celular-plataformas/geo-proxy (aplicar-geo.py, README.md)
  sequestro-de-camera/      ← integracao-sequestro-cam
  traducao/                 ← traducao-interface
  dist/                     ← integracao-iphone/conexao-usb/dist
test/
  iphone/                   ← integracao-iphone/tests, os testes do app de conexao-usb, novamodel.test.cjs, teste-geo.cjs
    modal/                  ← integracao-iphone/conexao-usb/test/modal
  cam-live/                 ← integracao-camlive/test + controles-independentes.test.cjs
  foto-em-video/            ← integracao-kling/test
  navegador/                ← navegador-mac/tests
distribuicao/               ← MAC/distribuicao + integracao-iphone/distribuicao
docs/
  guia/                     ← GUIA
  pesquisas/                ← pesquisas + docs/research
  historico.md              ← MAC/LEIA-ME.md
app/                        só app/tests → app/test e services/testes → services/test
scripts/                    não muda
```

## Pasta a pasta

Na ordem em que a regra vale (a primeira que casa). "Arquivos" é quantos arquivos versionados a linha leva.

| Hoje | Depois | Arquivos |
| --- | --- | --- |
| `MAC/integracao-iphone/bridge/` | `iphone/camera/` | 5 |
| `MAC/integracao-iphone/instalar-iphone.command`, `prepare_tweak.py` | `iphone/camera/` | 2 |
| `MAC/integracao-iphone/README.md`, `CONTROLS-IPHONE-WIFI-BLUETOOTH.md` | `iphone/` | 2 |
| `MAC/integracao-iphone/iosModels.json` | `iphone/modelo/` | 1 |
| `MAC/integracao-iphone/tests/` | `test/iphone/` | 7 |
| `MAC/integracao-iphone/conexao-usb/aplicar-*.py`, `proxy-parse.js`, `README.md`, `docs/` | `interface/controle-do-celular/iphone/` | 12 |
| `MAC/integracao-iphone/conexao-usb/botao.test.cjs` | `interface/controle-do-celular/iphone/test/` | 1 |
| `MAC/integracao-iphone/conexao-usb/dist/` | `interface/dist/` | 1 |
| `MAC/integracao-iphone/conexao-usb/nova-locale.sh`, `com.aquiles.novalocale.plist` | saem (iguais aos de `iphone/idioma/helper/`) | 2 |
| `MAC/integracao-iphone/conexao-usb/test/modal/` | `test/iphone/modal/` | 4 |
| o resto de `MAC/integracao-iphone/conexao-usb/` (5 testes, `package.json`, `package-lock.json`) | `test/iphone/` | 7 |
| `MAC/integracao-iphone/idioma-iphone/teste/` | `iphone/idioma/test/` | 4 |
| `MAC/integracao-iphone/idioma-iphone/` | `iphone/idioma/` | 5 |
| `MAC/integracao-iphone/distribuicao/` | `distribuicao/` | 6 |
| `MAC/distribuicao/` | `distribuicao/` | 4 |
| `MAC/integracao-modelo-app/novamodel.test.cjs` | `test/iphone/` | 1 |
| `MAC/integracao-modelo-app/README.md` | o texto entra em `iphone/modelo/README.md` | 1 |
| `MAC/integracao-modelo/` | `iphone/modelo/` | 13 |
| `MAC/proxy-iphone/tool/teste/` | `iphone/proxy/tool/test/` | 3 |
| `MAC/proxy-iphone/` | `iphone/proxy/` | 19 |
| `MAC/controle-celular-plataformas/geo-proxy/helper/` | `iphone/idioma/helper/` | 4 |
| `MAC/controle-celular-plataformas/geo-proxy/teste-geo.cjs` | `test/iphone/` | 1 |
| `MAC/controle-celular-plataformas/geo-proxy/` | `interface/controle-do-celular/localizacao-pela-proxy/` | 2 |
| `MAC/controle-celular-plataformas/` | `interface/controle-do-celular/` | 5 |
| `MAC/integracao-sequestro-cam/controles-independentes.test.cjs` | `test/cam-live/` | 1 |
| `MAC/integracao-sequestro-cam/` | `interface/sequestro-de-camera/` | 3 |
| `MAC/traducao-interface/` | `interface/traducao/` | 2 |
| `MAC/integracao-camlive/test/` | `test/cam-live/` | 11 |
| `MAC/integracao-kling/test/` | `test/foto-em-video/` | 2 |
| `MAC/navegador-mac/tests/` | `test/navegador/` | 1 |
| `MAC/LEIA-ME.md` | `docs/historico.md` | 1 |
| `GUIA/` | `docs/guia/` | 2 |
| `pesquisas/` | `docs/pesquisas/` | 14 |
| `docs/research/` | `docs/pesquisas/` | 5 |
| `app/tests/` | `app/test/` | 3 |
| `app/electron/services/testes/` | `app/electron/services/test/` | 5 |

## O que esta árvore pede dentro dos arquivos

A [pesquisa do que cita cada pasta](o-que-cita-cada-pasta.md) mediu a proposta do mapa. Esta árvore muda a proposta em alguns pontos, e isso muda o que a PR da troca edita:

- **Os `../` dos testes que vão para `test/`.** Os de `integracao-iphone/tests/`, `conexao-usb/`, `integracao-camlive/test/`, `integracao-kling/test/`, `navegador-mac/tests/` e `geo-proxy/teste-geo.cjs` sobem um nível a menos até `app/`. `iphone/idioma/test/teste-ipc.js` também sobe um a menos. `novamodel.test.cjs` e `controles-independentes.test.cjs` ficam na mesma profundidade, e `botao.test.cjs` sobe um a mais. `test/modal/` usa o caminho do app instalado e não muda.
- **Dependências entre irmãos que a árvore desfaz ou refaz.** `controles-independentes.test.cjs` passa a achar `fixtures/tiny.jpg` ao lado dele. `novamodel.test.cjs` lê `iosModels.json` em `iphone/modelo/`. `locale-helper.test.cjs` e `iphone/idioma/test/teste-helper.sh` leem `nova-locale.sh` em `iphone/idioma/helper/`, e a conferência das duas cópias de `MAC/` deixa de ter o que conferir. `instalar-iphone.command` procura o `.deb` em `packages/`, e não mais em `bridge/packages/`. `aplicar-proxy-tipo.py` continua ao lado do `proxy-parse.js`.
- **`distribuicao/` na raiz.** `empacotar-ferramentas-windows.sh` calcula a raiz com `../../..` e passa a precisar de `..`. `tests/ios-tools-windows.cjs` cita o caminho da receita. As linhas do `.gitignore` passam a `distribuicao/pacote-*/` e `distribuicao/inspecao-binarios/`.
- **O roteiro do bundle.** A seção 5 do `AGENTS.md` passa a citar `interface/controle-do-celular/iphone/aplicar-botao-iphone.py` e `interface/dist/index-Dun7lr2S.patched.js`.
- **As regras.** Os globs `MAC/**/dist/` e `MAC/**/index-Dun7lr2S*.js` passam a casar com `interface/dist/`, e `MAC/**/fixtures/` com `test/cam-live/fixtures/`. A licença de imprimir (`consolePermitidoEm: MAC/`) e as pastas de atenção ALTA precisam dos caminhos novos. Que pasta nova é ALTA é decisão do plano das PRs.
- **Os dois caminhos fixos do clone do dono** (`instalar-proxy-iphone.command` e `patch_bundle.py`) seguem como na pesquisa, agora para `iphone/proxy/` e `interface/sequestro-de-camera/`.

O número de PRs, a ordem e a prova de cada uma são do ticket [As PRs da troca: quantas, em que ordem e como se prova](https://github.com/vinicius928e8r84/Nova-AI/issues/198).
