# O estado do app fica em `userData`, nunca dentro do bundle

O acesso remoto grava `REMOTE_ACCESS_INFO.txt` (e os tokens) na pasta `userData`, nunca dentro do `.app`: escrever dentro do bundle quebraria a assinatura de código do macOS. O mesmo vale para qualquer arquivo novo que o app crie em tempo de execução.
