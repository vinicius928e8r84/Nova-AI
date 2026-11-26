# A busca de memória só roda quando a mensagem pede

`search-vault-memory` devolve vazio, sem consultar nada, se a mensagem não contém uma palavra de `MEMORY_TRIGGER_KEYWORDS` (em inglês e hindi/urdu romanizado, como `remember`, `yaad`, `last time`). Pesquisar o cofre a cada mensagem simples do WhatsApp gastaria tokens da API sem necessidade. O custo é que uma pergunta sobre o passado sem nenhuma dessas palavras não recebe memória; a saída é acrescentar a palavra à lista.
