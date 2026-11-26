# O Mac fala com a câmera por socket Unix, com token de 32 hex no caminho (0.1-39)

Quando o Mac abre um socket Unix pelo túnel USB, nenhuma porta TCP fica escutando no aparelho, e a câmera só aceita um caminho com token de 32 caracteres hexadecimais: `/s/<token>/frame.jpg`, 3 + 32 + 10 caracteres, que é a conta da constante `expected` no `Tweak.x`. O pedido é um `GET` HTTP/1.0 pelo socket Unix e devolve o corpo, ou nil em erro ou tempo esgotado.

Esse socket pode bloquear até o tempo limite; por isso a busca do áudio por ele roda numa fila global à parte (`QOS_CLASS_USER_INITIATED`), para não prender a fila do áudio.
