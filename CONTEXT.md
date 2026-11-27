# Nova-AI

O app desktop que controla celulares, câmeras e navegadores, e as regras que seguram a qualidade do código dele.

## Linguagem

### As regras que seguram a nota

**Teto**:
O máximo que uma medida de um arquivo (bytes, linhas, pontos de saúde do código ou comentários) pode ter depois de uma PR. Para um arquivo novo, é o limite da regra; para um que já passava do limite, é a medida dele na branch-alvo, e por isso o teto só desce.
_Evitar_: linha de base, limite (para o arquivo que já passava)

**Portão dos testes**:
A lista dos grupos de teste que a CI roda. Todo arquivo de teste do repositório está num grupo ou numa lista de fora, com o motivo escrito.
_Evitar_: lista fixa de testes

### O que fica fora do app

**Pacote do iPhone**:
O `.deb` que o Nova instala no aparelho: a câmera, o proxy, o idioma e o modelo.
_Evitar_: tweak, integração

**Patch da interface**:
O script que reescreve o bundle da tela do app, que não tem código-fonte.
_Evitar_: aplicador, integração
