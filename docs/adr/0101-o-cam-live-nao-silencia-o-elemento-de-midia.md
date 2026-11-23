# O CAM LIVE nunca silencia o elemento de mídia: o áudio dos itens sai pelo grafo do mixer

Os vídeos e áudios da lista de cenas tocam em elementos `<video>` e `<audio>` criados em `mountFile` (`app/dist/cam-live.js`). O elemento não usa `muted`: o som de cada item é lido do elemento pelo mixer (`window.CamLiveAudio`), e o mudo de cada item é aplicado no grafo, não no elemento. Silenciar o elemento calaria também a entrada do mixer e a transmissão ficaria sem áudio.

O CAM LIVE só captura o áudio dos vídeos e áudios da lista, nunca o microfone nem o áudio do computador.

Duas outras decisões que viviam em comentário: o compositor fica ocioso (sem desenhar nem enviar quadro) quando a janela está fechada e não há transmissão, e a captura só roda para o que está visível, como o OBS desativa as fontes fora de cena.
