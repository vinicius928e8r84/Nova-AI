# O Kling salva o vídeo exportado copiando o arquivo

`kling:save-video` remove o prefixo `file://` do caminho e copia o arquivo real. Baixar uma URL `file://` pelo Chromium é bloqueado e gerava uma página HTML quebrada no lugar do vídeo.
