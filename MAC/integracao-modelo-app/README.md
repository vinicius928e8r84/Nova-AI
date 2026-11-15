# Spoofing de modelo do iPhone — integração no app (iOS Engineer)

Parte do item 4 da spec `NOVA-AI-MODELO-SPOOF-SPEC.md`. Complementa o tweak
`com.aquiles.novamodel` (pasta `MAC/integracao-modelo/`, do Jailbreak Specialist).
Aqui fica só o lado do app: serviço + IPC + banco + instalação do `.deb` pelo Conectar.

## O que faz

- `physicalMobileService`: métodos `getIosModels()`, `applyIOSModel(deviceId, productType)`,
  `clearIOSModel(deviceId)` e `getIOSModel(deviceId)`. Chamam o CLI
  `/var/jb/usr/bin/novamodel` via `iosSsh` (túnel USB 2222 → mobile@127.0.0.1), como os
  demais comandos iOS.
- `main.js`: IPCs `spoofer:get-ios-models`/`spoofer:apply-ios-model`/`spoofer:clear-ios-model`/`spoofer:get-ios-model`
  (nomes exatos do contrato da UI — branch `agent/frontend/modelo-iphone-20261105`).
- Banco `iosModels.json` (em `electron/services/`, junto do serviço) alimenta o seletor e
  valida o productType antes de aplicar.
- `conexao-usb/setup.js`: instala `novamodel.deb` pelo fluxo Conectar quando o pacote
  existir ao lado do `camera.deb`.

## Como o painel vai chamar (contrato IPC)

| Canal | Argumentos | Retorno |
|---|---|---|
| `spoofer:get-ios-models` | — | `{ success, models: [{ productType, name }] }` |
| `spoofer:apply-ios-model` | `{ deviceId, productType }` | `{ success, applied: { productType, name } }` ou `{ success:false, error }` |
| `spoofer:clear-ios-model` | `{ deviceId }` | `{ success }` |
| `spoofer:get-ios-model` | `{ deviceId }` | `{ success, real, active, enabled }` |

`deviceId` é o identificador do aparelho (`ios-<udid>`); os métodos recusam IDs Android.
O seletor da UI busca a lista em `spoofer:get-ios-models` (27 modelos de `iosModels.json`),
e envia o `productType` no apply (ex.: iPhone 13 = `iPhone14,5`).

## Arquivos

| Arquivo | Papel |
|---|---|
| `MAC/integracao-iphone/ios-modelo.js` (novo) | módulo puro: comandos + parse de status (testável) |
| `MAC/integracao-iphone/iosModels.json` (novo) | banco de modelos iOS |
| `MAC/integracao-iphone/physicalMobileService.patched.js` | + `getIosModels`/`applyIOSModel`/`clearIOSModel`/`getIOSModel` |
| `MAC/integracao-modelo-app/main.modelo.js` | `main.js` com os 4 IPCs (cópia aplicável, base no main mais completo) |
| `MAC/integracao-iphone/conexao-usb/setup.js` | + instalação do `novamodel.deb` (guardado por existência) |
| `MAC/integracao-modelo-app/novamodel.test.cjs` | teste com mock de SSH |

## Aplicar no app instalado (quando o .deb existir)

1. Copiar `ios-modelo.js` e `iosModels.json` para `Contents/Resources/app/electron/services/`.
2. Aplicar os 4 IPCs em `Contents/Resources/app/electron/main.js` (trecho em `main.modelo.js`).
3. Aplicar o bloco do `novamodel.deb` em `Contents/Resources/app/electron/services/iphone-setup/setup.js`.
4. Colocar o `novamodel.deb` (do Jailbreak Specialist) em `services/iphone-setup/` ao lado do `camera.deb`.
5. `node --check` nos arquivos tocados e reiniciar o Nova.

## Testado

- `node --check` em `ios-modelo.js`, `physicalMobileService.patched.js`, `setup.js`, `main.modelo.js`.
- `node MAC/integracao-modelo-app/novamodel.test.cjs`: 30 verificações (comandos, parse,
  validação do banco, métodos do serviço com `iosSsh` mockado, falha de SSH).

## SEM testar (depende do Jailbreak Specialist / aparelho)

- O `.deb` do `novamodel` ainda não existe → instalação e chamada real do CLI não testadas.
- Comportamento no aparelho (Ajustes → Sobre, apps lendo `MGCopyAnswer`) — fora do escopo
  do app; é do tweak.
- IPC real no Electron (não há harness aqui); validado por sintaxe + mock do serviço.
