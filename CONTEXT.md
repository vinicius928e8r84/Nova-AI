# Nova-AI

O app desktop que controla celulares, câmeras e navegadores, e as regras que seguram a qualidade do código dele.

## Linguagem

### As regras que seguram a nota

**Teto**:
O tamanho máximo que um arquivo pode ter depois de uma PR. Para um arquivo novo, é o limite da regra. Para um arquivo que já passava do limite, é a medida que ele tem na branch-alvo, e por isso o teto só desce.
_Evitar_: linha de base (para o tamanho), limite (para o arquivo que já passava)

**Portão dos testes**:
A lista dos grupos de teste que a CI roda. Todo arquivo de teste do repositório está num grupo ou numa lista de fora, com o motivo escrito.
_Evitar_: lista fixa de testes
