# O juiz, a caracterização e a quebra de propósito de cada corte

Parte da pesquisa [O corte do `global-spoof-service.js`](README.md).

## 5. Para cada corte: testes, caracterização e prova real

### O que os testes de hoje cobrem

Medi com cobertura:

```
node --test --experimental-test-coverage --test-coverage-include='app/electron/services/global-spoof-service.js' app/test/chromium-revisao-windows.test.js MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs
```

O resultado foi **7,33% das linhas e 5,56% das funções**. Só as partes de `_findChrome` para Windows rodam. Os testes que tocam o serviço são:

| Teste | O que confere | Onde roda |
|---|---|---|
| `app/test/chromium-revisao-windows.test.js` (3 testes) | `_findChrome` acha o Chromium empacotado, cai nele quando o navegador pedido não existe, e devolve `null` sem nenhum | em qualquer sistema (finge `win32`); passaram aqui |
| `MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs:97` | o texto do arquivo usa `toolPaths.ffmpeg()` | em qualquer sistema; passou aqui |
| `app/test/paridade-b.test.js:133` | o padrão do `pkill` do Mac só mata o Chrome com o Y4M do `nova_webcam_hijack` (testa `paridade-utils.js`, não o serviço) | só em Unix; no Windows falha com `ENOENT` |
| `scripts/regras/test/registro.test.js:75` | o caminho conta como ALTA | em qualquer sistema |

Nada cobre o perfil, a identidade, o proxy, os argumentos do Chrome, o Y4M, o áudio, o script da página, o CDP, a vigia do e-mail nem o `stopHijack`.

### Os testes de hoje como juiz: quebras de propósito no código atual

Para saber se algum teste de hoje julga um corte, quebrei de propósito o `global-spoof-service.js` da `main` (`f87f6ea`), uma quebra por vez, e rodei os cinco testes que tocam o serviço ou o que ele usa:

```
node --test --test-reporter=spec app/test/chromium-revisao-windows.test.js MAC/integracao-iphone/conexao-usb/tool-paths.test.cjs scripts/regras/test/registro.test.js app/test/paridade-b.test.js app/electron/services/test/nova-desktop-parity.test.js
```

No Windows, sem quebra nenhuma, o resultado já é 48 passando e 4 falhando: os dois testes de `pkill` do Mac e dois de `tool-paths.test.cjs` (`ffmpeg no Mac…` e `sshOptions no Mac…`) esperam caminhos de Unix. Na CI, que roda em Linux, eles passam. Cada quebra foi desfeita antes da seguinte, e o `git status` ficou limpo no fim.

| Quebra | Onde | Resultado | Pega? |
|---|---|---|---|
| o rótulo da trilha da câmera vira `FaceTime HD Camara` | o texto do script da página (corte 1) | 48 e 4, iguais à base | **não** |
| a marca `FHD Web Camera` vira `FHD Web Camara` | `ensureProfileStealthSpecs` (corte 2) | 48 e 4 | **não** |
| `--use-file-for-fake-video-capture` ganha um `x` | os argumentos do Chrome (corte 4) | 48 e 4 | **não** |
| `Page.addScriptToEvaluateOnNewDocument` ganha um `X` | o script em cada alvo do CDP (corte 5) | 48 e 4 | **não** |
| as duas chamadas a `findBundledChromiumExecutable` do `_findChrome` viram `null` | o `_findChrome` (corte 4) | 46 e 6: `global-spoof-service _findChrome acha chromium-1248 empacotado` e `…cai no chromium empacotado…` | sim |
| o `|| 'ffmpeg'` do construtor vira `|| 'ffmpeg.exe'` | a linha que o teste procura no texto | 47 e 5: `spoof e pré-escuta não montam caminho de ffmpeg…` | sim |

**Conclusão:** para os cortes 1, 2, 3 e 5, e para quase todo o 4, não existe juiz hoje. A caracterização abaixo é o juiz, e tem de existir antes do primeiro corte.

No mesmo código de hoje, rodei também o `startHijack` com `profile: 'Default'`, `device: { id: 'desktop' }` e sem `regional`, com o `userData` numa pasta temporária: ele rejeitou com `Cannot read properties of undefined (reading 'includes')`, e o log mostrou a limpeza de órfãos do Windows falhando (`Failed to run Chrome cleanup: Command failed: powershell -NoProfile -Command "Get-CimInstance …`). Os defeitos 1 e 3 da seção 7 ([achados-e-fontes.md](achados-e-fontes.md)) continuam na `main` de hoje.

