# O CAM LIVE só publica o áudio dos arquivos das cenas

O áudio da transmissão vem somente dos elementos `<video>` e `<audio>` colocados nas cenas e ligados ao mixer com `attach`. O módulo `cam-live-audio.js` nunca chama `getUserMedia` e nunca captura o microfone nem o áudio do computador. Decidimos assim para que nada que o usuário não colocou na cena possa sair ao vivo; é uma regra inegociável, não uma preferência.

Consequência não óbvia: os elementos de mídia não podem ser criados com `muted`, porque o som sai pelo grafo do mixer e não pelo elemento. Mutar o elemento silencia a transmissão.
