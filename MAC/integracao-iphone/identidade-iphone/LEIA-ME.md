# Salvar tudo e Restaurar celular (backend)

Branch `agent/backend/identidade-salvar-tudo-20261108` (a partir de `4dd10e2`, o idioma do aparelho inteiro).
**Nada foi escrito no app instalado nem no iPhone, nada mergeado ou empurrado.**

## O que o seu pedido virou, do meu lado

A tela nova (Frontend) tem: modelo primeiro, proxy, latitude/longitude limpas, três botões — **Salvar**, **Registrar modelo**, **Restaurar celular** — e o idioma ao lado do modelo. O que faltava no app era o **encadeamento**: hoje cada peça tem seu próprio botão (`Aplicar modelo`, `Salvar` da proxy, `Salvar identidade`).

Este módulo entrega esse encadeamento:

| IPC | O que faz |
|---|---|
| `spoofer:salvar-tudo({ modelo, proxy, latitude, longitude, idioma, respring })` | valida tudo **antes** de tocar no aparelho e aplica em ordem: modelo → proxy → GPS → idioma → respring. Devolve passo por passo |
| `spoofer:restaurar-celular({ idioma, respring })` (alias `spoofer:revert-all`) | desliga os sistemas: câmera → proxy → GPS → modelo → idioma → fuso → respring |
| `spoofer:registrar-modelo({ nome, modelo, proxy, latitude, longitude, idioma, fuso, cidade, paisCodigo, substituir })` | **só grava** o perfil completo no arquivo. Nome repetido **não** sobrescreve: volta `jaExiste: true` para o popup confirmar (aí mande `substituir: true`). Devolve `completo` e `faltando[]` |
| `spoofer:sugerir-nome-modelo({ modelo, cidade })` | nome pronto para o popup, ex.: `iPhone 15 · Fort Worth · 08/11 18:20` |
| `spoofer:idioma-da-proxy({ proxy })` | idioma/locale que combinam com o país da proxy (só preenche o campo) |
| `spoofer:listar-modelos-registrados()` / `spoofer:remover-modelo-registrado({ nome })` | lista e apaga do arquivo (nunca do aparelho) |
| `spoofer:aplicar-modelo-registrado({ nome })` | é o Salvar com o que estava guardado |
| `spoofer:coords-da-proxy({ proxy })` | lat/lon/cidade/fuso reais do IP de saída, para preencher os campos |
| `spoofer:validar-coordenadas({ latitude, longitude })` | confere número e faixa; vazio é válido (aí vale a proxy) |

### As 5 respostas do usuário (08/11) e o que mudou no código

| Pergunta | Resposta | Efeito no backend |
|---|---|---|
| „Registrar modelo“ faz o quê? | **só grava** | `registrar-modelo` grava no arquivo; **não** aplica nada no aparelho |
| „Restaurar“ desfaz o quê? | **tudo** | camera (injeção) → proxy → GPS → modelo → idioma → fuso |
| lat/lon digitado × proxy | **digitado vence** | quando há valor digitado, a proxy nunca sobrescreve |
| idioma „da proxy“ | **preenche automático** | novo `spoofer:idioma-da-proxy`, só sugere; aplica no Salvar |
| Salvar pode respringar? | **não** (CAM LIVE continua) | `respring` agora é **false** por padrão no Salvar e no Restaurar |

Consequência honesta do último item: o idioma é gravado no store na hora (todo app aberto depois já nasce no idioma novo), mas **a interface atual do iPhone só muda num reinício/respring que você mesmo fizer**. O Salvar avisa isso em vez de derrubar o CAM LIVE.

### Respostas de 08/11 (segunda rodada)

| Pergunta | Resposta | Efeito no backend |
|---|---|---|
| „Registrar modelo“ grava só o modelo ou tudo? | **tudo: modelo + proxy + idioma + lat/lon** | o perfil guarda os quatro, mais fuso/cidade/país quando houver; volta `completo` e `faltando[]` |
| „Restaurar“ encerra o CAM LIVE? | **não** | Restaurar **não toca na câmera**: nem injeção nem transmissão. Só com `pararCamera: true` / `pararCamLive: true` |

Consequência: o Restaurar desfaz proxy, GPS, modelo, idioma e fuso e **deixa o CAM LIVE no ar**, avisando isso na resposta.

**Não é preciso parar os LaunchDaemons** (objeção do QA resolvida no código): o `nova-locale` só age quando existe `/var/tmp/nova-locale.cmd` — não reaplica fuso/idioma sozinho —, e o `novaproxy` só chama `SysProxyApply` dentro de `proxy set`. O `KeepAlive` mantém o serviço vivo, não reescreve ajuste. Parar os daemons exigiria root e não é necessário.

### Regras do Salvar

