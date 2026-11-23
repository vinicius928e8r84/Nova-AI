# O CAM LIVE guarda o tamanho de cada item relativo ao encaixe, não em pixels do formato

Cada item da lista de cenas guarda `rel`: quanto ele ocupa em relação ao seu encaixe (o tamanho "Ajustar", sem cortar, dentro do quadro) e onde fica o centro, em frações da largura e da altura. O quadro em pixels (`frame`) é recalculado a partir de `rel` a cada troca de formato (`captureRel` e `applyRel` em `app/dist/cam-live.js`).

Antes, a troca de formato (celular, computador, HD, Full HD, deitado, em pé) reescalava o `frame` direto, e cada troca multiplicava o tamanho por um fator menor que 1: ir e voltar encolhia o item. Como `rel` não depende do formato, trocar de formato e voltar devolve exatamente o mesmo item. Os modos Ajustar, Preencher e Esticar apagam `rel` e continuam encaixados em qualquer formato.
