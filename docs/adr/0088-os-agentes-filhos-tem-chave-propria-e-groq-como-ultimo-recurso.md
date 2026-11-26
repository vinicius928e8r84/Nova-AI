# Os agentes filhos têm chave própria e o Groq como último recurso

O enxame usa a chave de API dedicada dos agentes filhos (`getChildAgentKeyPath`, mais de 20 caracteres) quando ela existe, para não dividir a cota com a conversa ao vivo do Nova. Também entrega ao controlador do enxame a chave de `groq_key.json`, que tem cota totalmente separada, como último recurso.
