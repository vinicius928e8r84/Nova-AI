# Amostras do OBS saem com um nome de porta que o mediaserverd já aceita

O destino remoto de fila (`RemoteQueue`) converte o `PortType` do `MetadataDictionary` de cada amostra com `_BWActiveDeviceTypeFromPortType`, que levanta `NSException` para qualquer nome fora da sua lista fixa. O nosso `OBSBridgeVideo` está fora dela: em 02/11 a primeira amostra renderizada no Safari derrubou o `mediaserverd` com SIGABRT (relatório `mediaserverd-safari-2026-11-02-230934.ips`).

O `Tweak.x` reescreve os nomes de porta na fronteira do destino, apresentando as amostras sob um nome que o pipeline já aceita, e segura dentro do destino qualquer exceção residual para ela não reiniciar o serviço inteiro. A reescrita vale só para as amostras que nós marcamos; as das câmeras de verdade passam intactas.
