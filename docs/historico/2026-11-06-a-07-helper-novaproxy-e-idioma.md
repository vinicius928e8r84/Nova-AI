# Histórico — 06 e 07/11/2026: helper nova-locale e novaproxy

## Helper nova-locale v2: guarda do sleep, log limitado e Conectar que confere o reinício — 07/11/2026

**Contexto medido no aparelho (só leitura, 07/11):** o helper antigo rodou ~19 h (06/11 16:40 → 07/11 11:37, relógio do aparelho) com o PATH mínimo do launchd (`/usr/bin:/bin:/usr/sbin:/sbin`), onde **nenhum** comando do script existe (`sed head cp mv ln chown chmod grep rm cat date sleep killall sbreload` — todos ausentes; no PATH do Procursus todos resolvem em `/var/jb/usr/bin`). Resultado: laço sem pausa, ~118 erros/s, `nova-locale.err` com 571.321.165 B (~8 milhões de linhas `sleep: command not found`) e nenhum comando processado. O fix do PATH (7804b60) chegou ao aparelho no Conectar das 11:37:33 (script idêntico ao do app, daemon novo PID 93721, `launchctl print`: `runs = 2`, `last terminating signal = Killed: 9`) e o log parou de crescer. Ping do helper novo testado no aparelho às 12:06 (com OK do usuário): `action=ping` consumido em ~1,5 s, status e log atualizados, stderr sem escrita.

**O que mudou (branch `agent/ios/locale-endurecer-20261107`, empilhada em `agent/ios/idioma-novaproxy-conectar-20261106`):**
1. `nova-locale.sh` v2 (`HELPER_VERSION=2`):
   - `sleep 1 || { ...; exit 1; }` — se o PATH quebrar de novo o serviço **encerra**; o launchd só reinicia depois de 10 s (≈1 linha a cada 10 s em vez de ~118/s). No sandbox sem `sleep`: v1 = 2.144 linhas/s sem parar; v2 = sai em 14 ms com 2 linhas.
   - `trim_logs`: ao subir e a cada ~10 min, zera `nova-locale.err`, `.out` e `.log` que passarem de 1 MB (o arquivo continua existindo). Roda como root, então **o primeiro start da v2 também zera os 571 MB** sem comando manual.
   - O status ao subir (e no `ping`) passa a ser `pronto v2` (antes `pronto`).
2. `setup.js` (Conectar): depois do `bootstrap || kickstart -k`, lê (sem sudo) `/var/tmp/nova-locale-status.json` por até ~10 s e só diz "nova-locale vN atualizado" quando o status traz `pronto vN` (N vem da linha `HELPER_VERSION=` do script enviado). Se não aparecer: "arquivos enviados, mas o serviço não confirmou a versão vN. Rode o Conectar de novo." Antes o `|| true` engolia a falha e a frase "atualizado" saía sempre; um reinício que falhasse deixaria o processo velho vivo (o bash segue com o arquivo antigo aberto) sem aviso. `module.exports` ganhou `__test` (só para teste).
3. Gêmeo `MAC/controle-celular-plataformas/geo-proxy/helper/nova-locale.sh` mantido idêntico.

**Arquivos novos:** `conexao-usb/locale-helper.test.cjs` (estático + roda o script de verdade num sandbox com caminhos reescritos + handshake com cliente SSH falso) e `conexao-usb/aplicar-locale-v2.cjs` (aplica no app instalado: simulação por padrão, `--aplicar` grava com backup `.bak-locale-v2-<data-hora>`, desfaz sozinho se `node --check`/`bash -n` falhar, âncoras exatas — **não** copia o `setup.js` do repo, porque o do app tem trechos próprios como o `iproxy -u <udid>`).

**Testes (07/11):** `locale-helper.test.cjs` (4 blocos) OK; `setup.test.cjs`, `botao.test.cjs`, `botao-servico.test.cjs` OK; `node --check setup.js` e `bash -n nova-locale.sh` OK. Ensaio do deploy em **cópia** dos arquivos do app: 3 hunks, diff só com o handshake, idempotente, âncora ausente recusa sem alterar nada, suite de testes passa contra a cópia patchada.

**Como aplicar no app instalado (NÃO feito — exige OK do usuário):** `node MAC/integracao-iphone/conexao-usb/aplicar-locale-v2.cjs` (simulação) e depois `... --aplicar`; fechar e abrir o Nova; Conectar uma vez (senha do iPhone). Como o primeiro start da v2 faz `trim_logs`, o `nova-locale.err` de 571 MB é zerado aí.

**Ficou sem testar / limites:** o Conectar real com o handshake (precisa da senha do usuário); `apply`/`revert` no aparelho (mexem no fuso e fazem respring); o `trim_logs` no aparelho (só no sandbox do Mac). **Achados fora do escopo:** (a) `/var/tmp` tem sticky bit, então o `rm -f /var/tmp/nova-locale-status.json` que o app faz como `mobile` falha em silêncio e `iosWaitLocaleStatus` pode ler status velho; (b) `revert` não restaura o fuso: `/var/mobile/.nova-locale-state` (criado em 04/11 sob PATH mínimo) tem `tz=` vazio e `nova-globalprefs-original.plist` não existe; (c) o `setup.js` do repo segue sem o `iproxy -u <udid>` do app instalado.

