# O corte do `physicalMobileService.js`

Pesquisa do ticket [Pesquisa: o corte do physicalMobileService.js](https://github.com/vinicius928e8r84/Nova-AI/issues/130), do mapa [Nova-AI na nota 10 no CodeScene: o plano, com a fila de lotes e as regras que seguram](https://github.com/vinicius928e8r84/Nova-AI/issues/120). Alimenta o ticket [A fila dos lotes até a nota 10](https://github.com/vinicius928e8r84/Nova-AI/issues/139).

Tudo foi conferido na `main` em `1b45c3f`, o mesmo commit da análise do painel de 23/11 10:00 BRT. A pesquisa não muda código.

## A resposta em poucas linhas

O `app/electron/services/physicalMobileService.js` se divide em **17 módulos novos**: 11 do Android, 4 do iPhone e 1 do GPS, que serve aos dois. O arquivo original fica como fachada, com cerca de 10 KB: o construtor, os caminhos do adb e do scrcpy, o `getStatus` e um método de uma linha para cada nome que o `main.js`, os outros serviços e os testes chamam. Nenhum módulo passa de 12 KB.

São **sete cortes em série**, um por lote, porque todos mexem no mesmo arquivo. Os cinco primeiros são baratos e tiram 216 dos 622 pontos: a conexão Android, o iPhone pelo SSH, o GPS, o controle do Android e a câmera. Os dois últimos tiram os outros 406, que são quase todos do `applySpoofProfile`: uma função de 449 linhas que reescreve a identidade de um Android com root. Primeiro saem os textos e as tabelas, que são puros, e depois os passos no aparelho.

**Os sete são de atenção ALTA**, porque o caminho do arquivo está na lista `ponte-do-iphone` de `scripts/regras/caminhos-sensiveis.json`. A caracterização já é boa no meio Android: `celular-fisico-adb.test.js` grava a sequência inteira dos 119 comandos do spoof e os quatro arquivos do módulo Magisk. Falta quase tudo no iPhone (proxy, fuso, console, apps), na câmera, no MJPEG e no navegador.

Achei dois defeitos que os cortes têm de preservar e que cabem numa issue própria:

- o `fridaInject` sempre devolve erro;
- o IMEI que o spoof gera termina em `NaN`.

## 1. Como o arquivo é hoje

### Os números

- 2.383 linhas e 118.309 bytes (`wc -lc`), 15 commits pelo painel e 36 pelo `git log` (o histórico inclui os do snapshot). As linhas de base são 2.383 no `limite-de-linhas` e 622 na catraca (`scripts/regras/linha-de-base.json`, linhas 6 e 35).
- **Nota no painel: 3,13, e o arquivo é hotspot** (`"hotspot": true`, frequência de mudança 15). Lida em 23/11 pela API do painel, na lista de arquivos da última análise do projeto 2 (revisão `1b45c3f4507fb1acea82c12e7898adfe2a72b60e`). É o 25º pior dos 248 arquivos com nota. Entre o código vivo de `app/`, só estão abaixo dele `app/dist/cam-live.js` (1,65), `main.js` (2,44) e `browserFarmService.js` (2,64). O painel conta 1.989 linhas de código.
- Os achados do painel no arquivo: Modularity Issue; Bumpy Road (3); Deep, Nested Complexity (1); Many Conditionals; Complex Method (20); Complex Conditional (7); Large Method (5). As 7 Complex Conditional são as 7 condições com dois operadores da catraca. A Deep, Nested Complexity é o `scanWifiDevices` (aninhamento 4). As 5 Large Method são 5 das 6 funções que a catraca mede acima de 69 linhas; a sexta, `scanWifiDevices`, tem 73 linhas contando as em branco. A API dá a nota e os achados por arquivo, não por função; os pontos por função abaixo são da catraca.
- **Há cinco cópias de reserva deste arquivo no painel**, com nota 3,27, em `MAC/**/reservas/`. A [Apaga as 55 cópias de reserva](https://github.com/vinicius928e8r84/Nova-AI/pull/101) as tira.

### Os pontos da catraca por função

Medidos com `scripts/regras/analisador/medir.js` (`medirFontes`) e `pontos.js` (`pontuar`), do jeito que `scripts/regras/regra-saude.js` faz. Total: **622 pontos em 92 unidades**, o mesmo número da linha de base.

| Função (linha) | Pontos | O que pesa |
|---|---:|---|
| `applySpoofProfile` (975) | 397 | complexidade 25, 449 linhas |
| `automateBrowser` (763) | 46 | complexidade 11, 112 linhas |
| `fridaInject` (2270) | 40 | complexidade 10, 107 linhas |
| `startLiveStream` (2091) | 21 | complexidade 9, 89 linhas |
| `scanWifiDevices` (487) | 18 | complexidade 19, aninhamento 4, 3 blocos aninhados, 73 linhas |
| `startCamSpoof` (1970) | 16 | complexidade 14, 79 linhas |
| `resolveAdbPath` (47) | 14 | complexidade 21, 1 condição com 2 operadores |
| `iosControlApp` (371) | 12 | complexidade 17, 3 blocos aninhados, 1 condição com 2 operadores |
| `resolveScrcpyPath` (90) | 9 | complexidade 16, 1 condição com 2 operadores |
| `geoFromProxy` (1454) | 8 | complexidade 15, 2 blocos aninhados |
| `verifyAppliedProfile` (1846) | 8 | complexidade 16 |
| `iosApplyLocale` (1618) | 5 | complexidade 13 |
| `installCamSpoofer` (1932) | 5 | complexidade 12, 1 condição com 2 operadores |
| `getConnectedDevices` (139) | 4 | complexidade 12 |
| `autoPairUsbToWireless` (453) | 4 | complexidade 12 |
| `pushLiveFrame` (2186) | 4 | complexidade 11, 1 condição com 2 operadores |
| `connectWifi` (587) | 2 | complexidade 9, 1 condição com 2 operadores |
| `iosSetLocation` (1521) | 2 | complexidade 10 |
| `iosRevertLocale` (1640) | 2 | complexidade 10 |
| `stopLiveStream` (2222) | 2 | complexidade 10 |
| `applyIOSModel` (287) | 1 | complexidade 9 |
| `pairWirelessDevice` (572) | 1 | 1 condição com 2 operadores |
| o arquivo | 1 | complexidade média 5,8 (limite: abaixo de 4) |

As outras 70 unidades têm zero ponto.

### As partes do arquivo

Os bytes foram medidos por método: cada método vai da linha em que começa, mais os comentários logo acima, até o método seguinte. Os 13 grupos somam 117.900 bytes; os `require` do topo, nas linhas 1 a 11, levam os outros 409.

| Grupo | Métodos (linha) | Bytes | Linhas | Pontos |
|---|---|---:|---:|---:|
| Fachada | `constructor` (13), `adbPath` e `scrcpyPath` (33-44), `sendToFrontend` (126), `ensureTools` (135), `getStatus` (415), `iosCamera` (1908) | 2.393 | 74 | 0 |
| Caminhos das ferramentas | `resolveAdbPath` (47), `resolveScrcpyPath` (90) | 4.114 | 79 | 23 |
| Conexão Android | `getConnectedDevices` (139), `restartAdbServer` (434), `autoPairUsbToWireless` (453), `scanWifiDevices` (487), `pairWirelessDevice` (572), `connectWifi` (587), `disconnectDevice` (607) | 10.084 | 232 | 29 |
| iPhone pelo SSH | `iosSsh` (185), `iosDeviceTimeZone` (197), `iosProxy*` (203-275), `getIosModels`, `applyIOSModel`, `clearIOSModel`, `getIOSModel` (277-316), `iosRun` (318), `getIosDevices` (326), `iosPrepared` (338), `iosStartStream` e `iosStopStream` (349-369), `iosControlApp` (371), `iosAutomateBrowser` (406), `iosToggleSetting` (677) | 12.342 | 247 | 13 |
| Fuso do iPhone | `iosLocaleStatus` (1557) até `iosRevertLocale` (1640), dez métodos | 4.969 | 96 | 7 |
| GPS | `geoFromProxy` (1454), `idevicesetlocationPath` até `iosStopLocation` (1493-1555), `setSpoofLocation` (1653), `stopFakeGPS` (1707) | 8.171 | 168 | 10 |
| Controle Android | `startStream` e `stopStream` (620-670), `toggleSetting` (689), `controlApp` (730), `adbRootExec` (951), `adbPush` (967) | 6.222 | 150 | 0 |
| Navegador Android | `automateBrowser` (763) | 6.985 | 130 | 46 |
| Identidade | `getSpooferDatabase` (893), `getSpooferModels` (903), os seis geradores (912-949) | 1.917 | 58 | 0 |
| Spoof | `applySpoofProfile` (975, 27.105 bytes sozinho), `getGSFAndroidId` (1425), `rebootDevice` (1720), `resetSpoof` (1754), `applyDualIMEI` (1768), `generateRandomProfile` (1821), `verifyAppliedProfile` (1846) | 38.702 | 665 | 405 |
| Câmera Android | `getCamSpoofStatus` (1913), `installCamSpoofer` (1932), `startCamSpoof` (1970), `stopCamSpoof` (2053) | 8.336 | 168 | 21 |
| Transmissão MJPEG | `startLiveStream` (2091), `pushLiveFrame` (2186), `stopLiveStream` (2222) | 8.182 | 180 | 27 |
| Frida | `fridaInject` (2270) | 5.483 | 124 | 40 |

Os 27.105 bytes do `applySpoofProfile`, por trecho:

| Trecho | Linhas | Bytes |
|---|---|---:|
| tabela `IMEI_TAC` (TAC por fabricante) | 987-1001 | 1.102 |
| a leitura do Android real (5 `getprop`) e os padrões | 1006-1023 | cerca de 1.000 |
| a lista `props` (51 propriedades) | 1028-1083 | 3.705 |
| `resetprop` de cada propriedade e o IMEI em todos os caminhos e no EFS | 1084-1124 | 2.737 |
| o aviso à telefonia | 1125-1143 | 1.590 |
| a tabela `CARRIER_DB` e os identificadores derivados | 1144-1170 | 1.609 |
| `spoofConfig`, `settings put`, MAC do Wi-Fi e do Bluetooth, os três `sqlite3` | 1171-1232 | cerca de 3.900 |
| as 22 propriedades extras | 1235-1254 | 782 |
| `module.prop`, `system.prop` e o `service.sh` (62 linhas de texto) | 1256-1341 | 3.982 |
| gravar e subir o módulo Magisk, `chmod`, `nova_spoof.json` | 1342-1371 | 2.281 |
| reiniciar o zigoto, esperar, avisar na tela e responder | 1372-1423 | 2.433 |

### Quem usa o serviço

- **`main.js`** cria uma instância só (`main.js:390-397`), registra 27 canais `physical-mobile:*` e chama 48 métodos dela. Também lê `adbPath` (`main.js:692`, para o `rtmp-server.js`) e grava `mainWindow` e `camLiveIphone` na instância.
- **Outros serviços recebem a instância e chamam por ela:**
  - `android-tools.js` (`ensureForService`) lê e grava `baseDir`, `adbPath`, `scrcpyPath`, `isProvisioning` e `sendToFrontend`;
  - `ios-camera.js` lê `camLiveIphone`;
  - `iphone-setup/setup.js` usa `baseDir` e `iosSsh`;
  - `cam-live-iphone.js` usa `iosSsh` e `getIosDevices`;
  - `live-cam-bridge.js` lê `scrcpyPath`.
- **Os testes trocam métodos na própria instância:**
  - `servico.getIosDevices`, `adbPath` com `defineProperty`, `iosSsh` em `novamodel.test.cjs`, `resolveAdbPath` e `iosCamera` em `routing.cjs` e `wireless.cjs`;
  - quatro testes de `MAC/` criam o serviço com `Object.create(Service.prototype)`, **sem passar pelo construtor**.

Daí sai a primeira regra de todos os cortes. **Os módulos novos recebem o serviço e chamam por ele** (`servico.adbRootExec(...)`, `servico.iosSsh(...)`), como `android-tools.js` e `ios-camera.js` já fazem. **A fachada guarda um método para cada nome de hoje**, criando o módulo na hora do uso, como o `iosCamera()` faz, e não no construtor. Assim os testes de hoje rodam sem mudança e provam que o comportamento não mudou.

## 2. Os módulos de destino

Os tamanhos são estimados pela soma dos trechos de hoje, menos o que a refatoração junta (as três cópias das opções do SSH, as duas esperas do zigoto, as listas de candidatos que viram tabela). Todos nascem dentro dos limites da catraca, porque código que sai para um módulo novo não leva a folga da linha de base (`regra-saude.js`, o texto de `conserto`). Por isso cada corte refatora, e não só move.

| Módulo | Responsabilidade | Tamanho estimado | Corte |
|---|---|---:|---:|
| `android-caminhos.js` | onde estão o adb e o scrcpy: no Mac, `mac-native`, `android-tools` e `resources`; no Windows, a lista de candidatos vira tabela, com o primeiro que existe e o padrão. Guarda `_adbPath` e `_scrcpyPath` como hoje | 3,5 KB | 1 |
| `android-adb.js` | os primitivos: shell como root com plano B sem `su` (`adbRootExec`), `push`, e "o adb existe?" | 1,5 KB | 1 |
| `android-conexao.js` | listar aparelhos (`adb devices -l` mais os do iPhone), reiniciar o servidor, ligar o Wi-Fi pelo USB, varrer a rede (mdns e sub-rede na porta 5555), parear com código, conectar e desconectar | 10 KB | 1 |
| `iphone-comando.js` | o SSH do aparelho (`iosSsh`), o `scp`, o `ideviceinstaller` e o fuso do aparelho, com as opções de SSH num lugar só | 3 KB | 2 |
| `iphone-proxy.js` | o `novaproxy`: ligar, limpar, estado, IP de saída e as mensagens de erro | 3 KB | 2 |
| `iphone-controle.js` | modelo (`novamodel`), lista de aparelhos, "já preparado", janela do console, apps, abrir URL e os atalhos de Wi-Fi e Bluetooth | 8 KB | 2 |
| `iphone-fuso.js` | o ajudante de fuso: pronto?, mandar comando, esperar estado, aplicar e reverter | 4,5 KB | 2 |
| `celular-gps.js` | geolocalização pela saída do proxy; GPS do iPhone (imagem de desenvolvedor, `idevicesetlocation`, espera do fuso); laço de GPS falso do Android | 8 KB | 3 |
| `android-controle.js` | espelhar com o scrcpy (abrir e fechar), Wi-Fi e Bluetooth, abrir, parar e limpar apps | 5,5 KB | 4 |
| `android-navegador.js` | Chrome do Android pelo CDP: `adb forward`, abrir o Chrome, achar a aba, navegar e buscar | 6 KB | 4 |
| `android-camera.js` | o APK `nova-cam-spoofer`: estado, instalar, iniciar com foto ou vídeo, parar | 8 KB | 5 |
| `android-mjpeg.js` | o servidor MJPEG em 127.0.0.1, o `adb reverse`, o aviso ao módulo LSPosed e os quadros | 8 KB | 5 |
| `android-frida.js` | `frida-server` no aparelho e o `frida -U -f`, mais o canal que ele tenta registrar (ver a seção 5) | 5 KB | 5 |
| `android-identidade.js` | banco do spoofer, geradores, as tabelas de TAC e de operadora, montar a identidade e as duas listas de propriedades | 10 KB | 6 |
| `android-magisk.js` | os textos `module.prop`, `system.prop` e `service.sh`, e a instalação do módulo em `/data/adb/modules/nova_spoof` | 7 KB | 6 |
| `android-spoof.js` | aplicar o perfil em passos com nome (ler o Android real, propriedades, IMEI, telefonia, ajustes e MACs, bancos do Google, módulo, reinício e aviso); perfil aleatório; IMEI duplo | 11 KB | 7 |
| `android-spoof-manutencao.js` | conferir o perfil aplicado, ler o ID do GSF, reiniciar só o zigoto ou o aparelho inteiro (a espera do zigoto num lugar só) e desfazer | 8 KB | 7 |
| `physicalMobileService.js` (fica) | construtor, `adbPath` e `scrcpyPath`, `sendToFrontend`, `ensureTools`, `getStatus`, `iosCamera` e um método de uma linha por nome de hoje, com a escolha iPhone ou Android | 10 KB | — |

A soma dá cerca de 119 KB, o tamanho de hoje.

**Um risco que só o painel mostra:** a fachada fica com cerca de 85 métodos de uma linha. O painel pode seguir acusando Modularity Issue, um achado de aviso, ou dar nota abaixo de 10 por coesão, coisas que a catraca não mede. A nota só aparece no check do CodeScene quando a PR abre. Se o achado ficar, o caminho honesto é o `main.js` chamar os módulos direto e a fachada encolher. Isso cabe no [Pesquisa: o corte do main.js](https://github.com/vinicius928e8r84/Nova-AI/issues/127), não aqui. Gerar os métodos em laço sobre o protótipo esconderia a contagem e é maquiar a métrica, que o `CONTRIBUTING.md` proíbe.

## 3. Os cortes em série

A ordem segue as dependências. `android-adb.js` (corte 1) serve aos cortes 3 a 7, e `iphone-comando.js` (corte 2) serve ao GPS e ao fuso. O spoof vai por último porque é o maior risco e o que mais pede do aparelho. Todos os cortes são de atenção **ALTA**: o caminho `**/physicalMobileService*` está em `ponte-do-iphone`, e os módulos que rodam `exec`, `execFile` ou `spawn` caem também no padrão de conteúdo `processos`.

Recomendo pôr `**/android-*` e `**/celular-*` num grupo de `caminhos-sensiveis.json`. Os módulos puros do corte 6 não têm `exec` e, sozinhos, escapariam da atenção ALTA numa PR futura. Os nomes `iphone-*` já casam com `ponte-do-iphone`.

| Corte | Módulos | O que tira do arquivo | Pontos que saem |
|---:|---|---|---:|
| 1 | `android-caminhos.js`, `android-adb.js`, `android-conexao.js` | resolução do adb e do scrcpy, primitivos do adb, conexão USB e Wi-Fi | 52 (`resolveAdbPath` 14, `resolveScrcpyPath` 9, `scanWifiDevices` 18, `getConnectedDevices` 4, `autoPairUsbToWireless` 4, `connectWifi` 2, `pairWirelessDevice` 1) |
| 2 | `iphone-comando.js`, `iphone-proxy.js`, `iphone-controle.js`, `iphone-fuso.js` | tudo o que fala com o iPhone pelo SSH, pelo `ideviceinstaller` e pelo ajudante de fuso | 20 (`iosControlApp` 12, `applyIOSModel` 1, `iosApplyLocale` 5, `iosRevertLocale` 2) |
| 3 | `celular-gps.js` | geolocalização do proxy e GPS dos dois aparelhos | 10 (`geoFromProxy` 8, `iosSetLocation` 2) |
| 4 | `android-controle.js`, `android-navegador.js` | scrcpy, Wi-Fi e Bluetooth, apps e o Chrome pelo CDP | 46 (`automateBrowser`) |
| 5 | `android-camera.js`, `android-mjpeg.js`, `android-frida.js` | câmera falsa pelo APK, transmissão ao vivo e Frida | 88 (`fridaInject` 40, `startLiveStream` 21, `startCamSpoof` 16, `installCamSpoofer` 5, `pushLiveFrame` 4, `stopLiveStream` 2) |
| 6 | `android-identidade.js`, `android-magisk.js` | do `applySpoofProfile`, as tabelas, as listas de propriedades, a montagem da identidade e os textos do módulo Magisk (cerca de 197 das 449 linhas) | cerca de 190 (o `applySpoofProfile` cai para cerca de 260 linhas) |
| 7 | `android-spoof.js`, `android-spoof-manutencao.js` | o resto do `applySpoofProfile` em passos, `verifyAppliedProfile`, `applyDualIMEI`, `generateRandomProfile`, `getGSFAndroidId`, `rebootDevice`, `resetSpoof` | cerca de 215 (o resto do `applySpoofProfile`, `verifyAppliedProfile` 8 e o ponto da média) |

A soma dá 622. Os números dos cortes 1 a 5 são exatos, porque cada um leva funções inteiras. Os dos cortes 6 e 7 são estimativa, porque o 6 corta dentro de uma função. O ponto da média (5,8 hoje) sai quando a média das funções que ficam cai abaixo de 4. Pela conta, isso acontece no corte 6 ou no 7. Depois do corte 7 o arquivo fica em zero ponto e sai da linha de base da catraca e do `limite-de-linhas`.

Se o dono quiser menos lotes, os cortes 3 e 4 cabem juntos. Os dois são pequenos e a prova real deles usa a mesma mesa: Android por USB e iPhone comum. O custo é uma PR maior para a revisão independente.

## 4. Cada corte: o que os testes cobrem, o que falta, o risco e a prova real

### Os testes de hoje

Rodei todos na `main` em `1b45c3f`, no Windows, com Node 24:

- `node --test app/electron/services/test/celular-fisico-adb.test.js app/electron/services/testes/textos-celular.test.js app/test/gps-iphone.test.js app/tests/idioma-registro.test.js app/tests/physical-mobile-axios.test.js`: **29 de 29 passam**.
- `node MAC/integracao-iphone/conexao-usb/botao-servico.test.cjs`, `tests/android-install.cjs`, `tests/routing.cjs`, `tests/wireless.cjs`, `tests/chave-de-host.cjs` e `MAC/integracao-modelo-app/novamodel.test.cjs` (30 verificações): **passam**.
- `node MAC/integracao-iphone/tests/ferramenta-ausente.cjs`: **4 de 5**. O que falha é do `ios-tools.js` no Windows: o teste cria `iproxy` sem `.exe`. No Ubuntu do CI ele passa, e não depende deste arquivo.

**Quais rodam no CI.** O job "Testes do app" (`.github/workflows/regras.yml`, linhas 115 a 127) roda os de `app/` e, de `MAC/`, só `ferramenta-ausente.cjs` e `novamodel.test.cjs`. **`botao-servico`, `android-install`, `routing`, `wireless` e `chave-de-host` não rodam no CI**: cada corte precisa rodá-los à mão e citá-los no Registro da PR, ou pô-los na lista do workflow (mudança de regra, PR própria).

O molde da caracterização nova é o de `celular-fisico-adb.test.js`:

- troca `child_process` por um registrador de comandos na hora do `require`;
- fixa o sorteio e o relógio (`comSorteFixa`) e zera as esperas (`comTempoInstantaneo`);
- compara com um arquivo esperado (`celular-fisico-adb.esperado.json`, 20 KB: 119 comandos, os quatro arquivos do módulo e a resposta).

Ele tem **três armadilhas** para os módulos novos:

- **`require` preguiçoso escapa do falso.** O teste só troca `child_process` enquanto carrega o serviço e depois devolve o carregador original. Um módulo novo carregado dentro de um método, como hoje o serviço faz com `require('./android-tools')`, pega o `child_process` de verdade. Aí o teste roda `node.exe` com os argumentos do adb, porque o falso adb é o `process.execPath`. Os módulos novos que rodam processo têm de ser carregados no topo do `physicalMobileService.js`, ou o teste tem de trocar `child_process` antes e não devolver.
- **`net.Socket` é trocado no objeto do módulo.** O `android-conexao.js` tem de chamar `new net.Socket()` e não desestruturar `const { Socket } = require('net')`.
- **A ordem das chamadas a `Math.random` faz parte do comportamento.** O esperado guarda o IMEI, o serial, os MACs e os IDs gerados com a semente fixa. Mudar a ordem dos sorteios muda todos e quebra o teste, e com razão.

### Corte 1: caminhos, primitivos do adb e conexão

- **Coberto hoje.** Por `celular-fisico-adb.test.js`:
  - `getConnectedDevices` (USB, Wi-Fi, erro, vazio, sem adb);
  - `restartAdbServer`, `pairWirelessDevice`, `connectWifi`, `disconnectDevice`, `autoPairUsbToWireless`;
  - `scanWifiDevices` (mdns, sub-rede, sem interface, sem adb);
  - `adbRootExec` e `adbPush`.

  Também `wireless.cjs` (o iPhone nunca chega ao adb) e `ferramenta-ausente.cjs` (o `getStatus` sem ferramenta do iPhone).
- **Caracterização que falta:** `resolveAdbPath` e `resolveScrcpyPath`. No Windows, a ordem dos 21 e dos 14 candidatos, o primeiro que existe ganha e fica guardado em `_adbPath`, o padrão quando nenhum existe e o `set adbPath` que o `android-tools.js` usa. No Mac, `mac-native.tool`, depois `android-tools.localToolPath`, depois `resources/bin`. O palco troca `fs.existsSync`, `process.platform` e as variáveis de ambiente (`LOCALAPPDATA`, `USERPROFILE`, `PROGRAMFILES`, `PROGRAMFILES(X86)`) e grava a sequência de caminhos consultados.
- **Risco: médio.** Errar a ordem dos candidatos faz o app usar outro adb, o de um emulador (BlueStacks, Nox, LDPlayer) em vez do embutido. Os comandos do adb são texto com `deviceId` dentro, rodados por `exec`. Trocar por `execFile` mudaria as aspas e é mudança de comportamento: os comandos têm de sair idênticos, e o esperado confere isso.
- **Prova real:**
  1. Agente, numa máquina de prova Windows sem aparelho: app aberto, aba do celular, "baixar ferramentas"; o `getStatus` mostra os caminhos do adb e do scrcpy baixados em `physical_mobile/` e `needsSetup` falso.
  2. Dono, **Android por USB**, no Windows e no Mac: o aparelho aparece como USB; reiniciar o servidor adb; "Wireless Switch" (`tcpip 5555` e `connect`); o aparelho reaparece como Wi-Fi; desconectar.
  3. Dono, **Android com Depuração sem fio** (Android 11 ou mais novo), na mesma rede: parear com código e porta; varrer o Wi-Fi e ver o aparelho achado e conectado.
  4. Dono, **iPhone comum por USB**, ligado ao mesmo tempo: aparece na lista junto do Android.

  Paga as partes de adb e de pareamento de [PR 15: provar com aparelho Android real (adb/scrcpy, espelhar, instalar APK)](https://github.com/vinicius928e8r84/Nova-AI/issues/89) e de [PR 54: provar a caracterização de ADB, varredura de Wi-Fi e perfil de spoof com aparelho Android real](https://github.com/vinicius928e8r84/Nova-AI/issues/96), e o `wireless` de [PR 40: provar com iPhone e Android reais os testes que passam a carregar app/](https://github.com/vinicius928e8r84/Nova-AI/issues/94). Como o getter `adbPath` muda de casa, a mesma sessão pode pagar [Prova real pendente: PR 22 (RTMP com adb reverse do app)](https://github.com/vinicius928e8r84/Nova-AI/issues/77).

### Corte 2: o iPhone pelo SSH

- **Coberto hoje:**
  - `novamodel.test.cjs`: `getIosModels`, `applyIOSModel`, `clearIOSModel`, `getIOSModel`, com `iosSsh` falso;
  - `botao-servico.test.cjs` e `ferramenta-ausente.cjs`: `iosPrepared` e `getIosDevices`;
  - `chave-de-host.cjs`: o texto `StrictHostKeyChecking=accept-new`, `BatchMode=yes` e `ConnectTimeout` no arquivo;
  - `gps-iphone.test.js`: `iosDeviceTimeZone`.
- **Caracterização que falta:**
  - `iosSsh` e `iosProxyRun`: os argumentos do `ssh` (porta 2222, `mobile@127.0.0.1`, as opções, os tempos de 12 s e 30 s);
  - `iosProxyError`: os quatro textos;
  - `iosProxySet`: a citação com `'\''`;
  - `iosProxyClear`, `iosProxyStatus` (a leitura da linha `on upstream=... wifi=... daemon=running`) e `iosProxyCheck`;
  - `iosRun`;
  - `iosStartStream` e `iosStopStream`, com a janela falsa: abre uma vez, foca na segunda, apaga ao fechar;
  - `iosControlApp`: os oito apelidos de pacote, `list`, `launch`, `open`, `start`, `uninstall`, `remove` e a ação desconhecida;
  - `iosAutomateBrowser`: URL sem esquema, busca, vazio;
  - `iosToggleSetting`: os nomes exatos dos atalhos;
  - os dez métodos do fuso, com `scp` e `ssh` falsos e o relógio fixo para a espera de 25 s.
- **Testes que mudam junto, no mesmo corte:**
  - `chave-de-host.cjs` lê o texto de `physicalMobileService.js` e vai falhar quando as opções do SSH saírem dele. Passa a ler `iphone-comando.js`. Não está no CI: rodar à mão.
  - `textos-celular.test.js` passa a listar os módulos `iphone-*` novos.
- **Risco: alto.** Errar uma opção do SSH quebra a conexão com o aparelho ou volta a aceitar chave nova sem `accept-new`. `cam-live-iphone.js` e `iphone-setup/setup.js` chamam `iosSsh` pela instância, por isso o nome fica na fachada. Este corte precisa da `main` depois da [refatoracao: Lote Nova 4](https://github.com/vinicius928e8r84/Nova-AI/pull/100) e da limpeza de comentários dos `ios-*` e do `iphone-ssh.js` ([Limpeza de comentários: infraestrutura do app/electron (442 linhas) com 7 ADRs](https://github.com/vinicius928e8r84/Nova-AI/pull/112)), que mexem no `iphone-ssh.js` de que o `iosSsh` lê as opções.
- **Prova real:**
  1. Dono, **iPhone com jailbreak**, no Mac: Conectar; o cartão mostra "Abrir controle"; abrir o console (CatVNC); proxy ligar, estado, IP de saída e limpar; modelo aplicar, ler e limpar; listar apps, abrir um, desinstalar um app de teste; abrir URL no Safari; os atalhos "Nova WiFi On/Off" e "Nova BT On/Off"; aplicar um fuso e reverter.
  2. Dono, o **mesmo iPhone no Windows**: o proxy e o fuso de novo, sem janela de console piscando, e o erro claro num Windows sem OpenSSH.
  3. Agente, sem aparelho: o cartão do iPhone sem ferramenta não quebra o `getStatus`.

  Paga [Prova real pendente: PR 20 (windowsHide e erro claro sem OpenSSH)](https://github.com/vinicius928e8r84/Nova-AI/issues/78) e as partes `botao-servico` e `routing` de [PR 40: provar com iPhone e Android reais os testes que passam a carregar app/](https://github.com/vinicius928e8r84/Nova-AI/issues/94).

### Corte 3: o GPS

- **Coberto hoje:** `gps-iphone.test.js` cobre `iosSetLocation` e `iosStopLocation` sem `idevicesetlocation` e o `windowsHide` do `pymobiledevice3` e do `idevicesetlocation`.
- **Caracterização que falta:**
  - `geoFromProxy` nos três caminhos: o iPhone dá o IP de saída; sem IP, usa o proxy salvo; sem nenhum dos dois, dá o erro. Com `geo-proxy` falso.
  - `iosSetLocation` com sucesso: monta a imagem, aplica, espera o fuso trocar em até quatro voltas de 2 s.
  - `iosStopLocation` quando a imagem de desenvolvedor já saiu.
  - `setSpoofLocation` no Android: a sequência de comandos e o texto do `nova_gps_loop.sh`, com o `$(date +%s%3N)` literal.
  - `stopFakeGPS` e o `nova_spoof.json` atualizado.
- **Risco: médio.** O GPS do Android grava um script que roda para sempre no aparelho, e errar o texto deixa o aparelho com o laço velho. O `geoFromProxy` depende do `iosProxyCheck` do corte 2, por isso vem depois.
- **Prova real:**
  1. Dono, **iPhone comum**, no Windows e no Mac: aplicar uma coordenada; o Mapas mostra o lugar e o fuso do aparelho muda; resetar.
  2. Dono, **Android com root**: aplicar, ver no Mapas, parar.
  3. Dono, **iPhone com jailbreak** com o `novaproxy` ligado e a **credencial Evomi de teste**: "geo pelo proxy" devolve a cidade da saída.
  4. Agente: sem proxy salvo, a mensagem "Salve a proxy primeiro".

  Paga [Prova real pendente: PR 21 (GPS do iPhone no Windows) com iPhone real](https://github.com/vinicius928e8r84/Nova-AI/issues/76) e a parte de aparelho de [Prova real em aparelho pendente do PR 45](https://github.com/vinicius928e8r84/Nova-AI/issues/62).

### Corte 4: controle do Android e o navegador

- **Coberto hoje:**
  - `celular-fisico-adb.test.js`: `toggleSetting` (com `su`, plano B sem `su`, desconhecido) e `controlApp` (abrir, parar, limpar e os planos B);
  - `physical-mobile-axios.test.js`: só que o `automateBrowser` consulta `http://localhost:9222/json` pelo axios.
- **Caracterização que falta:**
  - `startStream`: os argumentos do scrcpy, o `env.ADB` só no Mac, o "Já transmitindo", o aviso `physical-mobile:status-updated` ao abrir e ao fechar;
  - `stopStream`, e os dois desviando para o iPhone;
  - `automateBrowser` inteiro, com `ws` e axios falsos: o `forward`, o `am start` do Chrome, as esperas de 4 s e 5 s, a escolha da aba, o `Page.navigate`, o `Runtime.evaluate` com o texto da busca dentro do script (sem escapar, como hoje) e as cinco saídas de erro.
- **Risco: médio.** O `automateBrowser` é um `new Promise(async ...)` que resolve em vários lugares, e reescrever com `await` pode mudar qual erro chega primeiro: o `ws.on('error')` depois de já ter resolvido, por exemplo. O texto da busca entra no script sem escapar. É defeito, mas consertar é mudança de comportamento e vai para outra PR.
- **Prova real:**
  1. Dono, **Android por USB**, no Windows e no Mac: espelhar (a janela "Nova Phone Control - [id]"), fechar e ver o cartão voltar.
  2. Dono, **Android com root**: Wi-Fi e Bluetooth liga e desliga; abrir, parar e limpar um app.
  3. Dono, **Android com o Chrome** e a depuração USB: "abrir URL com busca" abre o Google e busca.
  4. Dono: fechar o app com o scrcpy aberto e ver que não sobra processo.

  Paga o espelhar de [PR 15: provar com aparelho Android real (adb/scrcpy, espelhar, instalar APK)](https://github.com/vinicius928e8r84/Nova-AI/issues/89). Pode levar junto a parte Android de [Prova real pendente: PR 17 (processos órfãos ao sair) com aparelho real](https://github.com/vinicius928e8r84/Nova-AI/issues/75).

### Corte 5: câmera, transmissão e Frida

- **Coberto hoje:**
  - `android-install.cjs`: o APK empacotado é achado e vai para `adb install -r -g`;
  - `routing.cjs`: no iPhone, `installCamSpoofer` e `getCamSpoofStatus` vão para o `ios-camera.js` e nunca chamam o adb.
- **Caracterização que falta:**
  - `getCamSpoofStatus` no Android;
  - `installCamSpoofer`: a ordem dos três caminhos do APK, a falha com "failure" na saída;
  - `startCamSpoof`: foto contra vídeo, os cinco e quatro destinos do `push`, o `chmod`, os cinco `am broadcast` com plano B sem `su`;
  - `stopCamSpoof`;
  - `startLiveStream`: o servidor MJPEG de verdade em 127.0.0.1 numa porta livre, `/stream`, `/ping`, 404, o `adb reverse` que falha e segue, o aviso ao LSPosed;
  - `pushLiveFrame`: o corpo multipart exato e a limpeza dos clientes mortos, mais o quadro que vai também para o iPhone quando o `_iosCamera` tem servidor;
  - `stopLiveStream`: o fechamento à força em 2 s;
  - `fridaInject` nos dois caminhos da seção 5.
- **Risco: médio.** O estado da transmissão mora hoje na instância (`_mjpegServer`, `_mjpegClients`, `_mjpegPort`, `_mjpegFrameCount`, `_fridaProcess`). Conferi com `git grep`: ninguém fora do arquivo lê esses campos, então podem ir para o módulo. O `pushLiveFrame` roda a cerca de 30 quadros por segundo pelo `ipcMain.on`, por isso não pode ganhar trabalho por quadro.
- **Prova real:**
  1. Agente, numa máquina de prova com o adb e sem aparelho: iniciar a transmissão, `curl http://127.0.0.1:8899/ping` e ver a contagem de quadros subir com a câmera virtual mandando quadros; parar e ver a porta fechar.
  2. Agente: no app empacotado, o Frida devolve "Frida script not found".
  3. Dono, **Android com root e o APK**: instalar o `nova-cam-spoofer`; iniciar com uma foto e com um vídeo; abrir a câmera de um app e ver a mídia; parar e ver a câmera real.
  4. Dono, **Android com root e o módulo LSPosed**: a transmissão ao vivo aparece na câmera do app.
  5. Dono, **iPhone com jailbreak**: iniciar e parar a transmissão pela mesma tela, que desvia para o `ios-camera.js`.

  Paga a instalação do APK de [PR 15: provar com aparelho Android real (adb/scrcpy, espelhar, instalar APK)](https://github.com/vinicius928e8r84/Nova-AI/issues/89) e o `android-install` de [PR 40: provar com iPhone e Android reais os testes que passam a carregar app/](https://github.com/vinicius928e8r84/Nova-AI/issues/94).

### Corte 6: identidade e o módulo Magisk

- **Coberto hoje, e bem:**
  - `celular-fisico-adb.test.js` grava os 119 comandos, `module.prop`, `system.prop`, `service.sh`, `nova_spoof.json` e a resposta do `applySpoofProfile` com a semente fixa;
  - confere direto as 51 mais 10 chamadas de `resetprop`, os 10 `resetprop -p`, os quatro `push`, as 73 linhas do `system.prop` e o reinício do zigoto antes da consulta;
  - os casos de marca ou modelo desconhecido, de zigoto que não volta (20 consultas) e de aparelho mudo (padrões do Android 11);
  - os geradores e o banco do spoofer.
- **Caracterização que falta:** pouca. O `generateRandomProfile`, com a semente fixa, e as funções puras novas testadas sozinhas, comparadas com os trechos do esperado. O que este corte move já está gravado byte a byte.
- **Risco: alto, mas bem guardado.** Ler a mesma identidade em outra ordem muda o resultado, porque os sorteios vêm em sequência: o TAC, o serial, o Android ID, o MAC, o GAID, o IMSI, depois o SSID, o BSSID, o Bluetooth, o SIM, o número, o GSF e o DRM. O `service.sh` tem 62 linhas de texto com `#` que são do script, não comentários do JavaScript; a regra `sem-comentario-novo` não os conta, e eles não podem sumir. A [Zera os comentários de physicalMobileService.js e global-spoof-service.js](https://github.com/vinicius928e8r84/Nova-AI/pull/149) preservou esse texto.
- **Prova real:**
  1. Agente, sem aparelho: rodar a caracterização na base e no head, com o mesmo esperado.
  2. Dono, **Android com root e Magisk**: aplicar o mesmo perfil Samsung na base e no head. O sorteio no aparelho não tem semente fixa, então os valores mudam. Com `adb pull /data/adb/modules/nova_spoof`, conferir que os três arquivos têm as mesmas chaves, na mesma ordem. Reiniciar e ver o modelo novo em Ajustes.

### Corte 7: aplicar o perfil, conferir, reiniciar e desfazer

- **Coberto hoje:** a sequência inteira do `applySpoofProfile` (acima).
- **Caracterização que falta:**
  - `verifyAppliedProfile`: as 14 leituras em paralelo e as 12 linhas do resultado, com e sem `_lastAppliedProfile`;
  - `applyDualIMEI`: tamanhos errados, a sequência do `grep -v`, `echo` e `cp`, e o reinício em 1,5 s com `setTimeout`, fora do `await`;
  - `getGSFAndroidId`: `content query` em hexadecimal e em decimal com `BigInt`, plano B pelo `sqlite3`, falha;
  - `rebootDevice`: `hard`, e `soft` com as 20 consultas e a espera de 2 s;
  - `resetSpoof`: a ordem dos `rm` e o reinício completo.
- **Risco: o mais alto do arquivo.** São os comandos que reescrevem a identidade de um aparelho com root (propriedades, EFS da Samsung, MACs, bancos do Google e da telefonia). A espera do zigoto está escrita duas vezes, no `applySpoofProfile` e no `rebootDevice`. As duas consultam 20 vezes, mas uma espera 3 s depois e a outra 2 s, e juntar as duas não pode igualar esses tempos. O `_lastAppliedProfile` liga o aplicar ao conferir e tem de ficar num lugar que os dois vejam, com a mesma vida da instância.
- **Prova real:**
  1. Agente, sem aparelho: a caracterização na base e no head.
  2. Dono, num **Android com root e Magisk só de teste**, de preferência um **Samsung**, para passar pelos caminhos do EFS: aplicar um perfil; conferir e ver 12 de 12, ou o mesmo número da base; IMEI duplo; perfil aleatório; ler o ID do GSF; reinício leve, com o espelhamento do scrcpy ainda vivo depois dele.
  3. Dono, por último: **desfazer**, que reinicia o aparelho inteiro, e ver a identidade original de volta.

  Paga o perfil de spoof de [PR 54: provar a caracterização de ADB, varredura de Wi-Fi e perfil de spoof com aparelho Android real](https://github.com/vinicius928e8r84/Nova-AI/issues/96).

### Os aparelhos, por corte

| Corte | Agente (máquina de prova, sem aparelho) | Android por USB | Android por Wi-Fi | Android com root | iPhone comum | iPhone com jailbreak | Credencial |
|---:|---|---|---|---|---|---|---|
| 1 | baixar e achar o adb e o scrcpy | sim | sim (Android 11+) | não | sim (lista) | não | não |
| 2 | `getStatus` sem ferramenta | não | não | não | não | sim, Mac e Windows | não |
| 3 | mensagem sem proxy | não | não | sim (GPS) | sim, Mac e Windows | sim (geo pelo proxy) | Evomi de teste |
| 4 | não | sim | não | sim (Wi-Fi, BT, apps) | não | não | não |
| 5 | MJPEG `/ping`; Frida no empacotado | não | não | sim, com o APK e o LSPosed | não | sim (CAM LIVE pela tela) | não |
| 6 | caracterização na base e no head | não | não | sim, com Magisk | não | não | não |
| 7 | caracterização na base e no head | não | não | sim, com Magisk, aparelho só de teste (Samsung, se der) | não | não | não |

A [Pesquisa: as provas reais pendentes, arquivo por arquivo](https://github.com/vinicius928e8r84/Nova-AI/issues/137) diz que o iPhone com jailbreak usa o SSH (`iproxy 2222 22`) e o iPhone comum só o GPS e o navegador. Que essas duas coisas dispensam o jailbreak não foi conferido em aparelho. Tampouco conferi quais máquinas de prova da frota têm o adb e um Mac com tela que o agente opere; sem elas, os passos do agente passam para o dono.

## 5. Achados que os cortes preservam e que pedem issue própria

- **`fridaInject` sempre devolve erro.** Ele monta os caminhos de `resources/frida/` a partir de `__dirname` (linha 2283). Em `app/package.json`, o `files` exclui `!resources/**` e o `extraResources` copia `resources` para `process.resourcesPath`, com `asar: false`. No app que este repositório empacota, o script não existe e a resposta é sempre `{ success: false, error: 'Frida script not found. Resources missing.' }`. Se o script existir, como no código-fonte com a pasta posta à mão, ele sobe o `frida-server`, faz o `forward`, dispara o `frida -U -f ...` e então chama `ipcMain.handle(...)` (linha 2345). Mas `ipcMain` não é importado no arquivo, e o resultado é `{ success: false, error: 'ipcMain is not defined' }` com o processo do Frida rodando sem registro. Rodei os dois caminhos com `child_process` falso, numa cópia do arquivo numa pasta temporária: os dois saem exatamente assim. Mesmo com o `ipcMain`, o canal `physical-mobile:trigger-lsposed-broadcast` já é registrado pelo `main.js:857`, e o segundo registro lançaria erro. O corte 5 move isso como está. Consertar ou apagar o Frida é decisão do dono, numa PR à parte.
- **O IMEI gerado pelo spoof termina em `NaN`.** O `applySpoofProfile` passa ao `generateIMEI` um TAC de 8 dígitos. O laço do dígito verificador lê 14 dígitos, soma `undefined`, e o IMEI fica `TAC + "NaN"`. O próprio teste de caracterização fixa esse comportamento ("IMEI só fecha com prefixo de 14 dígitos; com TAC de 8 sai NaN"; `resultado.applied.imei.slice(-3) === 'NaN'`). Esse IMEI vai para as propriedades, o EFS, o `service.sh` e a notificação. Os cortes 6 e 7 o preservam; o conserto troca o esperado e é outra PR.

## 6. O que vem antes e o que corre ao lado

- **[Zera os comentários de physicalMobileService.js e global-spoof-service.js](https://github.com/vinicius928e8r84/Nova-AI/pull/149)**, aberta. Tira 84 linhas de comentário deste arquivo, que fica com 2.302 linhas, 110.617 bytes e 605 pontos; medi no head dela. O `applySpoofProfile` cai de 397 para 380 pontos, porque perde 17 linhas de comentário. Os números de linha desta pesquisa são os da `main` em `1b45c3f`. O corte 1 deve partir da `main` depois dela.
- **[refatoracao: Lote Nova 4](https://github.com/vinicius928e8r84/Nova-AI/pull/100)** e **[Limpeza de comentários: infraestrutura do app/electron (442 linhas) com 7 ADRs](https://github.com/vinicius928e8r84/Nova-AI/pull/112)** mexem no `iphone-ssh.js`, de que o `iosSsh` lê as opções, e nos `ios-*`. Vêm antes do corte 2. A segunda também mexe no `geo-proxy.js` e vem antes do corte 3.
- **[Limpeza de comentários: CAM LIVE, protótipos e testes do CAM LIVE (219 linhas) com 5 ADRs](https://github.com/vinicius928e8r84/Nova-AI/pull/108)** mexe no `ios-camera.js`, para onde o corte 5 desvia o iPhone. Vem antes dele.
- **[Apaga as 55 cópias de reserva](https://github.com/vinicius928e8r84/Nova-AI/pull/101)** tira do painel as cinco cópias deste arquivo.
- **O `main.js`** chama 48 métodos do serviço e registra os 27 canais. Enquanto o [Pesquisa: o corte do main.js](https://github.com/vinicius928e8r84/Nova-AI/issues/127) não muda isso, a fachada guarda todos os nomes. Os dois cortes podem correr em série sem se tocar: este não muda o `main.js`, e o do `main.js` só precisa dos nomes da fachada.

## 7. O que não deu para conferir

- **A nota de cada módulo e da fachada no painel.** Só aparece no check do CodeScene quando a PR abre. A catraca em zero não garante nota 10: o painel mede coesão, tamanho e duplicação, que a catraca não mede.
- **Os tamanhos dos módulos e os pontos dos cortes 6 e 7** são estimativa; não escrevi os módulos.
- **O app instalado.** O `fridaInject` foi lido do código e do `app/package.json`. Não abri o app instalado no Mac para ver se a pasta `resources/frida` existe lá, porque o app instalado foi atualizado à mão (`AGENTS.md`, seção 5).
- **Os aparelhos.** Nenhum passo da prova real foi rodado; esta pesquisa só os descreve.

## Fontes

- `app/electron/services/physicalMobileService.js` em `1b45c3f`, nas linhas citadas, e no head da [Zera os comentários de physicalMobileService.js e global-spoof-service.js](https://github.com/vinicius928e8r84/Nova-AI/pull/149) (`git fetch origin pull/149/head`).
- Pontos por função: `scripts/regras/analisador/medir.js` e `pontos.js`, rodados sobre o arquivo; as linhas de base em `scripts/regras/linha-de-base.json`; os limites e a regra do módulo novo em `scripts/regras/regra-saude.js`.
- Nota e achados do painel: API do painel, `GET /api/v2/projects/2/analyses/latest` (análise de 23/11 13:00 UTC, revisão `1b45c3f`) e `GET /api/v2/projects/2/analyses/latest/files`.
- Atenção: `scripts/regras/caminhos-sensiveis.json`.
- Quem usa o serviço: `app/electron/main.js:390-397`, `:692`, `:713-860`; `android-tools.js:277-336`; `ios-camera.js:174`; `iphone-setup/setup.js:53` e `:80`; `cam-live-iphone.js:148`, `:226`, `:285`; `live-cam-bridge.js:412`.
- Testes rodados: os cinco de `app/` pelo `node --test`, com 29 de 29 passando; os sete de `MAC/` pelo `node`, com o resultado da seção 4. CI: `.github/workflows/regras.yml`, linhas 100 a 127.
- Empacotamento: `app/package.json`, linhas 97 (`asar`), 101 a 109 (`files`) e 135 a 139 (`extraResources`).
- As provas pendentes e os aparelhos: [Pesquisa: as provas reais pendentes, arquivo por arquivo](https://github.com/vinicius928e8r84/Nova-AI/issues/137).
- O molde da resposta: [Pesquisa: o corte do browserFarmService.js](https://github.com/vinicius928e8r84/Nova-AI/issues/129).
