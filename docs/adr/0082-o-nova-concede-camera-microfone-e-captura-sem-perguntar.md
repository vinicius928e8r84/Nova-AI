# O Nova concede câmera, microfone e captura sem perguntar

A sessão padrão aceita os pedidos de `media`, `camera`, `microphone`, `videoCapture`, `audioCapture` e `desktopCapture` e recusa o resto. O manipulador de **checagem** de permissão também é substituído (não só o de pedido): sem ele o Electron bloqueia a câmera em silêncio, sem perguntar, e o usuário vê o alerta de erro. Com `NOVA_SMOKE_TEST=1` a checagem recusa tudo, para o teste de fumaça não abrir câmera.
