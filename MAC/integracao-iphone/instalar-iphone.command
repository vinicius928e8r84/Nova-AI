#!/bin/bash
set -euo pipefail
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
key="$HOME/.ssh/id_iphone"
options=(-p 2222 -i "$key" -o ConnectTimeout=8 -o StrictHostKeyChecking=yes)
scp_options=(-P 2222 -i "$key" -o ConnectTimeout=8 -o StrictHostKeyChecking=yes)
package="$here/bridge/packages/com.aquiles.obsgraph-bridge_0.1-30_iphoneos-arm64.deb"
phone=mobile@127.0.0.1
printf '\nAtualização Nova AI → Câmera do iPhone por USB\n'
printf 'Mantenha o iPhone conectado, desbloqueado e com jailbreak ativo.\n'
ssh "${options[@]}" "$phone" 'test -d /var/jb && test -f /var/tmp/obs-graph-bridge-status.json'
ssh "${options[@]}" "$phone" 'test -s /var/mobile/NovaAI-OBSGraphBridge-0.1-30.deb'
printf '\nDigite a senha do iPhone quando sudo pedir. Ela não será salva.\n'
ssh -tt "${options[@]}" "$phone" 'sudo /var/jb/bin/sh -c '\''set -eu
reserve=/var/mobile/NovaAI-reserva-$(date +%Y%m%d-%H%M%S)
mkdir -m 700 "$reserve"
cp -p /var/jb/Library/MobileSubstrate/DynamicLibraries/OBSGraphBridge.dylib "$reserve/"
cp -p /var/jb/Library/MobileSubstrate/DynamicLibraries/OBSGraphBridge.plist "$reserve/"
cp -p /var/tmp/obs-graph-bridge-control.json "$reserve/"
printf "%s\n" "{\"mode\":\"observe\"}" > /var/tmp/obs-graph-bridge-control.json
/var/jb/usr/bin/dpkg -i /var/mobile/NovaAI-OBSGraphBridge-0.1-30.deb
/var/jb/bin/launchctl kickstart -k system/com.apple.mediaserverd
printf "Reserva: %s\n" "$reserve"
'\'''
sleep 2
ssh "${options[@]}" "$phone" 'cat /var/tmp/obs-graph-bridge-status.json'
printf '\nConcluído. Feche e reabra o Nova AI no Mac.\n'
printf 'PHONE CONTROL → DEVICES: selecione o iPhone.\n'
printf 'CAM HIJACK: preparar câmera, selecionar MP4 e iniciar.\n'
printf 'Depois feche e reabra a Câmera no iPhone.\n'
read -r -p 'Pressione Enter para fechar.'
