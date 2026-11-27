# Padrões de código: a lista curta do revisor

Este arquivo diz só o que o revisor julga. O que a máquina confere (comentário novo, tamanho, saúde do código, segredo, autoria, depuração esquecida) está no [`CONTRIBUTING.md`](CONTRIBUTING.md), junto com a regra de comentário e o teto que só desce. O trabalho em branch própria está no [`AGENTS.md`](AGENTS.md). Os nomes do projeto (teto, portão dos testes, pacote do iPhone, patch da interface) estão em `CONTEXT.md`.

Nenhum item deste arquivo é regra da máquina. Quem confere é o revisor, e cada item diz o que ele procura.

## 1. A lista curta, e o que não está nela

Os itens 2 a 7 são tudo o que o revisor julga além do `CONTRIBUTING.md`. O que não está nesta lista segue o código em volta: o mesmo nome, a mesma estrutura e a mesma forma de tratar erro do arquivo que a PR toca. Preferência de estilo do revisor não é achado.

## 2. Os três níveis do veredito

Todo achado do revisor cai em um destes três níveis, e o nível diz o que acontece com a PR:

- **bloqueia**: o achado é ALTA, ou é uma regressão contra a `main`. A PR não é mesclada até o autor consertar, e o conserto é um commit novo (o head muda, e a revisão do head anterior deixa de valer).
- **conserta se for barato**: o achado é MÉDIA e novo, isto é, a PR o introduziu. O autor conserta na própria PR quando custa pouco; quando custa muito, vira issue e a PR segue.
- **vira issue**: todo o resto. O revisor abre a issue, a PR cita o número e segue sem consertar.

Como separar os níveis:

- **ALTA** é o que pode quebrar o app de quem usa, perder dado, vazar segredo, abrir uma porta que as regras fecham (afrouxar uma regra, um workflow, a lista de caminhos sensíveis) ou deixar o aparelho num estado que o app não desfaz.
- **MÉDIA** é o que funciona hoje mas quebra no caso vizinho: um caminho de erro sem tratamento, um caso que o teste novo não cobre, um nome que engana.
- **Regressão contra a `main`** é o que funcionava na `main` e deixou de funcionar, ou o que fazia a nota subir e fez descer. Achado antigo que a PR não tocou não é regressão: vira issue.

Esses níveis medem o achado. A linha `Atenção:` da PR e o `Risco:` do registro medem a mudança e pedem prova real (`CONTRIBUTING.md`, "O corpo da PR"); uma mudança ALTA pode ter revisão sem nenhum achado que bloqueie, e uma BAIXA pode ter um.

O `Veredito: CLEAN` do registro só vale sem achado que bloqueia. Os achados que ficaram como issue entram no corpo da PR com o número.

## 3. Teste novo exercita a função, não lê o texto do código

O teste novo chama a função, a rota ou o comando com uma entrada e compara a saída ou o efeito com um valor concreto. Um teste que lê o arquivo-fonte e procura um trecho (`readFileSync` do `.js` seguido de `includes` ou de uma expressão regular) passa quando o código está errado e falha quando alguém renomeia uma variável.

O revisor procura:

- teste que abre o fonte do que deveria exercitar;
- teste que repete no esperado a mesma conta que o código faz, em vez de um valor escrito à mão;
- teste que não falharia se a função fosse apagada.

Quando o produto é o próprio texto (o patch da interface que reescreve o bundle, o arquivo que uma ferramenta gera), conferir o texto do resultado é exercitar o produto. Isso vale para o texto que o código gerou, não para o texto do código que o gera, e o nome do teste diz qual dos dois ele confere.

Os testes de caracterização do app (`palco`, `cenas` e `esperado`, em `app/test/` e `app/electron/services/test/`) já seguem isso: rodam o código e comparam com o que ele fazia antes.

## 4. Arquivo novo é carregado onde é usado

Um arquivo novo que ninguém carrega é código morto desde o primeiro dia, e o ESLint não vê. O revisor confere, para cada arquivo novo, onde ele entra:

| O arquivo novo é | Ele é carregado em |
| --- | --- |
| serviço ou módulo do app | o `require` de quem o usa, ou o registro no `app/electron/main.js` |
| ponte entre a interface e o app | o `app/electron/preload.js` e o canal em `app/electron/main.js` (mexer nisso é atenção ALTA) |
| arquivo que precisa ir dentro do pacote do app | a lista `build.files` ou `extraResources` de `app/package.json`; um arquivo que o `files` exclui não chega ao usuário |
| arquivo para o pacote do iPhone, o Mac ou o patch da interface | o script que o instala ou o empacota, na pasta da própria área |
| teste | o portão dos testes (item 6) |
| ferramenta de regra | `scripts/regras/verificar.js` |

