---
name: delete-comment
description: "Use ao limpar os comentários de código do Nova-AI: classifica cada comentário (tautologia, desculpa, velho ou registro de decisão), apaga, abre issue para a gambiarra desculpada e leva a decisão para um ADR."
---

# /delete-comment

Tira os comentários que o repositório ainda tem e deixa a catraca `teto-de-comentarios` descer. A base é: **a codebase é a fonte única da verdade**. Comentário envelhece sozinho e o próximo agente o copia como regra.

## As quatro classes e a ação de cada uma

| Classe | O que é | Ação |
| --- | --- | --- |
| Tautologia | repete o que o código já mostra | apagar |
| Velho | cita código, arquivo, fluxo ou versão que não existe mais | apagar |
| Desculpa | deixa passar uma implementação ruim (`HACK`, `workaround`, `por enquanto`, `TODO`, `não sei por que funciona`, "temporário") | apagar e abrir uma issue para consertar a gambiarra |
| Registro de decisão | explica uma decisão não óbvia, com trade-off, ou cara de reverter (tempo, tokens ou outro recurso) | levar para um ADR em `docs/adr/` e apagar |

A régua do ADR é estreita. Só passa o que atende a pelo menos um: não é óbvio, tem trade-off real, ou é caro de reverter. O que não passa nessa régua é Tautologia ou Velho e sai sem ADR. Na dúvida entre Registro e Tautologia, pergunte se alguém que só lê o código erraria sem a frase: se não erraria, apague. Antes de apagar uma Tautologia, veja se o nome da função ou da variável diz o que o comentário dizia; se não diz, **renomeie** (o nome carrega a ideia).

Fora do escopo, porque não são prosa: shebang, `@ts-*`, `noqa`, `type: ignore`, `istanbul`/`c8 ignore`, `prettier-ignore`, `coding:` e cabeçalho de licença. A regra já os deixa passar; não mexa neles. Docstring de Python **entra** (decisão do dono).

## Passo a passo

1. **Parta da `main` atual.** `git fetch origin && git switch -c agent/<ferramenta>/comentarios-<area>-AAAAMMDD origin/main`. Uma PR pequena por área (uma pasta ou um grupo de arquivos vizinhos). **Não mexa em arquivos que outra branch `fm/*` ou outra tarefa aberta já está limpando**: confira com `git branch -r` e com as PRs abertas antes de escolher a área.
2. **Veja quanto falta.** `node .claude/skills/delete-comment/comentarios.js restantes [prefixo] [--por-pasta]` conta, arquivo a arquivo ou pasta a pasta, as linhas de comentário que ainda existem (as mesmas que a catraca conta). O total é a estimativa das linhas que a limpeza tira.
3. **Liste os comentários do arquivo.** `node .claude/skills/delete-comment/comentarios.js listar <arquivo>... [--json]` mostra cada bloco (`//` seguidos, `/* */`, `#`, docstring) com as linhas e o texto. As diretivas não aparecem.
4. **Leia o código em volta de cada bloco e classifique.** Não classifique pelo texto sozinho: abra o trecho do código e confira se a frase ainda é verdade (Velho) e se o código faria sentido sem ela (Tautologia). Anote a classe de cada bloco.
5. **Apague.** `node .claude/skills/delete-comment/comentarios.js apagar <arquivo> <linhas>...` (por exemplo `12-15 40`). Ele apaga só os blocos que cobrem as linhas dadas, preserva o fim de linha (CRLF) e recusa tirar a docstring que é o único corpo de um bloco. Para um comentário que pede renomear algo, renomeie à mão antes.
6. **Desculpa:** abra uma issue por gambiarra, não por comentário. Título com o efeito ("A ponte do iPhone repete a conexão sem limite"), corpo com o arquivo e a função, o que está errado, o que o comentário dizia e como consertar. Use `gh issue create --label divida-tecnica` (crie o rótulo se faltar). Cite a issue no corpo da PR. Não deixe o número da issue no código.
7. **Registro de decisão:** escreva o ADR em `docs/adr/NNNN-slug.md` (crie a pasta se faltar; o número é o maior existente mais um). Formato: título curto da decisão e de 1 a 3 frases com o contexto, o que se decidiu e por quê. Seções extras (Status, Opções consideradas, Consequências) só quando acrescentam. Um ADR pode reunir vários comentários da mesma decisão. Aponte o ADR no corpo da PR.
8. **Prove que só saiu comentário.** `node .claude/skills/delete-comment/comentarios.js conferir origin/main` diz, por arquivo, se o código ficou idêntico: em JavaScript, tokens e quebras de linha iguais; em Python, a mesma árvore (`ast`) sem docstrings. Para shell, Objective-C/Logos, HTML e CSS essa prova não existe: rode `bash -n`, `node --check` no JavaScript embutido ou o teste da área e diga na PR o que rodou.
9. **Rode a catraca.** `PYTHON=python3 node scripts/regras/verificar.js --base origin/main`. Depois de apagar, a regra avisa "a linha de base pode descer". Não precisa baixá-la na PR de limpeza (muda `scripts/regras/linha-de-base.json`, que é caminho sensível e conflita entre PRs): quem une a série baixa tudo de uma vez com `node scripts/regras/verificar.js --atualizar-linha-de-base --regra teto-de-comentarios`. Arquivo que chega a zero fica proibido de voltar a ter comentário.
10. **Abra a PR** com o corpo de `.github/PULL_REQUEST_TEMPLATE.md`: quanto saiu (linhas e blocos), por classe; os ADRs; as issues das Desculpas; a prova do passo 8. A atenção é BAIXA quando a PR só tira comentário de arquivo JavaScript ou Python (o `Registro da PR` os tira da classificação de caminho sensível); arquivo de shell, Objective-C/Logos, HTML ou CSS em caminho sensível mantém a PR em ALTA, com a prova real. Nada de merge: quem une é o responsável.

## Cuidados

- **Não toque no que uma `fm/*` ou outra tarefa já limpa.** Se o arquivo está na lista de outra tarefa, deixe: a catraca o cobre.
- **Não traduza nem mexa em valores de spoofing** (nomes de GPU, modelos de celular): comentário e código ficam como estão, só o comentário sai.
- Um comentário que carrega a quebra de linha numa instrução sem ponto e vírgula (`return /* ... */ valor`) muda o programa se sair: a conferência do passo 8 pega.
- `__doc__` em Python: se o arquivo o usa, a docstring é código (por exemplo, a ajuda do `argparse`). A conferência recusa.
- As cópias de reserva (`reservas/`, `backup-*`) foram apagadas do repositório; o histórico está em `git show 1b45c3f:<caminho>`. Para o app instalado, siga `AGENTS.md` seção 5.
- Nenhum comentário novo, nem em código novo da própria limpeza: a regra `sem-comentario-novo` falha a PR.

## Estimar a limpeza

`restantes` já dá o número: cada linha de comentário apagada é uma linha de código a menos, e o `apagar` fecha o buraco em branco duplo que o bloco deixaria. As docstrings de Python já estão na conta.
