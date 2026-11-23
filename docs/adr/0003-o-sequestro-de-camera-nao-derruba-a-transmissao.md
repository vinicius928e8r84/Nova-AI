# O sequestro de câmera só troca a fonte e nunca derruba a transmissão

No `ios-camera.js` há dois papéis: a transmissão (sobe o servidor MJPEG e o túnel e alimenta a câmera com o vídeo do Mac) e o sequestro (item 3 da aba), cujos `startCamSpoof` e `stopCamSpoof` apenas trocam a fonte da câmera entre injetada e real. O sequestro não derruba o servidor nem o túnel locais nem o CAM LIVE em andamento.

Quando o sequestro assume o controle, ele suspende o renovador da transmissão local, que reescreveria o controle a cada 20 segundos; daí em diante quem decide a fonte da câmera é o sequestro, e o CAM LIVE pausa em vez de morrer com erro.
