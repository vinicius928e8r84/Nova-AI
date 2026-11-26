# O perfil de contexto do usuário limita as tentativas e nunca lança erro

A atualização do contexto do usuário (`user-profile-manager.js`) chama o Gemini em segundo plano e foi desenhada para nunca atrapalhar o app: depois de 3 falhas na sessão um interruptor a desliga até reiniciar, e entre tentativas ela espera 15 minutos. Usa estritamente a `v1beta`, para na primeira resposta 404 (o modelo não existe para a chave) e zera a contagem de falhas quando dá certo. Nunca lança erro para quem chama, para o processo principal continuar "Online".

Para a amostra não estourar o pedido, ela junta as 5 conversas mais recentes do frontend, as 100 atividades mais recentes do `MyActivity.json` e as notas do Vault, e corta o conjunto em cerca de 50 mil caracteres.
