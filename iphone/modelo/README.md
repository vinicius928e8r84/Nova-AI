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
cd "$HOME/Desktop/Nova-AI/MAC/integracao-modelo"
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
