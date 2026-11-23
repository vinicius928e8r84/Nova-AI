# O CAM LIVE publica RTMP com um cliente próprio em JavaScript, sem ffmpeg

O renderer captura, compõe e codifica (H.264 e AAC por WebCodecs) e manda os pacotes ao processo principal, que fala RTMP direto com o servidor: handshake, FLV e AMF0 próprios, fila com descarte por prioridade, bitrate dinâmico (DBR) e reconexão. A lógica reproduz a saída `rtmp_output` do OBS, que o projeto usa como referência de comportamento. O áudio nunca é descartado; só o vídeo cai quando a fila atrasa.

Não há processo `ffmpeg` no caminho da transmissão; o `ffmpeg -listen` só aparece nos testes de ponta a ponta, no papel de servidor RTMP.
