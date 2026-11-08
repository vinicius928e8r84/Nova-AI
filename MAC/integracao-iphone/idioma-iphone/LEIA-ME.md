# Idioma do aparelho pelo app (backend)

Branch `agent/backend/idioma-iphone-20261108`, a partir de `agent/ios/locale-endurecer-20261107` (`92c2472`).
**Nada foi instalado no iPhone, nada foi escrito no app instalado, nada foi mergeado ou empurrado.**

## Por que este caminho

O que o time mediu e este trabalho usa:

- **Escrever o `.plist` à mão não funciona**: a autoridade é o cache do `cfprefsd`.
- **A API `localizationswitcherd` recusa escrita** (erro 4097), inclusive como root.
- **`CFPreferencesSetValue` + `Synchronize` como `mobile` FUNCIONA** no store, que é quem manda em tempo de execução. É o que este pacote usa.
- **Respingar não precisa de root**: `kill -9` no SpringBoard (roda como `mobile`).
- **Nenhum passo usa `sudo`**. O binário novo **não é setuid** (diferente do `novaproxy`).

## O que foi entregue

| Arquivo | O que é |
|---|---|
| `novalanguage/main.m` | binário pequeno (Objective-C/Foundation) que lê e grava o idioma pelo CFPreferences, com leitura de confirmação |
| `novalanguage/{Makefile,control,layout}` | pacote `com.aquiles.novalanguage` 0.1, arm64/rootless, instala em `/var/jb/usr/bin/novalanguage`, `postinst` deixa 755 (sem SUID) |
| `nova-locale.sh` (v3) | helper do aparelho com `language get/set/revert` e `respring` (as duas cópias do repo: `conexao-usb/` e `geo-proxy/helper/`) |
| `idioma-ipc.js` | módulo do app com os handlers `spoofer:*language` (lógica pura, testável) |
| `aplicar-ipc-idioma.py` | aplicador idempotente: copia o módulo para `electron/services/` e insere **uma linha** no `main.js`; dry-run por padrão |
| `teste/` | 4 blocos de teste que rodam no Mac, sem aparelho |

Pacote construído (não instalado): `novalanguage/packages/com.aquiles.novalanguage_0.1-1+debug_iphoneos-arm64.deb` (9.672 B, binário `Mach-O arm64`).

## Comandos exatos no aparelho

O helper aceita `--format json` (padrão) ou `--format lines`, e `--domain global|<bundle-id>`.

```sh
# ler o idioma atual (do STORE, não do arquivo)
/var/jb/usr/bin/nova-locale language get
/var/jb/usr/bin/nova-locale language get --domain com.apple.mobilesafari --format lines

# aplicar no aparelho inteiro (avisa do Accept-Language e guarda backup do valor anterior)
/var/jb/usr/bin/nova-locale language set pt-BR
/var/jb/usr/bin/nova-locale language set en-US --locale en_US --respring

# aplicar só num app (sem respring)
/var/jb/usr/bin/nova-locale language set en-US --domain com.apple.Preferences

# voltar ao que estava antes do primeiro set daquele domínio
/var/jb/usr/bin/nova-locale language revert
/var/jb/usr/bin/nova-locale language revert --domain com.apple.Preferences

# respring (a interface só muda com isto; o CAM LIVE cai)
/var/jb/usr/bin/nova-locale respring
```

O que o comando devolve, em `lines` (exemplo de `set`):

```
confirmed=yes       ← leitura de volta no store: é isso que vale
domain=global
language=pt-BR
locale=pt_BR
override=yes
diskMatches=no      ← disco diferente do store: desligamento limpo pode voltar
warn=idioma global muda o Accept-Language que os sites recebem (com IP dos EUA fica incoerente)
warn=a interface só muda com respring (o CAM LIVE cai); rode: nova-locale respring
```

Códigos de saída: `0` ok · `2` uso/argumento · `3` `novalanguage` não instalado · `4` o aparelho não confirmou · `5` revert sem backup.

