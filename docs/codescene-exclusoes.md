# Exclusões do CodeScene

Esta é a lista que vai no painel do CodeScene, em Configuração do projeto › Exclusions & Filters › "Exclude content". Cada linha leva o nome do repositório na frente, como a documentação do CodeScene pede ("Exclude Specific Files and Folders from an Analysis").

```text
Nova-AI/**/index-Dun7lr2S*.js
Nova-AI/app/dist/assets/face-api.esm-*.js
Nova-AI/app/dist/assets/face_mesh-*.js
Nova-AI/**/marked.min.js
```

| Linha | O que tira da análise | Por quê |
| --- | --- | --- |
| `**/index-Dun7lr2S*.js` | O bundle da interface (`app/dist/assets/`) e a cópia reescrita em `interface/dist/` | Código gerado e minificado, sem fonte no repositório |
| `app/dist/assets/face-api.esm-*.js` | face-api | Biblioteca de terceiros embarcada pronta |
| `app/dist/assets/face_mesh-*.js` | MediaPipe Face Mesh | Biblioteca de terceiros embarcada pronta |
| `**/marked.min.js` | marked, em `app/electron/pwa/` | Biblioteca de terceiros minificada |

As pastas `{iphone,interface,distribuicao}/**/backup-*/` saíram da lista porque o repositório já não tem nenhum arquivo nelas (as cópias foram apagadas, e o histórico do git guarda os originais); `scripts/regras/configuracao.json` continua isentando-as nas regras. Se uma PR voltar a versionar código nelas, ela acrescenta a linha de volta, pois o teste confere que toda linha da lista casa com algum arquivo. A cópia do arquivo anterior do app instalado não fica no repositório: vai para `~/Nova-AI-reservas/` (`AGENTS.md` seção 5).

`app/dist/` inteira **não** sai: `app/dist/cam-live.js` e `app/dist/cam-live-audio.js` são código do CAM LIVE escrito à mão, carregado por `<script>` no `index.html`.

## Filtro por extensão

O painel tem ainda um filtro por extensão, o campo `exclusionfilter` da configuração do projeto, separado da lista acima. Ele guarda estas oito extensões, unidas por `;`:

```text
*.json
*.yml
*.sh
*.md
*.min.js
*.txt
*.html
*.css
```

O `*.h` saiu do filtro em 28/11, no começo da fase do iPhone (decisão 3 da [#134](https://github.com/vinicius928e8r84/Nova-AI/issues/134)), para o painel dar nota aos `.h` do proxy e ao `Pipeline.h`. O `exclusoes.test.js` barra a volta dele e de qualquer outra extensão de código que o painel analisa.

## Uma lista só

A lista `ignorarCodigo` de `scripts/regras/configuracao.json` (o que as regras do repositório isentam) e esta dizem a mesma coisa. `scripts/regras/test/exclusoes.test.js` confere, com os arquivos que o git versiona:

1. todo arquivo que esta lista tira da análise também é isento nas regras;
2. todo arquivo de código que as regras isentam também sai da análise;
3. toda linha desta lista ainda casa com algum arquivo.

Mudar uma das duas listas é mudar a outra na mesma PR. Mudar `configuracao.json` é mudar as regras: PR própria, atenção ALTA, revisão do dono (`CONTRIBUTING.md`). O painel do CodeScene não se atualiza sozinho: depois do merge, alguém copia o bloco acima para o painel e roda uma análise nova.

## Avisos suprimidos um a um

Fora das exclusões, o painel guarda avisos suprimidos método por método (o link Suppress do comentário do check da PR). Hoje são dois, e só estes:

| Arquivo | Método | Aviso | Por quê | Decidido |
| --- | --- | --- | --- | --- |
| `iphone/modelo/GanchosSysctl.m` | `ganchoSysctlbyname` (5 argumentos) | Excess Number of Function Arguments | O gancho substitui o `sysctlbyname` da libc e tem de ter a assinatura dele (ABI); nada a juntar num objeto | dono, 28/11, PR #310 |
| `iphone/modelo/GanchosSysctl.m` | `ganchoSysctl` (6 argumentos) | Excess Number of Function Arguments | Mesma razão, para o `sysctl` da libc | dono, 28/11, PR #310 |

Suprimir outro aviso é decisão do dono. Um gancho de função do sistema com a mesma razão entra nesta tabela na PR que o cria.
