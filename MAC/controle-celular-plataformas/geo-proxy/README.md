# Localização automática a partir da proxy — Controle do Celular

Aplicado em 04/11/2026 no app instalado (`/Applications/Nova AI Mac.app`).

## O que faz

No painel **Identidade simulada**:

1. Ao clicar em **Salvar** (proxy) ou **Salvar identidade do iPhone**, o app:
   - pergunta o IP de saída **ao próprio iPhone** (`novaproxy proxy check`, via SSH do jailbreak);
   - se não vier IP, consulta a geo **através** da proxy (SOCKS5 com usuário/senha, do Mac);
   - geolocaliza esse IP (`ipwho.is`) e preenche **Latitude / Longitude**;
   - aplica o GPS no aparelho na hora.
2. Ao **abrir a aba** Identidade com uma proxy já salva, a localização é reaplicada.
3. O botão **"Fixar GPS Falso"** foi removido (o GPS é aplicado sozinho). O botão **"Parar"** continua e restaura a localização real.
4. A linha de status mostra `✓ GPS em <cidade> / <país> (IP <ip>) · fuso <tz>`.

## Como o GPS é aplicado

| Plataforma | Mecanismo | Observação |
|---|---|---|
| iPhone | `idevicesetlocation --udid <udid> -- <lat> <lon>` (libimobiledevice) | precisa da **Developer Disk Image** montada no iPhone |
| iPhone (parar) | `idevicesetlocation --udid <udid> reset` | — |
| Android | `adb root` + `cmd location set-test-provider-location` (loop `nova_gps_loop`) | já existia, agora recebe as coordenadas da proxy |

### Imagem de desenvolvedor (iPhone)

A DDI é necessária porque o serviço `com.apple.dt.simulatelocation` só existe com ela montada.
O app tenta montar sozinho quando o `idevicesetlocation` falha com "developer disk image":

- procura `pymobiledevice3` em `$NOVA_PYMOBILEDEVICE3`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`;
- roda `pymobiledevice3 mounter auto-mount --udid <udid>` (baixa a imagem certa da Apple).

Instalado nesta máquina:

```sh
python3 -m venv ~/.local/venvs/pmd3
~/.local/venvs/pmd3/bin/pip install pymobiledevice3
ln -sf ~/.local/venvs/pmd3/bin/pymobiledevice3 ~/.local/bin/pymobiledevice3
```

Também é preciso o `idevicesetlocation` (vem com `libimobiledevice`): `/opt/homebrew/bin/idevicesetlocation`.

A DDI cai quando o iPhone reinicia; o auto-mount remonta na próxima vez que o GPS for aplicado (precisa de internet na primeira vez).

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `electron/services/geo-proxy.js` (novo) | módulo puro: parse da proxy, consulta via SOCKS5, geo por IP |
| `electron/services/physicalMobileService.js` | `geoFromProxy`, `iosSetLocation`, `iosStopLocation`, auto-mount da DDI, branch iOS no `setSpoofLocation`/`stopFakeGPS` |
| `electron/main.js` | IPC `spoofer:geo-from-proxy` |
| `dist/assets/index-Dun7lr2S.js` | `pGeoApply`, `pGeoOnOpen`, chamadas ao salvar, remoção do botão "Fixar GPS Falso" |

Cópias dos arquivos já aplicados: `aplicado/`. Backup do original: `reservas/<data-hora>/`.

## Reaplicar (depois de atualizar o app)

O script do renderer sempre parte do **bundle original**:

```sh
cd "/Users/aquilesneri/Desktop/Nova-AI/MAC/controle-celular-plataformas/geo-proxy"
python3 aplicar-geo.py reservas/<data>/index-Dun7lr2S.js /tmp/novo.js
cp /tmp/novo.js "/Applications/Nova AI Mac.app/Contents/Resources/app/dist/assets/index-Dun7lr2S.js"
```

Backend: copiar `aplicado/main.geo.js`, `aplicado/physicalMobileService.geo.js` e `geo-proxy.js`
para os caminhos correspondentes (ou reaplicar os trechos manualmente).

## Desfazer

```sh
cp reservas/<data>/index-Dun7lr2S.js "/Applications/Nova AI Mac.app/Contents/Resources/app/dist/assets/index-Dun7lr2S.js"
cp reservas/<data>/main.js "/Applications/Nova AI Mac.app/Contents/Resources/app/electron/main.js"
cp reservas/<data>/physicalMobileService.js "/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services/physicalMobileService.js"
rm "/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services/geo-proxy.js"
```

## Testado em 04/11/2026

- `node --check` nos três arquivos de backend e no bundle (como ESM).
- Geo real pela proxy: `socks5://premium-residential.evomi.com:1002` → `73.41.122.60` (Manteca/US) e, em outra sessão, `108.46.225.216` (Nova York/US) — o pool rotaciona.
- Pelo aparelho: `novaproxy proxy check` → IP de saída, geo bateu com o `ipwho.is`.
- GPS no iPhone: syslog do `locationd` mostrou `@ClxSimulated, Fix, 1 … acc 5.00` após aplicar; "Parar" limpa o estado na UI.
- Fluxo no app (via CDP): abrir a aba aplica o GPS; clicar em **Salvar** reaplica (log `[Geo] iPhone GPS aplicado`).

