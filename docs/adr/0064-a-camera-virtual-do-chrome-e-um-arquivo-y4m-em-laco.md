# A câmera virtual do Chrome é um arquivo Y4M em laço

O `GlobalSpoofService` usa o laço nativo de arquivo de vídeo do Chrome (`fake_cam.y4m`) para injetar a câmera. Isso contorna os bloqueios de CSP, os iframes e a latência do CDP, e dispensa o driver virtual do OBS. Por isso o envio de quadros pelo canal `virtual-cam:stream-chunk` não faz nada nesse modo.