## Seletor de modelo no app (IPCs spoofer:*) + novaproxy release no Conectar — 06/11/2026

Com o OK do usuário: (1) IPCs do seletor implementados no app instalado (`main.js`: `spoofer:get-ios-models/apply-ios-model/clear-ios-model/get-ios-model`; `physicalMobileService.js` ganhou `getIosModels/applyIOSModel/clearIOSModel/getIOSModel` + `require('./ios-modelo')`; `ios-modelo.js` e `iosModels.json` copiados para `electron/services/` — fonte: `MAC/integracao-iphone/`, mesma implementação das branches do seletor). Backups: `main.js.bak-*`, `physicalMobileService.js.bak-*`; `node --check` OK. (2) `novaproxy.deb` do app e de `conexao-usb/` trocado pelo release 0.1 (14666 bytes, sha256 969ff5c4…; debug em `.bak-debug-*`). Depois de reiniciar o Nova e Conectar (senha uma vez): novaproxy instalado, nova-locale re-aplicado (PATH) e o seletor de modelo funciona pelo app. Branch `agent/ios/idioma-novaproxy-conectar-20261106`, sem merge/push.

## novaproxy em versão release (sem +debug) — 06/11/2026

Gerado o build release do `novaproxy` (antes só existiam builds `+debug`).

- **Build:** `THEOS=$HOME/theos PATH=$HOME/theos/bin:$PATH make package FINALPACKAGE=1 DEBUG=0` em `MAC/proxy-iphone/tool/` (o Makefile fica lá). `make clean` antes para garantir objeto de release.
- **Pacote:** `MAC/proxy-iphone/tool/packages/com.aquiles.novaproxy_0.1_iphoneos-arm64.deb` — sem `+debug` no nome, `Version: 0.1` no control (o control declara `Version: 0.1`; os `0.1-2..0.1-9+debug` eram o contador de build do theos em modo debug).
- **rootless/arm64 confirmado:** `Architecture: iphoneos-arm64`, binário `Mach-O 64-bit arm64` (não-fat), caminhos instalados em `/var/jb/usr/bin/novaproxy` e `/var/jb/Library/LaunchDaemons/com.aquiles.novaproxy.plist`.
- **sha256:** `969ff5c4c485f5a8f6dcd8b405529bbfceb7b073c9b2eac6cc4c87431fd996b9`.

**O que o app espera (lido no app instalado):**
- Detecta instalado via `/var/jb/usr/bin/dpkg-query -W -f='${Version}' com.aquiles.novaproxy` (qualquer versão retornada = instalado; **não há versão mínima**).
- Instala com `sudo -S -p '' /var/jb/usr/bin/dpkg -i /var/mobile/novaproxy.deb` (senha do modal).
- Espera o arquivo **renomeado** como `novaproxy.deb` em `electron/services/iphone-setup/` (junto do `camera.deb`), não o nome com versão.
- Executa `/var/jb/usr/bin/novaproxy proxy set|clear|status|check` via SSH.

**Pendente (não feito — exige OK do usuário):** o app instalado e o `MAC/integracao-iphone/conexao-usb/novaproxy.deb` ainda contêm o debug `0.1-9+debug` (20834 bytes). Para fechar, copiar o `.deb` release para esses dois lugares com o nome `novaproxy.deb`. **Não copiei nada para o app.**

**Comando de instalação no iPhone (para o iOS Engineer, com OK do usuário):**
```
scp com.aquiles.novaproxy_0.1_iphoneos-arm64.deb mobile@127.0.0.1:/var/mobile/novaproxy.deb
sudo -S -p '' /var/jb/usr/bin/dpkg -i /var/mobile/novaproxy.deb
```

## Conectar: corrige idioma UNDEFINED e instala novaproxy — 06/11/2026

Sintomas no PHONE CONTROL: "IDIOMA UNDEFINED" e "Falha: O novaproxy ainda não está instalado".

1. **Idioma:** o `nova-locale.sh` girava em erro `sleep: command not found` (launchd roda com PATH mínimo). Fix: `export PATH=/var/jb/usr/bin:/var/jb/bin:/usr/bin:/bin:/usr/sbin:/sbin` no topo do script. O Conectar agora **re-envia e reinicia o helper em toda conexão** (não só quando ausente), então o próximo Conectar aplica o script corrigido no aparelho.
2. **novaproxy:** o binário `/var/jb/usr/bin/novaproxy` não existia no aparelho (o reset apagou e o fluxo não instalava). O Conectar agora instala `com.aquiles.novaproxy` (deb `0.1-9+debug`, único build existente) com a senha do modal, igual ao novamodel/nova-locale.

Arquivos: `conexao-usb/setup.js` (blocos novos), `nova-locale.sh` (PATH) no helper canônico e na cópia do app; `novaproxy.deb` junto do setup (gitignored). App instalado atualizado com backups. Branch `agent/ios/idioma-novaproxy-conectar-20261106`, sem merge/push.

