## Resumo

<!-- O que muda no app e nos fontes, e por quê. Texto de comentário de HTML não conta. -->

## Evidência

<!-- O que você rodou e o que apareceu (testes, node --check, tela, log). -->

## Arquivos do app instalado trocados

<!-- Quais arquivos de /Applications/Nova AI Mac.app mudaram e como reaplicar (AGENTS.md seção 5). Escreva "nenhum" se não mexeu. -->

Atenção:

<!--
A linha "Atenção:" leva só BAIXA, MÉDIA ou ALTA.
ALTA é obrigatória se a PR mexe em caminho sensível (scripts/regras/caminhos-sensiveis.json) e exige a seção abaixo.
Se o revisor registrar Risco: ALTA, a PR conta como ALTA mesmo com o corpo dizendo BAIXA ou MÉDIA.
A nota da prova não pode dizer NÃO COBERTO nem BLOQUEADA.

## Prova real

PROVADO 100% REAL
Head: <SHA inteiro do head, 40 caracteres: git rev-parse HEAD>

<o que você rodou no app de verdade e o que apareceu, pelo menos 40 caracteres>

Depois do último commit, registre a revisão independente (outro autor, outro revisor; o revisor não é quem abriu a PR):
node scripts/regras/registrar-na-pr.js revisao --pr <número> --head <SHA> --autor <quem> --revisor <quem> --risco baixa|media|alta --publicar
A prova: node scripts/regras/registrar-na-pr.js prova --pr <número> --head <SHA> --cobertura total|parcial --nota <arquivo> --publicar
-->
