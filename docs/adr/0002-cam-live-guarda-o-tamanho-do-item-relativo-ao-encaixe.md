# O CAM LIVE guarda o tamanho do item relativo ao encaixe, não em pixels

Cada item da lista de cenas guarda `rel`: quanto ele ocupa em relação ao seu encaixe "Ajustar" no canvas (`w`, `h`) e o centro em frações (`cx`, `cy`). Assim o tamanho não depende do formato de tela escolhido. Antes, o tamanho era gravado em pixels do formato atual e cada troca de formato multiplicava o item por um fator menor que 1, de modo que ir e voltar o encolhia.
