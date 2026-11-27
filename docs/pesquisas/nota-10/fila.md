# A fila dos lotes até a nota 10

Resposta do ticket [A fila dos lotes até a nota 10](https://github.com/vinicius928e8r84/Nova-AI/issues/139), do mapa [Nova-AI na nota 10 no CodeScene: o plano, com a fila de lotes e as regras que seguram](https://github.com/vinicius928e8r84/Nova-AI/issues/120). Montada em 26/11/2026 sobre a `main` em `2eb4212`. As decisões do dono desta rodada estão em [fila-decisoes.md](fila-decisoes.md); a tabela lote a lote, em [fila-lotes.md](fila-lotes.md).

## De onde a fila sai

- **A lista:** análise 163 do painel, que disparei em 26/11 sobre a `main` em `2eb4212`, já com a PR #161 (a divisão do `cam-live.js` só movendo código). Lida com `node scripts/painel/lista-do-painel.js --analise 163`: 239 arquivos com nota e **51 abaixo de 10** (produto 33, ferramenta 13, teste 5). São os mesmos 51 da análise 157 da [lista oficial](https://github.com/vinicius928e8r84/Nova-AI/issues/125). O `cam-live.js` continua em 1,65, agora com 958 linhas e marcado como hotspot; os três arquivos que a #161 criou estão em 10 ou sem nota.
- **As pesquisas de corte:** [main.js](https://github.com/vinicius928e8r84/Nova-AI/issues/127) (11 cortes), [physicalMobileService.js](https://github.com/vinicius928e8r84/Nova-AI/issues/130) (7), [global-spoof-service.js](https://github.com/vinicius928e8r84/Nova-AI/issues/128) (6), [browserFarmService.js](https://github.com/vinicius928e8r84/Nova-AI/issues/129) (6) e a [ponte da câmera](https://github.com/vinicius928e8r84/Nova-AI/issues/190) (1 divisão e 9 cortes).
- **As decisões fechadas:** as regras ([#136](https://github.com/vinicius928e8r84/Nova-AI/issues/136)), os protótipos ([#132](https://github.com/vinicius928e8r84/Nova-AI/issues/132)), o Objective-C e o Logos ([#134](https://github.com/vinicius928e8r84/Nova-AI/issues/134)), a cópia de reserva ([#138](https://github.com/vinicius928e8r84/Nova-AI/issues/138)) e o que guia um item ([#126](https://github.com/vinicius928e8r84/Nova-AI/issues/126)). As provas pendentes por arquivo saem da [#137](https://github.com/vinicius928e8r84/Nova-AI/issues/137).

## O achado que fixa o tamanho dos lotes

Passei os 51 arquivos por `classificar` de `scripts/regras/risco.js`, com o arquivo inteiro como linhas acrescentadas (um corte reescreve quase tudo). **50 são de atenção ALTA.** O único BAIXA, `MAC/integracao-modelo/main.m`, vira ALTA pela regra que a #134 decidiu. Com a regra de até 4 itens ALTA por lote, **cada lote tem no máximo 4 arquivos**. O limite de 10 só vale para arquivos BAIXA, que nesta fila só aparecem nos lotes do teto.

## As regras da fila

1. **Um item é um arquivo, um corte e uma revisão.** Um arquivo com corte em série (os quatro grandes, a ponte) aparece em lotes seguidos, um corte por lote.
2. **Um lote aberto por vez, até 4 itens ALTA.**
3. **A ordem das fases:** preparação, produto, teto, ferramenta, testes, Objective-C e Logos. Dentro do produto, os hotspots primeiro.
4. **A fila se relê depois de cada lote.** O agente dispara a análise no painel e roda `node scripts/painel/lista-do-painel.js`. O arquivo que chegou a 10 sai da fila; o que caiu abaixo de 10 entra na próxima vaga livre.
5. **Nenhuma feature nova antes da nota 10.** Conserto de defeito e prova real passam.

## Fase 0: preparação (PRs sem corte, antes do lote 1)

| PR | Por que antes do lote 1 |
| --- | --- |
| [#175](https://github.com/vinicius928e8r84/Nova-AI/issues/175) a [#179](https://github.com/vinicius928e8r84/Nova-AI/issues/179), as regras | decisão da #136: o primeiro lote só abre depois delas |
| [#180](https://github.com/vinicius928e8r84/Nova-AI/issues/180), o portão dos testes | a #136 pede antes do primeiro lote do iPhone, e o lote 1 já corta `cam-live-iphone.js` e `ios-camera.js` |
| [#167](https://github.com/vinicius928e8r84/Nova-AI/issues/167), a cópia de reserva em `~/Nova-AI-reservas/` | o lote 1 já troca arquivos do app instalado, e a #138 decidiu onde vai a cópia |
| a PR que apaga os protótipos ([#132](https://github.com/vinicius928e8r84/Nova-AI/issues/132)) | precisa vir antes do lote do `proxy-parse.js`; a PR #161, que também mexia em `prototype-cam-live/`, já entrou |

[#183](https://github.com/vinicius928e8r84/Nova-AI/issues/183) e [#184](https://github.com/vinicius928e8r84/Nova-AI/issues/184) (as exclusões do painel) não travam lote e entram quando a #167 entrar. A [Pesquisa: o corte do app/dist/cam-live.js](https://github.com/vinicius928e8r84/Nova-AI/issues/192) precisa fechar antes do lote 11, onde começam as vagas dele.

**Antes da fase dos testes:** o job macOS da CI (#134, item 6), porque o lote 23 corta os dois testes `.m` do proxy. **Antes da fase do iPhone:** a regra ALTA de `MAC/integracao-modelo/**` (#134, item 4), o Theos e o SDK do iOS 16.5 no Mac de prova (passo do agente, sem PR) e a saída do filtro `*.h` do painel.

## Como cada lote se verifica

Cada item segue os mesmos passos, e o lote só fecha com todos os itens assim:

1. **Começa na tela do arquivo no painel** (#126): a lista de achados é o que o corte tem de zerar.
2. **Caracterização num commit antes do corte**, verde no código antigo. Os quatro grandes usam o desenho da pesquisa deles (o palco do `main.js`, os palcos novos do farm e do spoof, o teste byte a byte do Android); os pequenos usam o molde `palco`/`cenas`/`esperado` que o repositório já tem.
3. **O juiz morde:** depois do corte, o agente faz no código novo a quebra de propósito que a caracterização tem de pegar, mostra a cena que falha e desfaz a quebra. A mesma quebra no código antigo derruba a mesma cena. A quebra não entra no commit. (É o método da #128, estendido a todo item.)
4. **A catraca como conferência rápida:** `node scripts/regras/verificar.js` no meio do trabalho. Zerar a catraca não basta para a nota 10.
5. **A CI verde**, com o check `CodeScene Code Health Review (main)`, e a revisão independente de cada item no head exato.
6. **A prova real antes do merge:** a parte do agente (sem aparelho, nas máquinas de prova) e a parte do dono (com o aparelho da coluna "Prova do dono" de [fila-lotes.md](fila-lotes.md)). Cada prova pendente que cai num arquivo do lote se paga na mesma sessão e ganha o seu comentário com o head testado.
7. **Depois do merge:** a cópia para o app instalado guarda o arquivo anterior em `~/Nova-AI-reservas/AAAAMMDD-HHMMSS-<branch>/` (#138), a análise roda no painel e a lista se relê. O item fecha com a nota lida: 10 no arquivo, ou, num corte do meio de uma série, os módulos novos em 10 e o arquivo sem os achados que o corte levou.

**A parte do agente, por tipo de arquivo:**

- **`main.js`:** `NOVA_SMOKE_TEST=1` no head; o roteiro de antes e depois pelos canais (`electronAPI.invoke` com `NOVA_TEST_INSTANCE=1`); o mesmo roteiro no app do Mac depois da cópia, que tem de levar o `main.js` e todos os `main.*.js` juntos.
- **farm e spoof:** o palco igual antes e depois; o roteiro no Chrome de verdade numa página local (sha256 do `inject.js`, a tabela do que a página enxerga).
- **celular físico:** a caracterização na base e no head; baixar e achar o adb e o scrcpy; o MJPEG `/ping`.
- **ferramenta:** os testes de `scripts/regras/test/`; os scripts de patch rodados numa cópia do bundle, com o mesmo sha256 de saída antes e depois.
- **testes:** a quebra de propósito do passo 3, rodada no teste antigo e no cortado.
- **Objective-C:** o teste no Mac e o retrato do pacote (#134).

## As fases

| Fase | Lotes | Itens | Quem prova |
| --- | --- | --- | --- |
| 0. preparação | nenhum | 8 PRs | o agente |
| 1. produto | 1 a 16 | 30 cortes grandes, 20 arquivos pequenos e os cortes do `cam-live.js` | o agente e o dono, com aparelho |
| 2. teto | 17 e 18 | os 11 arquivos em 10 acima de 20.000 bytes | o agente e o dono (contas) |
| 3. ferramenta | 19 a 21 | 12 arquivos (o `servir.py` sai com os protótipos) | o agente |
| 4. testes | 22 e 23 | 5 arquivos | o agente |
| 5. Objective-C e Logos | 24 a 36 | Proxy A, Proxy B, idioma e modelo, e a ponte em 10 lotes | o dono, com o iPhone com jailbreak no Mac |

São **36 lotes**. Os cortes do `cam-live.js` usam as 14 vagas livres dos lotes 11 a 16; o que passar disso vira lote próprio no fim da fase 1.

## Os arquivos sem nota

Shell, HTML, CSS e `.cjs` não têm nota no painel, então ficam fora da conta da nota 10. Eles continuam segurados pelas regras da máquina: o teto de bytes (que não deixa crescer), o `limite-de-linhas` e a regra de comentário. Os dois que passam do teto e são de produto (`admin.html` e o `MAC/LEIA-ME.md`) entram nos lotes do teto. Os scripts de patch do bundle (`aplicar-*.py`) vão a 10 como código vivo: recuperar a interface sem fonte está fora do mapa.