## Limitações conhecidas

- **Android** não tem auto-geo: o proxy do Android não é salvo na mesma chave (`nova_iphone_proxy_`), então o efeito só roda para iPhone. O GPS manual continua funcionando.
- **Proxy rotativo**: a coordenada é recalculada a cada save/abertura da aba. Se o pool trocar de país no meio da sessão, o GPS fica no país antigo até reabrir a aba.
- **Fuso/idioma do aparelho** não são alterados: GPS nos EUA com fuso do Brasil continua sendo um mismatch.
- O GPS simulado cai quando o iPhone reinicia; reabra a aba (ou salve a proxy) para reaplicar.

## Fuso e idioma (helper root `nova-locale`)

O iOS **já ajusta o fuso sozinho** quando a localização simulada muda — mas só com o
aparelho desbloqueado/em uso (testado: Tóquio mudou em segundos; Nova York, com a tela
bloqueada, não mudou em 2 min).

O **idioma** não muda sem root: o `cfprefsd` roda como root e mantém o cache do
`.GlobalPreferences.plist`; escrever o arquivo como `mobile` não tem efeito (testado:
respring e a tela continuou em pt-BR).

Por isso existe o helper `nova-locale`, instalado uma vez:

| Arquivo | Papel |
|---|---|
| `helper/nova-locale.sh` | daemon root: lê `/var/tmp/nova-locale.cmd` (chaves `action`, `tz`, `plist`), valida, troca o fuso, aplica o plist de idioma, mata o `cfprefsd`, respinga e escreve `/var/tmp/nova-locale-status.json` |
| `helper/com.aquiles.novalocale.plist` | LaunchDaemon (`com.aquiles.novalocale`, `KeepAlive`) |
| `helper/instalar-root.sh` | roda como root: copia os dois e faz `launchctl bootstrap` |
| `helper/instalar-helper-idioma.command` | instalador para o usuário (pede a senha do iPhone uma vez) |

Instalação (uma vez, com o iPhone conectado e o Nova aberto):

```sh
"/Users/aquilesneri/Desktop/Nova-AI/MAC/controle-celular-plataformas/geo-proxy/helper/instalar-helper-idioma.command"
```

Depois disso, ao salvar a proxy o Nova:
1. pega a geo (IP de saída);
2. aplica o GPS;
3. monta o plist do iPhone com `AppleLanguages`/`AppleLocale` do país do IP
   (ex.: US → `en-US` / `en_US`) via `plutil` no Mac;
4. envia `action=apply` + `tz` para o helper, que troca o fuso, aplica o idioma e respinga.

"Parar" envia `action=revert`: volta o fuso e o plist originais (backup em
`/var/mobile/nova-globalprefs-original.plist`).

Segurança: o daemon **não executa** nada do arquivo de comando — lê apenas `action`,
`tz` e `plist`; valida o fuso contra `/var/db/timezone/zoneinfo` e exige que o plist
comece com `<?xml` e esteja em `/var/tmp/`.

Observações:
- cada troca de idioma custa um respring (~5 s);
- o helper depende do jailbreak ativo (reboot derruba, como o `novaproxy`);
- se o helper não estiver instalado, o app mostra `idioma: helper não instalado` e segue
  apenas com GPS + fuso automático do iOS.
