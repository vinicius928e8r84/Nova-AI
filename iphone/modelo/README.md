# Spoofing de modelo do iPhone (com.aquiles.novamodel)

Faz o iPhone (iOS 16.7.16, palera1n rootless) reportar **outro modelo** — ex. "iPhone 13"
(`iPhone14,5`) — para apps e para o sistema (Ajustes → Geral → Sobre), com aplicar/limpar
instantâneo. É a contraparte iOS do spoofing de identidade que hoje só existe em Android
(Magisk/resetprop). **Só modelo** — sem IMEI/serial/baseband.

Contrato com o app: `~/OpenBot/Shared/NOVA-AI-MODELO-SPOOF-SPEC.md`.

## O que entrega

| Arquivo | Papel |
|---|---|
| `Tweak.x` | Tweak Substrate/ellekit (rootless) que injeta o modelo. Carrega em todo processo (o `%ctor` ignora só a CLI `novamodel`). |
| `NovaModel.plist` | Filtro vazio = carrega em todos os processos (spoofing de sistema inteiro). |
| `main.m` | CLI `/var/jb/usr/bin/novamodel` (setuid root): `set` / `clear` / `status`. |
| `models.json` | Banco de 27 modelos iOS (ProductType + nome de marketing). Instalado em `/var/jb/usr/share/novamodel/models.json`. |
| `layout/DEBIAN/postinst` | `chmod 4755` no `novamodel` (setuid root, mesmo padrão do `novaproxy`). |
| `layout/DEBIAN/prerm` | Antes de remover, restaura o modelo real. |
| `test/teste-novamodel.cjs` | Valida JSON do banco, contrato do control file, whitelist MG e os ProductTypes da spec. |

## Como funciona o tweak

Lê `/var/tmp/nova-model-control.json` (mesmo padrão do OBSGraphBridge):

```json
{ "enabled": true, "productType": "iPhone14,5", "name": "iPhone 13" }
```

- `enabled: false` (ou arquivo ausente) = modelo real.
- A leitura usa **cache por mtime/size**: a cada chamada só faz `stat`; re-parseia o JSON
  quando o arquivo muda — efeito instantâneo sem custo por chamada.

Hooks (whitelist fechado, para não quebrar outros subsistemas):

| Alvo | Chaves/nomes filtrados | Valor injetado |
|---|---|---|
| `MGCopyAnswer` / `MGCopyAnswerWithError` / `MGGetStringAnswer` (libMobileGestalt) | `ProductType`, `HWModelStr`, `ModelNumber`, `ProductName`, `MarketingProductName` | do control file |
| `sysctlbyname` / `sysctl` (libc) | `hw.machine`, `hw.product` | `ProductType` / `MarketingProductName` |
| `UIDevice` | `model`, `localizedModel`, `modelName` (privado, se existir), `_modelName` | `ProductName` / `MarketingProductName` |

A CLI `novamodel` roda **sem** o tweak (o `%ctor` a ignora), então `status` sempre lê o
`ProductType` real do aparelho.

## CLI no aparelho

```sh
/var/jb/usr/bin/novamodel set iPhone14,5   # aplica iPhone 13
/var/jb/usr/bin/novamodel clear            # volta ao modelo real
/var/jb/usr/bin/novamodel status           # {"real":"iPhone10,2","active":"iPhone14,5","enabled":true}
```

## Compilar

```sh
export THEOS=~/theos
cd "$HOME/Desktop/Nova-AI/iphone/modelo"
make clean && make package
# saída: packages/com.aquiles.novamodel_0.1-*.deb
```

## Instalar no iPhone (rootless)

```sh
# com o iPhone plugado, jailbreak ativo e OpenSSH:
iproxy 2222 22 &
scp -P 2222 packages/com.aquiles.novamodel_0.1-*.deb mobile@127.0.0.1:/var/tmp/
ssh -p 2222 mobile@127.0.0.1 "sudo dpkg -i /var/tmp/com.aquiles.novamodel_0.1-*.deb"
```

Depois de instalado, testar: `ssh -p 2222 mobile@127.0.0.1 "/var/jb/usr/bin/novamodel status"`.

## Testado / sem testar

- ✅ Compila (`make package`) no theos com SDK iPhoneOS 16.5, scheme rootless, arm64.
- ✅ `.deb` montado com `NovaModel.dylib` + `NovaModel.plist` + `/usr/bin/novamodel` + `models.json`.
- ✅ `node test/teste-novamodel.cjs` (banco, contrato, whitelist MG, referência da spec).
- ❌ **Não testado no aparelho real** (só com autorização de QA/usuário): o efeito em
  Ajustes → Sobre e em apps; `dpkg -i` + setuid; comportamento de apps que cacheiam o
  modelo (podem exigir reabrir ou respring).