O que não tem lugar nessa tabela entra com a linha, no corpo da PR, de onde é carregado. Se a resposta é "ninguém ainda", a PR diz qual PR seguinte o liga, com o número.

## 5. A PR diz a sua issue

A PR diz, no corpo, a qual issue pertence, de uma destas três formas:

- `Closes <URL da issue>`: a PR entrega o que a issue pede, e a issue fecha com o merge.
- `Refs <URL da issue>`: a PR entrega uma parte, e a issue segue aberta.
- `Prova que falta: <o que ainda não foi provado e onde se prova>`: a PR entrega o código, mas parte da prova depende de algo que a PR não pôde rodar (o aparelho, o Mac, o Windows). A frase fica no corpo, junto com `Closes` ou `Refs`, e é o que o revisor e o dono leem para saber o que falta, no lugar de abrir à mão uma issue de prova pendente.

O revisor cobra isso à mão: o check `Registro da PR` não olha a issue. PR sem nenhuma das três não tem como o revisor saber o que ela devia entregar, e volta ao autor.

## 6. Todo teste está no portão dos testes

Teste que a CI não roda não protege nada: ele passa na máquina de quem o escreveu e ninguém vê quando quebra. O revisor confere que todo arquivo de teste que a PR cria está no que a CI roda.

Hoje o que a CI roda está no `.github/workflows/regras.yml`: os testes de `app/` são achados por glob, os de `MAC/` estão numa lista de nomes (um teste novo de `MAC/` precisa entrar nela) e os das regras são os de `scripts/regras/test/`. O portão dos testes (ticket #180) troca essa lista por uma lista de grupos e por um teste que falha com arquivo de teste fora dela; depois que ele entrar, o arquivo de teste novo tem de estar num grupo, ou numa lista de fora com o motivo escrito.

Um teste que passa só no Mac ou só com o aparelho ligado não vai para o portão como se rodasse na CI: ele diz, no nome ou na issue ligada, onde se roda, e a PR registra `Prova que falta:` (item 5) quando não deu para rodar.

## 7. O diff toca X: leia Y antes de julgar

Cada área tem um documento que diz o que ela faz hoje e por quê. O revisor lê o da área que o diff toca antes de dizer que algo está errado, porque muita decisão estranha tem a razão escrita lá.

| O diff toca | Leia |
| --- | --- |
| `app/` (o app, o processo principal, os serviços) | [`app/README.md`](app/README.md) |
| o canal IPC ou o `preload` | `app/test/mapa-ipc.json` e o teste `app/test/mapa-ipc.test.js`, que guardam a lista de canais |
| qualquer coisa que muda de comportamento no Windows | [`docs/windows.md`](docs/windows.md) e `docs/adr/0014-o-comportamento-do-windows-nao-muda-ao-acrescentar-o-macos.md` |
| `MAC/` (qualquer área) | [`MAC/LEIA-ME.md`](MAC/LEIA-ME.md), que guarda o estado e a história, e o README da área |
| `MAC/integracao-iphone/` | [`MAC/integracao-iphone/README.md`](MAC/integracao-iphone/README.md) e [`MAC/integracao-iphone/conexao-usb/README.md`](MAC/integracao-iphone/conexao-usb/README.md) |
| `MAC/controle-celular-plataformas/` | [`MAC/controle-celular-plataformas/README.md`](MAC/controle-celular-plataformas/README.md) |
| `MAC/proxy-iphone/` | [`MAC/proxy-iphone/README.md`](MAC/proxy-iphone/README.md) |
| `MAC/integracao-sequestro-cam/` | [`MAC/integracao-sequestro-cam/README.md`](MAC/integracao-sequestro-cam/README.md) |
| `MAC/integracao-modelo/` ou `MAC/integracao-modelo-app/` | o `README.md` da pasta que o diff toca |
| o CAM LIVE (`app/electron/services/cam-live*`, `MAC/integracao-camlive/`) | os registros de `docs/adr/` que têm `cam-live` no nome |
| as regras, os ganchos, a CI ou a lista do painel | [`CONTRIBUTING.md`](CONTRIBUTING.md) e `docs/codescene-exclusoes.md` |
| uma decisão que o código ou o comentário apagado guardava | `docs/adr/`, onde cada decisão tem um arquivo próprio |
| arquivos do app instalado, ou o que precisa reaplicar no Mac | a seção 5 do [`AGENTS.md`](AGENTS.md) |

A tabela diz onde ler, não o que cobrar. Se o diff muda o que o documento descreve, o documento muda na mesma PR; documento que continua dizendo o contrário do código é um achado MÉDIA.

Quando a tabela e as pastas divergem (uma pasta foi movida), vale a pasta, e quem moveu a pasta corrige a tabela na mesma PR. O teste `scripts/regras/test/padroes-de-codigo.test.js` falha quando um caminho citado aqui deixa de existir.
