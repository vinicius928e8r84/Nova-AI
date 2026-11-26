# A chave SSH do iPhone pertence ao app, não ao `~/.ssh` do Mac

Antes, todos os serviços usavam `~/.ssh/id_iphone`, que o usuário do macOS compartilha: qualquer processo ou agente com acesso ao home podia usá-la. Agora a chave fica em `<userData>/iphone-ssh/` com permissão `0600`, e cada chamada `ssh`/`scp` usa `-i` explícito com `IdentitiesOnly`, sem cair em outras chaves do agente. `migrateLegacy()` move a chave antiga na primeira execução (uma vez, no boot) e o `known_hosts` do app herda a linha `[127.0.0.1]:2222` do antigo; sem `known_hosts` antigo, o próximo Conectar grava o pin.

O `UserKnownHostsFile` vai entre aspas porque o parser de configuração do `ssh` separa por espaço: sem elas, `…/Application Support/…` virava `…/Library/Application` e o `ssh` lia outro arquivo (a chave de host velha), e o app recusava com "Senha aceita, mas a chave de acesso não foi validada".
