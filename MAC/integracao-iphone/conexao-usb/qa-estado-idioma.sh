#!/bin/bash
# QA — estado das 3 camadas do idioma/identidade (somente leitura).
# Uso: ./qa-estado-idioma.sh            → imprime o estado atual
#      ./qa-estado-idioma.sh > antes.txt   (rodar antes e depois do deploy e comparar)
# Não escreve nada no aparelho, no app nem no repo. Não imprime credenciais.

K="$HOME/Library/Application Support/nova_dsktp/iphone-ssh/id_iphone"
APP="/Applications/Nova AI Mac.app/Contents/Resources/app"
S() { ssh -i "$K" -p 2222 -o BatchMode=yes -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=10 \
        mobile@127.0.0.1 "$1" 2>/dev/null; }

echo "== QA estado =================================================="
echo "medido em: $(date '+%d/%m/%Y %H:%M:%S %Z')  (Mac)"

echo
echo "-- 1. camada TELA (app do Mac) --------------------------------"
B="$APP/dist/assets/index-Dun7lr2S.js"
if [ -f "$B" ]; then
  echo "bundle: $(stat -f '%Sm' -t '%d/%m %H:%M' "$B") $(stat -f %z "$B") B  sha=$(shasum -a 256 "$B" | cut -c1-8)"
  for t in "Registrar modelo" "Restaurar celular" "Salvar identidade do iPhone" "Aplicar modelo" "nome do perfil"; do
    printf '  %-30s %s\n' "$t" "$(grep -ac "$t" "$B" 2>/dev/null | head -1)"
  done
else
  echo "bundle NAO encontrado em $B"
fi
echo "html aponta: $(grep -o 'index-[A-Za-z0-9_-]*\.js' "$APP/dist/index.html" 2>/dev/null | head -1)"

echo
echo "-- 2. camada LIGACAO (main.js do app) -------------------------"
M="$APP/electron/main.js"
if [ -f "$M" ]; then
  echo "main.js: $(stat -f '%Sm' -t '%d/%m %H:%M' "$M") $(stat -f %z "$M") B  sha=$(shasum -a 256 "$M" | cut -c1-8)"
  for h in spoofer:get-language spoofer:apply-language spoofer:revert-language spoofer:salvar-tudo spoofer:registrar-modelo idioma-ipc; do
    printf '  %-28s %s\n' "$h" "$(grep -ac "$h" "$M" 2>/dev/null | head -1)"
  done
else
  echo "main.js NAO encontrado"
fi
echo "Nova rodando: $(pgrep -f 'MacOS/Nova AI Mac' | wc -l | tr -d ' ') processo(s)"

echo
echo "-- 3. camada APARELHO ----------------------------------------"
S 'echo "hora aparelho: $(date "+%H:%M:%S %Z")  |  fuso: $(readlink /var/db/timezone/localtime | sed "s#.*/zoneinfo/##")"
echo "idioma global: $(grep -aoE "pt-BR|en-US" /var/mobile/Library/Preferences/.GlobalPreferences.plist | head -1)  (tamanho $(stat -c %s /var/mobile/Library/Preferences/.GlobalPreferences.plist) B, mtime $(stat -c %y /var/mobile/Library/Preferences/.GlobalPreferences.plist | cut -c1-16))"
echo "SpringBoard: $(ps ax -o pid,etime,comm | grep -i SpringBoard | grep -v grep | head -1 | cut -d/ -f1)"
n=0; for f in /var/mobile/Library/Preferences/*.plist; do grep -qa AppleLanguages "$f" 2>/dev/null && n=$((n+1)); done; echo "A8 overrides por app: $n de $(ls /var/mobile/Library/Preferences/*.plist | wc -l | tr -d " ")"
echo "novalanguage instalado: $(ls -d /var/jb/Library/dpkg/info/com.aquiles.novalanguage* 2>/dev/null | head -1 || echo NAO)"
echo "binario novalanguage: $(ls -l /var/jb/usr/bin/novalanguage 2>/dev/null | awk '{print $5" B " $6" "$7}' | sed 's/^$/AUSENTE/')"
echo "helper versao: $(grep -m1 -o "HELPER_VERSION=[0-9]*" /var/jb/usr/libexec/nova-locale.sh 2>/dev/null || echo "sem marcador")"
echo "helper lingua: $(grep -ac "language)" /var/jb/usr/libexec/nova-locale.sh 2>/dev/null) ocorrencia(s) de comando language"
echo "helper log: $(tail -1 /var/tmp/nova-locale.log 2>/dev/null)"
echo "helper err: $(stat -c %s /var/tmp/nova-locale.err 2>/dev/null || echo "?") B"
echo "daemons: nova-locale=$(ps ax | grep -c "[n]ova-locale.sh") novaproxy=$(ps ax | grep -c "[n]ovaproxy")"
echo "proxy: $(/var/jb/usr/bin/novaproxy proxy status 2>/dev/null | cut -c1-60)"
echo "CAM LIVE socket: $(ls /var/tmp/.nbi-*.sock 2>/dev/null | wc -l | tr -d " ") socket(s)"'

echo
echo "-- 4. tuneis no Mac ------------------------------------------"
echo "iproxy 2222: $(pgrep -f 'iproxy.*2222:22' | wc -l | tr -d ' ')  |  iproxy 5900: $(pgrep -f 'iproxy 5900' | wc -l | tr -d ' ')"
echo "=============================================================="