### A caracterização: um palco para o spoof

A caracterização segue o molde de `app/electron/services/test/browser-manager.{palco,cenas,esperado}.js`: um diário gravado em JSON, conferido com `deepStrictEqual` e com a ordem das chaves. Ela vai num commit antes do primeiro corte e passa no código de hoje. O palco precisa fingir estas peças:

- **`child_process`:** `spawn`, `spawnSync` e `execSync` anotam os argumentos. O `spawn` do ffmpeg fecha com código 0 e escreve o Y4M, e o do Chrome devolve um PID fixo.
- **`fs`:** numa pasta temporária, com `listaEmOrdem` e `marcarCaminhos` de `caminhos-do-palco.js`.
- **`os.tmpdir`** e **`app.getPath('userData')`** apontando para essa pasta. **`process.platform`** alternando entre `win32` e `darwin`.
- **`chrome-remote-interface`:** `Version`, `CDP()`, `send`, `Fetch.authRequired`, `Fetch.requestPaused`, `on('Target.attachedToTarget')`, `Runtime.evaluate`, `Browser.grantPermissions`, `Target.setAutoAttach`, `close`. O palco dispara os eventos, anota cada `send` com o `sessionId` e guarda o texto do script pelo sha256 e pelo tamanho.
- **O sorteio e o relógio fixos:** `Math.random`, `crypto.randomBytes`, `crypto.randomUUID` e `Date.now`, e também a data que o `getTimezoneOffset` interno usa.
- **Um `mainWindow`** que anota cada `webContents.send`, e um `browserFarmService` de mentira com `profiles`, `_saveProfiles`, `getOptimalGeoDetails` e os quatro `get*ExecutablePath`. Há cenas com ele e sem ele.

As cenas, que valem para todos os cortes:

- **Perfil:**
  - `Default` sem `regional` (hoje lança `TypeError`, ver a seção 7, em [achados-e-fontes.md](achados-e-fontes.md)) e `Default` com o `regional` que a interface manda;
  - nome livre, com e sem farm, com e sem `farm_profiles.json`, com IDs `profile_07` e lixo na lista;
  - `profile_NN` completo e com campos faltando (o arquivo é regravado);
  - perfil temporário de `desktop`, de Android e de `iphone`.
- **Identidade:**
  - "ótimo" com e sem farm, e o farm devolvendo `null`;
  - `locationMode` `custom` com latitude `0`;
  - fuso inválido (`getTimezoneOffset` devolve 0);
  - idioma com e sem `-`.
- **Proxy:** `user:pass@host:port`, `user@host:port`, `host:port:user:pass`, `host:port`, `host` e vazio.
- **Janela:** `412x915`, `abc`, `Based on User-Agent` e `1920x1080` com `windowMode` maximizado, para cobrir o `--start-maximized`.
- **Áudio:** com `audioPath`, sem ele com o WAV já existindo e sem ele com o WAV ainda não existindo; em `win32` e em `darwin`.
- **Clipe:** sem buffer, com falha ao gravar e com o ffmpeg saindo com código 1.
- **CDP:**
  - alvo `page`, `iframe` e `service_worker`, com e sem `waitingForDebugger` e com e sem proxy com senha;
  - `send` que falha no meio;
  - `disconnect`, que chama o `stopHijack`;
  - a vigia do e-mail achando um e-mail, com o farm e direto no arquivo, e achando o mesmo e-mail de novo (não grava).
- **Parar:** `stopHijack` parado e depois de iniciar.
- **Navegador:** `_findChrome` para os quatro navegadores, com e sem farm, nos dois sistemas.

O diário de cada cena grava:

- o que o `startHijack` e o `stopHijack` devolvem;
- os argumentos de cada processo;
- os arquivos gravados (`farm_profiles.json` inteiro, `manifest.json` inteiro, `inject.js` pelo sha256 e pelo tamanho);
- cada envio do CDP e cada envio de IPC;
- o estado final (`getStatus` e `isHijacking`).

**Cada corte adiciona as cenas da parte que ele mexe**, antes de mexer. O palco acima é o do corte 1. Os outros cortes acrescentam cenas sem regravar as anteriores, e o diário antigo tem de passar igual.

