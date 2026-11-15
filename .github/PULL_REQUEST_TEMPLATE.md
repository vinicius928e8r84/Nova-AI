## Resumo

<!-- O que muda no app e nos fontes, e por quê. Texto de comentário de HTML não conta. -->

## Evidência

<!-- O que você rodou e o que apareceu (testes, node --check, tela, log). -->

## Arquivos do app instalado trocados

<!-- Quais arquivos de /Applications/Nova AI Mac.app mudaram e como reaplicar (AGENTS.md seção 5). Escreva "nenhum" se não mexeu. -->

Atenção:

<!--
A linha "Atenção:" leva só BAIXA, MÉDIA ou ALTA.
ALTA é obrigatória se a PR mexe em caminho sensível (scripts/regras/caminhos-sensiveis.json) e exige a seção abaixo:

## Prova real

PROVADO 100% REAL
Head: <SHA inteiro do head, 40 caracteres: git rev-parse HEAD>

Depois do último commit, registre a revisão independente (outro autor, outro revisor):
node scripts/regras/registrar-na-pr.js revisao --pr <número> --head <SHA> --autor <quem> --revisor <quem> --publicar
-->
