# Nova-AI

A Nova-AI é um app de desktop (Electron, Mac e Windows) que controla navegadores, celulares e câmeras a partir de um painel só. Este glossário guarda as palavras do trabalho de qualidade do código; as do produto entram quando forem decididas.

## Language

### Qualidade do código

**Nota**:
O Code Health de um arquivo no Painel, de 1 a 10. Nota 10 da codebase quer dizer todo arquivo pontuado em 10.
_Avoid_: score, saúde, pontuação

**Painel**:
O CodeScene que analisa a Nova-AI e põe o check nas PRs.
_Avoid_: dashboard, servidor, OpenCleanCode

**Catraca**:
A regra `saude-do-codigo` do repositório, que conta pontos acima dos limites em cada arquivo e só deixa esse número descer.
_Avoid_: gate, trava, medidor

**Corte**:
Uma refatoração de um arquivo que não muda o comportamento.
_Avoid_: refactor, limpeza, quebra

**Lote**:
Até dez Cortes numa PR.
_Avoid_: onda, batch, pacote

**Caracterização**:
O teste gravado antes do Corte, que passa no código antigo e julga o Corte.
_Avoid_: teste de regressão, snapshot

**Prova real**:
O Corte rodado no app de verdade, no head exato da PR.
_Avoid_: teste manual, smoke, validação

**Cópia de reserva**:
O arquivo anterior do app instalado, guardado antes de ser trocado.
_Avoid_: backup, reserva, original
