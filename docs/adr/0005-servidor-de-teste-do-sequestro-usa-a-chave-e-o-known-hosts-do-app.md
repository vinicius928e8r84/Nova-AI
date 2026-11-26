# O servidor de teste do sequestro de câmera usa a chave e o known_hosts do app

O `prototype-sequestro-cam/servir.py` abre a conexão-mestre SSH antes, com a mesma chave que o app usa e no mesmo `ControlPath` do `phone.sh`, porque o `phone.sh` pede autenticação interativa quando não encontra conexão-mestre. A chave vem da pasta do app (`Application Support/nova_dsktp/iphone-ssh`) e só depois de `~/.ssh`, pois o reset do jailbreak apagou `~/.ssh/id_iphone` e a chave viva é a do app.

O `known_hosts` também é o do app, com `StrictHostKeyChecking=accept-new`: depois de cada reset do aparelho a chave de host muda e o `known_hosts` de `~/.ssh` guarda o carimbo velho, que o `yes` recusaria. A pasta da ponte (`NOVA_BRIDGE`, depois ao lado do repositório, depois os caminhos antigos) tem essa ordem porque a ponte vive fora do repositório e já mudou de lugar uma vez.