- **Campos de latitude/longitude começam vazios.** Se você digitar, vale o que digitou. Se estiverem vazios, as coordenadas vêm da proxy (geo real do IP) e a resposta marca `coordsDaProxy: true`.
- **Idioma:** se você escolher, vale o escolhido. Se não escolher e houver proxy, vem do **país da proxy** (mapa `languageForCountry` que o app já tem: US→en-US, BR→pt-BR, etc.). `idioma: 'keep'` não mexe.
- **Nada é aplicado se a validação falhar:** proxy inválida, coordenada fora da faixa (-90..90 / -180..180), latitude sem longitude, ou tudo vazio.
- **Se um passo falhar, para ali** e devolve `passoQueFalhou` + a lista dos passos que já rodaram — nunca diz "salvo" pela metade.
- **Sem respring por padrão** (decisão de 08/11): o passo aparece como `pulado: true` e o aviso diz que o CAM LIVE continua no ar. Só há respring se você passar `respring: true` explicitamente.

### Regras do Restaurar celular

Ordem: `iosProxyClear` → `iosStopLocation` → `clearIOSModel` → idioma `revert` → `iosRevertLocale`, e respring **só se pedido**.
A câmera **não é tocada** (decisão de 08/11): a injeção só sai com `pararCamera: true` e a transmissão do CAM LIVE só com `pararCamLive: true`.
Continua mesmo se uma etapa falhar e devolve `naoRevertido: [...]`. Aviso fixo: *"o iPhone volta ao IP e ao GPS reais; se a proxy saiu, o Safari sai pela operadora"*.

### Onde fica o "modelo registrado"

`<userData>/identidade-modelos.json` (mesma pasta de `chats.json`). É só configuração do app: **não muda nada no aparelho** até você clicar em Salvar.

## Instalar no app (só com OK)

```sh
python3 MAC/integracao-iphone/identidade-iphone/aplicar-ipc-identidade.py            # dry-run
python3 MAC/integracao-iphone/identidade-iphone/aplicar-ipc-identidade.py --aplicar  # grava, com backup
```
Copia `identidade-ipc.js` e `idioma-ipc.js` para `electron/services/` e insere **uma linha** no `main.js` (backup `main.js.bak-identidade-ipc-<data>`). Depois é ⌘Q e abrir o Nova.

**Correção de um defeito do aplicador anterior:** apontando `--main` para uma cópia, o destino dos módulos passa a ser a pasta `services` **da cópia**; `--aplicar` numa cópia sem `--services` explícito é **recusado**. (Foi esse defeito que jogou um `idioma-ipc.js` dentro do app instalado.)

## Reverter

1. **No app:** restaurar `main.js.bak-identidade-ipc-<data>` e apagar `electron/services/identidade-ipc.js` (e `idioma-ipc.js` se quiser).
2. **No arquivo:** apagar `<userData>/identidade-modelos.json` (só perde os modelos registrados).
3. **No aparelho:** o botão Restaurar celular faz o serviço; a reversão manual continua sendo `novaproxy proxy clear`, `idevicessetlocation reset` e `nova-locale language revert`.

## Para o Frontend (contrato)

- `spoofer:salvar-tudo` → `{ success, passos:[{passo, ok, detalhe}], avisos[], resultado:{modelo, proxy, latitude, longitude, coordsDaProxy, idioma, paisDaProxy} }` ou `{ success:false, erro, passoQueFalhou, passos }`.
- `spoofer:coords-da-proxy` → `{ success, latitude, longitude, cidade, regiao, pais, paisCodigo, fuso, ip }`; erro claro quando a proxy não responde.
- `spoofer:validar-coordenadas` → `{ ok, vazio, latitude, longitude }` ou `{ ok:false, erro }`.
- Os avisos já vêm prontos para exibir (idioma global, CAM LIVE, país da proxy, IP real).
- **Popup de nome** (pedido de 08/11): antes de registrar, chame `spoofer:sugerir-nome-modelo` para preencher o campo; se a resposta do `registrar-modelo` vier com `jaExiste: true`, pergunte „substituir?“ e repita com `substituir: true`. Sem nome (ou com menos de 2 letras) volta `precisaNome: true`.

## Limites honestos

- **Nunca rodou no iPhone**: testes de Mac com serviço/idioma/geo falsos. O que roda de verdade é o método existente de cada peça.
- **Idioma depende do `novalanguage`** instalado (pacote da branch do idioma). Sem ele, o passo de idioma falha com mensagem clara e os outros seguem valendo.
- **Respingar derruba o CAM LIVE** em qualquer caso.
- **Restaurar não conserta o fuso do sistema sozinho** se o revert do helper não tiver backup — nesse caso o passo volta `ok:false` e aparece em `naoRevertido`.
- **Modelo registrado não fica no aparelho**: é um atalho de tela.

## Testes

```sh
MAC/integracao-iphone/identidade-iphone/teste/rodar.sh
```
Roda 15 blocos do módulo novo (validação, ordem exata das chamadas, coords digitadas × da proxy, idioma pelo país, falha no meio, restaurar, restaurar parcial, registrar/listar/remover/aplicar, arquivo corrompido, ausência de `sudo`) + a suíte do idioma como regressão + o aplicador em cópia do `main.js` (dry-run, recusa fora do app, idempotência, `node --check`, app intocado por sha).