## Limitações (v1)

- `HWModelStr` e `ModelNumber` estão **no whitelist** (prontos para o futuro) mas não são
  spoofados: os códigos de placa/número de modelo são por variante/região e inventar valor
  quebraria subsistemas. O `ProductType` + nome de marketing já mudam o que Ajustes e apps leem.
- `localizedModel`/`modelName` retornam o nome de marketing **não localizado**.
- Aplicação é por leitura sob demanda: apps já abertos que cachearam o modelo na memória
  precisam ser reabertos (ou respring) para verem o valor novo.
- O spoofing cai se o jailbreak for desligado (reboot), como os demais tweaks rootless.

## Integração no app (iOS Engineer)

Parte do item 4 da spec `NOVA-AI-MODELO-SPOOF-SPEC.md`. Complementa o tweak
`com.aquiles.novamodel` (pasta `iphone/modelo/`, do Jailbreak Specialist).
Aqui fica só o lado do app: serviço + IPC + banco + instalação do `.deb` pelo Conectar.

### O que faz

- `physicalMobileService`: métodos `getIosModels()`, `applyIOSModel(deviceId, productType)`,
  `clearIOSModel(deviceId)` e `getIOSModel(deviceId)`. Chamam o CLI
  `/var/jb/usr/bin/novamodel` via `iosSsh` (túnel USB 2222 → mobile@127.0.0.1), como os
  demais comandos iOS.
- `main.js`: IPCs `spoofer:get-ios-models`/`spoofer:apply-ios-model`/`spoofer:clear-ios-model`/`spoofer:get-ios-model`
  (nomes exatos do contrato da UI — branch `agent/frontend/modelo-iphone-20261105`).
- Banco `iosModels.json` (em `electron/services/`, junto do serviço) alimenta o seletor e
  valida o productType antes de aplicar.
- `iphone-setup/setup.js`: instala `novamodel.deb` pelo fluxo Conectar quando o pacote
  existir ao lado do `camera.deb`.

### Como o painel vai chamar (contrato IPC)

| Canal | Argumentos | Retorno |
|---|---|---|
| `spoofer:get-ios-models` | — | `{ success, models: [{ productType, name }] }` |
| `spoofer:apply-ios-model` | `{ deviceId, productType }` | `{ success, applied: { productType, name } }` ou `{ success:false, error }` |
| `spoofer:clear-ios-model` | `{ deviceId }` | `{ success }` |
| `spoofer:get-ios-model` | `{ deviceId }` | `{ success, real, active, enabled }` |

`deviceId` é o identificador do aparelho (`ios-<udid>`); os métodos recusam IDs Android.
O seletor da UI busca a lista em `spoofer:get-ios-models` (27 modelos de `iosModels.json`),
e envia o `productType` no apply (ex.: iPhone 13 = `iPhone14,5`).

### Arquivos

| Arquivo | Papel |
|---|---|
| `app/electron/services/ios-modelo.js` | módulo puro: comandos + parse de status (testável) |
| `iphone/modelo/iosModels.json` (novo) | banco de modelos iOS |
| `app/electron/services/physicalMobileService.js` | `getIosModels`/`applyIOSModel`/`clearIOSModel`/`getIOSModel` |
| `app/electron/services/iphone-setup/setup.js` | + instalação do `novamodel.deb` (guardado por existência) |
| `test/iphone/novamodel.test.cjs` | teste com mock de SSH |

### Aplicar no app instalado (quando o .deb existir)

1. Copiar `app/electron/services/ios-modelo.js` e `iosModels.json` para `Contents/Resources/app/electron/services/`.
2. Os 4 IPCs já estão em `app/electron/main.js`.
3. Copiar `app/electron/services/iphone-setup/setup.js` (já tem o bloco do `novamodel.deb`) para `Contents/Resources/app/electron/services/iphone-setup/`.
4. Colocar o `novamodel.deb` (do Jailbreak Specialist) em `services/iphone-setup/` ao lado do `camera.deb`.
5. `node --check` nos arquivos tocados e reiniciar o Nova.

### Testado

- `node --check` em `ios-modelo.js`, `app/electron/services/physicalMobileService.js`, `setup.js`.
- `node test/iphone/novamodel.test.cjs`: 30 verificações (comandos, parse,
  validação do banco, métodos do serviço com `iosSsh` mockado, falha de SSH).

### SEM testar (depende do Jailbreak Specialist / aparelho)

- O `.deb` do `novamodel` ainda não existe → instalação e chamada real do CLI não testadas.
- Comportamento no aparelho (Ajustes → Sobre, apps lendo `MGCopyAnswer`) — fora do escopo
  do app; é do tweak.
- IPC real no Electron (não há harness aqui); validado por sintaxe + mock do serviço.
