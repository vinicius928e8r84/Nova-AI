# A captura de tela lista só telas, nunca janelas

`get-screen-sources` pede ao `desktopCapturer` apenas `types: ['screen']`. Uma fonte do tipo janela captura o conteúdo de um aplicativo à parte do compositor: se uma janela do navegador for escolhida, o vídeo mostra o navegador mesmo quando ele está atrás do Nova. A fonte do tipo tela captura a saída composta real. Quem precisar de janelas deve criar outro canal, não ampliar este.
