# Anexo: no que a catraca do repositório e o painel discordam

Tabelas da pesquisa [No que a catraca do repositório e o painel discordam](catraca-e-painel.md), do ticket [Pesquisa: no que a catraca do repositório e o painel discordam](https://github.com/vinicius928e8r84/Nova-AI/issues/126). Painel: análise 160 sobre `96ea7ce`. Catraca: medição de hoje, no mesmo commit.

## Os 40 arquivos, arquivo por arquivo

Arquivos abaixo de 10 no painel e com pontos na catraca. As colunas de achados contam os achados de função do painel em `code_health_details/`, classificados como explica a seção "Os 40 arquivos que as duas veem" da pesquisa.

| # | Arquivo | Nota | Pontos | Achados de função no painel | Mesma função | Dentro de função maior | Catraca não vê | Duplicação | Regras de arquivo só do painel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `app/dist/cam-live.js` | 1,65 | 356 | 65 | 60 | 5 | 0 | 0 | Many Conditionals |
| 2 | `app/electron/main.js` | 2,44 | 4095 | 66 | 7 | 33 | 0 | 26 | Modularity Issue |
| 3 | `app/electron/services/browserFarmService.js` | 2,64 | 1031 | 30 | 28 | 0 | 0 | 2 | Brain Method, File Size Issue, Overall Code Complexity |
| 4 | `app/electron/services/physicalMobileService.js` | 3,13 | 605 | 38 | 35 | 0 | 1 | 2 | Many Conditionals, Modularity Issue |
| 5 | `app/electron/services/global-spoof-service.js` | 3,15 | 1555 | 24 | 13 | 9 | 0 | 2 | File Size Issue, Overall Code Complexity |
| 6 | `app/electron/services/cam-live-iphone.js` | 4,43 | 81 | 24 | 22 | 0 | 2 | 0 | Many Conditionals |
| 7 | `app/electron/services/cam-live-service.js` | 4,72 | 82 | 25 | 24 | 0 | 1 | 0 | Many Conditionals |
| 8 | `app/electron/services/agent-swarm-controller.js` | 5,58 | 93 | 14 | 14 | 0 | 0 | 0 | Brain Method, Many Conditionals |
| 9 | `app/electron/services/whatsapp-manager.js` | 5,62 | 271 | 15 | 15 | 0 | 0 | 0 | Many Conditionals |
| 10 | `app/electron/services/idioma-ipc.js` | 6,71 | 55 | 7 | 6 | 0 | 1 | 0 | Many Conditionals |
| 11 | `app/electron/services/iphone-setup/setup.js` | 6,96 | 116 | 5 | 5 | 0 | 0 | 0 | Many Conditionals |
| 12 | `app/dist/cam-live-audio.js` | 7,41 | 39 | 9 | 9 | 0 | 0 | 0 | Many Conditionals |
| 13 | `MAC/integracao-iphone/conexao-usb/proxy-parse.js` | 7,55 | 28 | 3 | 3 | 0 | 0 | 0 | Many Conditionals |
| 14 | `app/electron/services/child-worker-agent.js` | 7,61 | 64 | 3 | 3 | 0 | 0 | 0 | Many Conditionals |
| 15 | `scripts/regras/registrar-na-pr.js` | 7,64 | 36 | 6 | 5 | 0 | 1 | 0 | Many Conditionals |
| 16 | `app/electron/services/iphone-setup/inapp.js` | 7,81 | 15 | 10 | 6 | 0 | 0 | 4 | High Degree of Code Duplication, Many Conditionals |
| 17 | `app/electron/services/ios-camera.js` | 7,89 | 16 | 5 | 4 | 0 | 1 | 0 | Many Conditionals |
| 18 | `scripts/regras/registro-da-pr.js` | 8,01 | 7 | 5 | 3 | 0 | 2 | 0 | Many Conditionals |
| 19 | `app/electron/services/nova-shutdown.js` | 8,03 | 16 | 7 | 7 | 0 | 0 | 0 | Many Conditionals |
| 20 | `MAC/integracao-sequestro-cam/patch_bundle.py` | 8,13 | 8 | 5 | 5 | 0 | 0 | 0 | — |
| 21 | `scripts/regras/regra-linhas.js` | 8,54 | 23 | 2 | 2 | 0 | 0 | 0 | Many Conditionals |
| 22 | `MAC/controle-celular-plataformas/aplicar.py` | 8,65 | 9 | 3 | 3 | 0 | 0 | 0 | Global Complexity |
| 23 | `scripts/regras/regra-comentario.js` | 8,67 | 13 | 4 | 4 | 0 | 0 | 0 | — |
| 24 | `app/electron/services/ios-bridge.js` | 8,81 | 12 | 2 | 2 | 0 | 0 | 0 | Many Conditionals |
| 25 | `MAC/controle-celular-plataformas/geo-proxy/aplicar-geo.py` | 8,93 | 3 | 3 | 3 | 0 | 0 | 0 | — |
| 26 | `app/electron/services/user-profile-manager.js` | 9,13 | 33 | 2 | 2 | 0 | 0 | 0 | — |
| 27 | `scripts/regras/regra-segredo.js` | 9,16 | 10 | 3 | 3 | 0 | 0 | 0 | — |
| 28 | `app/electron/webview-bridge.js` | 9,22 | 10 | 3 | 3 | 0 | 0 | 0 | — |
| 29 | `scripts/regras/regra-binario.js` | 9,24 | 17 | 2 | 2 | 0 | 0 | 0 | — |
| 30 | `prototype-sequestro-cam/servir.py` | 9,36 | 2 | 3 | 2 | 0 | 1 | 0 | — |
| 31 | `scripts/regras/auditoria.js` | 9,37 | 12 | 2 | 2 | 0 | 0 | 0 | — |
| 32 | `MAC/integracao-camlive/test/harness-usb.js` | 9,38 | 23 | 2 | 2 | 0 | 0 | 0 | — |
| 33 | `MAC/integracao-camlive/test/harness.js` | 9,38 | 23 | 2 | 2 | 0 | 0 | 0 | — |
| 34 | `app/electron/services/nova-human-controller.js` | 9,45 | 28 | 3 | 3 | 0 | 0 | 0 | — |
| 35 | `app/electron/services/geo-proxy.js` | 9,58 | 6 | 1 | 1 | 0 | 0 | 0 | — |
| 36 | `app/electron/services/ios-devices.js` | 9,66 | 5 | 1 | 1 | 0 | 0 | 0 | — |
| 37 | `scripts/regras/verificar.js` | 9,68 | 1 | 1 | 1 | 0 | 0 | 0 | — |
| 38 | `app/electron/services/tool-paths.js` | 9,68 | 4 | 1 | 1 | 0 | 0 | 0 | — |
| 39 | `MAC/integracao-iphone/idioma-iphone/teste/teste-ipc.js` | 9,68 | 26 | 1 | 1 | 0 | 0 | 0 | — |
| 40 | `MAC/integracao-iphone/distribuicao/empacotar-python.py` | 9,68 | 16 | 0 | 0 | 0 | 0 | 0 | Global Complexity |

## Os achados que a catraca não vê

| Arquivo | Função (linha) | Painel | Catraca |
| --- | --- | --- | --- |
| `ios-camera.js` | `setCameraInjection` (176) | complexidade 18 | 7; a função interna `const write = async () => ...` conta à parte |
| `registro-da-pr.js` | `lerDoGitHub` (239) | complexidade 12, 2 lombadas | 7; a interna `ler` conta à parte (4) |
| `registrar-na-pr.js` | `ambiente` (172) | complexidade 10 | 7; a interna `tentar` conta à parte (2) |
| `cam-live-iphone.js` | `_openForward` (242) | complexidade 10 | 6 |
| `cam-live-iphone.js` | `_readState` (136) | complexidade 10 | 7 |
| `cam-live-service.js` | `parseTarget` (72) | complexidade 9 | 6 |
| `physicalMobileService.js` | `getGSFAndroidId` (1400) | lombadas | nada |
| `idioma-ipc.js` | `lerSaida` (31) | lombadas | nada |
| `prototype-sequestro-cam/servir.py` | `Handler.do_GET` (85) | lombadas | nada |
| `rtmp-server.js` (lista 1) | `stopBroadcast` (92) | complexidade 9 | 8 |

## Como refazer

1. Disparar a análise: `POST /api/v2/projects/2/run-analysis` (como na [Tarefa: aplicar as exclusões no painel e rodar a análise de novo](https://github.com/vinicius928e8r84/Nova-AI/issues/123)) e esperar `analysis_status` voltar a `ok`.
2. A nota: `node scripts/painel/lista-do-painel.js --analise <id> --json`.
3. Os achados por função: o comando da seção 4 de `pesquisas/nota-10/api-do-painel.md` (branch `agent/pi/pesquisa-122-20261123`), com o `dir` da análise.
4. A catraca de hoje, arquivo por arquivo: `cd scripts/regras/analisador && npm ci`, depois, na raiz, um script que passe cada arquivo de `arquivosDoRepositorio` filtrado por `seAplica` (de `regra-saude.js`) a `medirFontes` e some `pontuar`. É o que `calcularLinhaDeBase` faz, sem gravar.