## IPC no app (contrato para o Frontend)

Registrados por `idioma-ipc.js` (após rodar `aplicar-ipc-idioma.py --aplicar` e reabrir o Nova):

- `spoofer:get-language({ domain })` → `{ success, domain, language, nome, locale, override, disco, discoCombina, avisos[] }`
- `spoofer:apply-language({ tag, domain, respring, locale, confirmGlobal })` → `{ success, aplicado, confirmed, respring, avisos[], error }`
  - **domínio `global` exige `confirmGlobal: true`**; sem isso devolve `{ success:false, precisaConfirmar:true, avisos:[...] }` e **não executa nada**.
- `spoofer:set-language` → alias do `apply-language` (o Frontend tinha pedido esse nome).
- `spoofer:revert-language({ domain, respring })`
- `spoofer:respring-iphone()`

Os avisos sempre incluem: global muda `Accept-Language` dos sites; respring derruba o CAM LIVE (e, se já respingou, que a câmera precisa reconectar); disco diferente do store no domínio global.

## Caminho de reverter (três níveis)

1. **Idioma no aparelho** — `nova-locale language revert` devolve o valor que existia antes do primeiro `set` daquele domínio (backup em `/var/mobile/Library/Preferences/com.aquiles.novalocale.idioma.<domínio>.orig`, criado por cópia, nunca apagado).
   - Se o backup não existir (nada foi aplicado por este helper), o comando falha com mensagem clara em vez de chutar um valor.
   - Atenção: hoje o aparelho já está `pt-BR`; o "original" que o helper guardar na primeira vez será `pt-BR`. Para forçar inglês: `language set en-US --locale en_US`.
2. **IPC no app** — restaurar o backup criado pelo aplicador: `main.js.bak-idioma-ipc-<data>` (e apagar `electron/services/idioma-ipc.js`).
3. **Helper** — o `nova-locale.sh` v2 aplicado hoje tem backup `nova-locale.sh.bak-locale-v2-20261107-154333` no `iphone-setup` do app.

## Para levar ao aparelho (só com OK do usuário)

1. `dpkg -i com.aquiles.novalanguage_0.1-1+debug_iphoneos-arm64.deb` (uma vez, com a senha do usuário — é a instalação do pacote, não a escrita do idioma).
2. copiar o `nova-locale.sh` v3 para `/var/jb/usr/libexec/nova-locale.sh` (é o caminho que o `com.aquiles.novalocale.plist` executa; o `launchctl kickstart -k system/com.aquiles.novalocale` depois disso recarrega o v3 — o daemon não precisa de respring).
3. nada de respring neste passo (o respring é decisão do usuário na tela).

## Limites honestos

- **Não foi executado no iPhone**: esta branch é código + testes de Mac. O que foi provado no aparelho pelo time (CFPreferences, respring sem root) é o que embasa o desenho; o binário novo ainda não rodou lá.
- **Global muda o que os sites veem**: o `Accept-Language` segue o idioma primário do sistema. Idioma por app não muda header.
- **Disco × store**: o arquivo `.GlobalPreferences.plist` pode ficar atrás do store; a ferramenta **mostra** isso (`diskMatches`) e a rota recomenda respring + repetir.
- **Respring derruba o CAM LIVE** em qualquer caso.
- **AppleLocale** só muda se você passar `--locale`; sem isso o aparelho fica com o estado misto (texto em pt, data/número em en_US) que o QA apontou.

## Testes (Mac, sem aparelho)

```sh
MAC/integracao-iphone/idioma-iphone/teste/rodar.sh
```

Blocos: `novalanguage` (compila o `main.m` e faz ida-e-volta num domínio descartável), helper v3 (14 casos com binário e `killall` falsos), IPC (createHandlers com `exec` falso: validação, confirmação obrigatória no global, avisos, sem `sudo`) e o aplicador (dry-run, idempotência, `node --check`, e prova de que o `main.js` do app **não** muda).