Os arquivos seguem o molde do repositório: `app/electron/services/test/global-spoof-service.{palco,cenas}.js`, `global-spoof-service.esperado.json` e `global-spoof-service.test.js`, que confere cada cena com `deepStrictEqual` e com a ordem das chaves, como `browser-manager.test.js`. O palco troca o `require` do `chrome-remote-interface`, do `child_process` e do `./tool-paths` pelo `Module._load`, como o `browser-manager.palco.js` já faz. A CI roda esse teste sem mudança no workflow, pelo glob `app/electron/services/test*/**/*.test.js` do job "Testes do app" (`.github/workflows/regras.yml:115`).

O corte 6 precisa de um juiz a mais, porque o palco só vê o script pelo sha256 e o corte 6 muda o texto de propósito: `global-spoof-pagina.test.js` roda o script num `vm` do Node com protótipos de mentira (`Navigator`, `WebGLRenderingContext`, `HTMLCanvasElement`, `MediaDevices`, `AudioBuffer`, `Date`, `Intl`) e grava, para as 25 funções trocadas, o nome, a aridade, se o `toString` se diz nativo e o valor devolvido com o sorteio fixo. O diário dele é gravado no código de hoje, antes do corte 1.

### O juiz e a quebra de propósito de cada corte

Cada corte prova que o juiz morde: depois do corte, no código novo, faz a quebra abaixo, roda o juiz e mostra a cena que falha. A quebra não entra no commit. A mesma quebra, feita no código antigo, tem de derrubar a mesma cena com a mesma mensagem.

| Corte | O juiz | A quebra de propósito | Quem tem de falhar |
|---|---|---|---|
| 1. o texto da página | `global-spoof-service.test.js` e `global-spoof-pagina.test.js` | trocar um byte do texto em `global-spoof-pagina-midia.js` (`getSettings` vira `getSettinks`); e, numa segunda rodada, trocar a ordem de dois valores que entram no texto (`cpuCores` e `ramSize`) em `global-spoof-pagina.js` | todas as cenas que gravam o `inject.js`, pelo sha256; e a linha de `hardwareConcurrency` no diário do `vm` |
| 2. o perfil | `global-spoof-service.test.js` | no módulo do perfil, o próximo `profile_NN` passa a somar 2 em vez de 1; e, numa segunda rodada, uma marca de câmera muda em `farm-perfil.js` | a cena do nome livre com `profile_07` na lista, pelo `farm_profiles.json` inteiro; as cenas de perfil temporário e de campos faltando |
| 3. a identidade | `global-spoof-service.test.js` | na tabela do proxy, o formato `host:port:user:pass` troca o usuário e a senha; e o sinal do deslocamento do fuso se inverte | a cena desse formato, pelo `Fetch.continueWithAuth` e pelo `--proxy-server`; as cenas com fuso, pelo `setTimezoneOverride` e pelo sha256 do script |
| 4. o Chrome | `global-spoof-service.test.js`, `chromium-revisao-windows.test.js` e `tool-paths.test.cjs` | tirar `--use-fake-ui-for-media-stream` da lista de argumentos; e, numa segunda rodada, pôr o Edge antes do Chrome na tabela de navegadores | todas as cenas que abrem o Chrome, pelos argumentos; as cenas de `_findChrome` do palco e os três testes de `chromium-revisao-windows.test.js` |
| 5. o CDP | `global-spoof-service.test.js` | o auto-attach deixa de mandar o script para o alvo `iframe`; e, numa segunda rodada, a vigia do e-mail grava o mesmo e-mail de novo | a cena do alvo `iframe`, pelos envios com o `sessionId`; a cena do e-mail repetido, pelo `farm_profiles.json` e pelo `farm:profile-update` |
| 6. o script como código | `global-spoof-pagina.test.js` (o `vm`) e o roteiro no Chrome real | o `readPixels` perde a fixação de `length` em 7; e, numa segunda rodada, o `getUserMedia` deixa de se dizer nativo no `toString` | a linha do `readPixels` (aridade 0 em vez de 7) e a do `getUserMedia` no diário do `vm`; no Chrome real, a mesma diferença na tabela das 25 funções |

No corte 6 o sha256 do `inject.js` muda de propósito, então o diário do palco é regravado só nesse campo, e a PR mostra que só ele mudou. O diário do `vm` não é regravado: nome, aridade, mascaramento e valores têm de sair iguais.
