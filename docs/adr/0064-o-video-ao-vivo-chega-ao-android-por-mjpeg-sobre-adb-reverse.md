# O vídeo ao vivo chega ao Android por MJPEG sobre `adb reverse`

O PC sobe um servidor HTTP MJPEG na porta 8899 (padrão de `startLiveStream`) e abre um túnel `adb reverse`; o módulo LSPosed no telefone lê os quadros em `http://127.0.0.1:8899/stream`. O canal `physical-mobile:push-live-frame` entrega os quadros do painel à razão de cerca de 30 por segundo e por isso usa `ipcMain.on`, não `handle`. Mudar a porta exige mudar o módulo do telefone.
