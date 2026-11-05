# Spoofing de modelo do iPhone — integração no app (iOS Engineer)

Parte do item 4 da spec `NOVA-AI-MODELO-SPOOF-SPEC.md`. Complementa o tweak
`com.aquiles.novamodel` (pasta `MAC/integracao-modelo/`, do Jailbreak Specialist).
Aqui fica só o lado do app: serviço + IPC + banco + instalação do `.deb` pelo Conectar.

## O que faz

- `physicalMobileService`: métodos `getIosModels()`, `applyIOSModel(deviceId, productType)`,
  `clearIOSModel(deviceId)` e `getIOSModel(deviceId)`. Chamam o CLI
  `/var/jb/usr/bin/novamodel` via `iosSsh` (túnel USB 2222 → mobile@127.0.0.1), como os
  demais comandos iOS.
- `main.js`: IPCs `iphone:model:list/apply/clear/status` (mesmo padrão dos `iphone:proxy:*`).
- Banco `iosModels.json` (em `electron/services/`, junto do serviço) alimenta o seletor e
  valida o productType antes de aplicar.
- `conexao-usb/setup.js`: instala `novamodel.deb` pelo fluxo Conectar quando o pacote
  existir ao lado do `camera.deb`.

## Como o painel vai chamar (contrato IPC)

| Canal | Argumentos | Retorno |
|---|---|---|
| `iphone:model:list` | — | `{ success, models: [{ productType, name }] }` |
| `iphone:model:apply` | `{ id, productType }` | `{ success, productType }` ou `{ success:false, error }` |
| `iphone:model:clear` | `{ id }` | `{ success }` |
| `iphone:model:status` | `{ id }` | `{ success, real, active, enabled }` |

`id` é o identificador do aparelho (`ios-<udid>`); os métodos recusam IDs Android.
A lista de modelos para o seletor vem de `iphone:model:list`.

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
