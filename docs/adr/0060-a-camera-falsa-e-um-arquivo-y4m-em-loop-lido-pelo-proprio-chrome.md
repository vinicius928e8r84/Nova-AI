# A câmera falsa é um arquivo Y4M em loop que o próprio Chrome lê

O `GlobalSpoofService` entrega a câmera falsa pelo laço nativo de arquivo de vídeo do Chrome: o serviço grava um arquivo `fake_cam.y4m` e abre o Chrome apontando para ele como fonte da webcam. A alternativa seria injetar o fluxo por script na página ou pelo CDP. Escolhemos o arquivo porque o laço de vídeo do Chrome fica abaixo da página e por isso não esbarra em CSP, em iframes nem na latência do CDP.

A consequência é que o serviço não escreve quadros: quem lê o arquivo é o Chrome. Os métodos que antes alimentavam um driver de câmera virtual (registro do Windows, driver do OBS, escrita de quadros, transformação ao vivo) deixaram de fazer algo e ficaram como casca; ver a issue de dívida técnica aberta para eles.
