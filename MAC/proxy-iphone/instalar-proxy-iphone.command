#!/bin/bash
# Instala o novaproxy no iPhone (uma vez). Pede a senha do sudo do aparelho no Terminal.
set -e

APP="/Applications/Nova AI Mac.app"
IPROXY="$APP/Contents/Resources/ios-tools/bin/iproxy"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
[ -d "$DIR/tool/packages" ] || DIR="/Users/aquilesneri/Desktop/Nova-AI/MAC/proxy-iphone"
DEB="$(ls -t "$DIR"/tool/packages/*.deb 2>/dev/null | head -1)"
echo "Pacote: $DEB"
SSH_OPTS=(-p 2222 -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=accept-new)

if [ -z "$DEB" ] || [ ! -f "$DEB" ]; then
    echo "Pacote .deb não encontrado em $DIR/tool/packages. Rode o build antes."
    exit 1
fi

if ! nc -z 127.0.0.1 2222 2>/dev/null; then
    echo "Subindo o túnel USB (iproxy 2222)..."
    "$IPROXY" 2222 22 >/tmp/iproxy-novaproxy.log 2>&1 &
    sleep 2
fi

if ! ssh "${SSH_OPTS[@]}" mobile@127.0.0.1 true 2>/dev/null; then
    echo "O iPhone não respondeu em 127.0.0.1:2222."
    echo "Confira o cabo, o jailbreak ativo e tente de novo."
    exit 1
fi

echo "Copiando o pacote para o iPhone..."
scp -P 2222 -o BatchMode=yes -q "$DEB" mobile@127.0.0.1:/var/mobile/novaproxy.deb

echo
echo "Instalando. Digite a senha do sudo do iPhone quando pedir."
echo
ssh -t -p 2222 mobile@127.0.0.1 "/var/jb/usr/bin/sudo /var/jb/usr/bin/dpkg -i /var/mobile/novaproxy.deb"

echo
echo "Conferindo a instalação..."
ssh "${SSH_OPTS[@]}" mobile@127.0.0.1 "sudo -n /var/jb/usr/bin/novaproxy proxy status"

echo
echo "Pronto. Agora, no Nova: Controle do Celular > iPhone > Identidade simulada,"
echo "cole o proxy e clique em Salvar."
