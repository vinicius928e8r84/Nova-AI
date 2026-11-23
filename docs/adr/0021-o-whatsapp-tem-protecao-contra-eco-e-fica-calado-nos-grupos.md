# O WhatsApp do Nova tem proteção contra eco e fica calado nos grupos

O `whatsapp-manager.js` trata o chat do próprio dono (conversa consigo mesmo) como o canal de comando: só ali, ou quando um comando é pedido de forma explícita, ele executa comandos de terminal remoto (`!lock`, `!browser`, `!busy`, `!status`…). Mensagens do dono para si mesmo são tratadas como comando; mensagens que o próprio Nova envia a outras pessoas não.

Para não responder a si mesmo, a mensagem passa por deduplicação (primeiro pelo ID da mensagem, depois pelo corpo, para o processamento duplo em sequência) e por duas proteções contra laço: ignora os marcadores das respostas do próprio bot e ignora as respostas que o Nova enviou a convidados (`fromMe` para um chat que não é o do dono), mas deixa passar o chat do dono falando com o Nova. O ID de cada captura de tela enviada é registrado em seguida, para o eco dela não ser processado.

Grupos são monitorados em silêncio: o Nova nunca responde sozinho num grupo, só se o dono mandar. A resposta automática de ocupado (`busy`) vale só para mensagens diretas, e o texto dela vem do persona no renderer. O envio de respostas imita digitação (espera de 1 a 2,5 s, estado "digitando" e duração proporcional ao texto, no máximo 4 s).
