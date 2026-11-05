#!/bin/bash
# Instala (ou reinstala) o CAM LIVE no Nova AI Mac. Seguro de rodar mais de uma vez.
# Uso: ./instalar-camlive.command            instala
#      ./instalar-camlive.command --remover  volta ao original (usa a reserva)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="${NOVA_APP:-/Applications/Nova AI Mac.app/Contents/Resources/app}"
RES="$DIR/reservas"
MAIN="$APP/electron/main.js"
HTML="$APP/dist/index.html"

if [ "$1" = "--remover" ]; then
  [ -f "$RES/main.js.original" ] && cp "$RES/main.js.original" "$MAIN"
  [ -f "$RES/index.html.original" ] && cp "$RES/index.html.original" "$HTML"
  rm -f "$APP/electron/services/cam-live-service.js" "$APP/dist/cam-live.js" "$APP/dist/cam-live-audio.js"
  echo "CAM LIVE removido. Reinicie o Nova."; exit 0
fi

mkdir -p "$RES"
[ -f "$RES/main.js.original" ] || cp "$MAIN" "$RES/main.js.original"
[ -f "$RES/index.html.original" ] || cp "$HTML" "$RES/index.html.original"

cp "$DIR/cam-live-service.js" "$APP/electron/services/cam-live-service.js"
cp "$DIR/cam-live-audio.js" "$APP/dist/cam-live-audio.js"
cp "$DIR/cam-live.js" "$APP/dist/cam-live.js"

python3 - "$MAIN" "$HTML" <<'PY'
import sys
main, html = sys.argv[1], sys.argv[2]
s = open(main, encoding='utf8').read()
if 'CAMLIVE:begin' not in s:
    anchor = "  ipcMain.on('rtmp:video-chunk', (event, buffer) => {\n    RtmpServerService.receiveVideoChunk(buffer);\n  });\n"
    assert anchor in s, 'ponto de inserção não encontrado em main.js'
    block = anchor + "\n  // CAMLIVE:begin\n  try { require('./services/cam-live-service').register({ ipcMain, getWindow: () => mainWindow, userDataDir: app.getPath('userData') }); } catch (e) { console.error('[CamLive] falhou ao registrar:', e); }\n  // CAMLIVE:end\n"
    s = s.replace(anchor, block, 1)
    open(main, 'w', encoding='utf8').write(s)
h = open(html, encoding='utf8').read()
if 'cam-live-audio.js' not in h:
    h = h.replace('  <script src="./cam-live.js" defer></script>\n', '')
    tag = '  <script src="./cam-live-audio.js" defer></script>\n  <script src="./cam-live.js" defer></script>\n'
    assert '</head>' in h
    h = h.replace('</head>', tag + '</head>', 1)
    open(html, 'w', encoding='utf8').write(h)
PY
node -e "require('$APP/electron/services/cam-live-service.js')" && echo "serviço ok"
node --check "$MAIN" && echo "main.js ok"
echo "CAM LIVE instalado. Feche e abra o Nova para carregar."
