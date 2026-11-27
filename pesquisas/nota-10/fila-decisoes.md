# As decisões do dono sobre a fila

Parte de [A fila dos lotes até a nota 10](fila.md). O dono respondeu em 26/11/2026, numa página do Lavish (sessão `f981acd6e4e0e30a`, encerrada por ele), às seis perguntas. Escolheu a recomendação em todas, sem observação.

Uma sétima pergunta, se a PR #161 (a divisão do `cam-live.js` só movendo código) entrava antes da campanha, saiu da página antes da resposta: a PR foi mesclada em 26/11, com prova real.

1. **Dois cortes grandes e dois pequenos por lote.** Os 30 cortes dos quatro arquivos grandes andam dois por lote. São 16 lotes de produto, cada um com a sua sessão de prova e um tipo de aparelho (a tabela de [fila-lotes.md](fila-lotes.md)). Ficaram de fora: 4 grandes por lote (11 lotes, PRs enormes) e 1 grande por lote (uns 30 lotes).
2. **O `cam-live.js` ganha pesquisa de corte própria**, a [Pesquisa: o corte do app/dist/cam-live.js](https://github.com/vinicius928e8r84/Nova-AI/issues/192). Os cortes dela ocupam as vagas livres dos lotes 11 a 16; o que passar disso vira lote próprio no fim da fase do produto. A pesquisa precisa fechar antes do lote 11.
3. **Os 11 arquivos em 10 acima de 20.000 bytes entram na fila**, nos lotes 17 e 18 (o teto), depois do produto. Cada um é dividido sem mudar o comportamento.
4. **Os consertos dos 9 defeitos entram antes do primeiro corte do arquivo**, cada um numa PR própria, fora do lote, quando nenhum lote estiver aberto naquele arquivo. A caracterização grava o comportamento já consertado. São os seis do spoof da câmera (#168 a #173), os dois do celular físico (#158 e #159) e o da fazenda de navegadores (#153). Consertar ou apagar o Frida (#158) continua uma decisão do dono.
5. **A ferramenta vem depois do produto e do teto, antes dos testes** (lotes 19 a 21). As cinco PRs de regra (#175 a #179) mexem em `scripts/regras/` antes.
6. **Se o painel estiver fora do ar, o lote espera ele voltar.** A catraca (`saude-do-codigo`) continua como conferência rápida no meio do trabalho e como barreira na CI, também depois da nota 10.

Nenhum termo novo para o glossário.
