# O comportamento do Windows não muda ao acrescentar o macOS

`platform-utils.js` é o único lugar que decide a plataforma, e os serviços chamam seus auxiliares em vez de espalhar `process.platform`. A regra é que o comportamento do Windows nunca muda: os ramos de macOS e Linux entram ao lado do caminho do Windows, nunca no lugar dele (`if (isWindows) { …código original… } else if (isMac) { …equivalente… }`). Por isso a lista de executáveis do Chromium do Playwright mantém o caminho do Windows exatamente como estava, e o User-Agent do Windows é a string que o app sempre usou.

A pasta `bin/` empacotada é procurada primeiro no caminho de produção e só depois no de desenvolvimento, porque no app empacotado o caminho de desenvolvimento cairia dentro do `asar`, onde processos filhos não conseguem executar.
