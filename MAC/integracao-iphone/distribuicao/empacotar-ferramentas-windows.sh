#!/usr/bin/env bash
set -euo pipefail
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
destino="${1:-$raiz/app/resources/ios-tools}"
prefixo="${MINGW_PREFIX:-/mingw64}"
ferramentas=(iproxy idevice_id ideviceinfo ideviceinstaller)
if [ "${NOVA_INSTALAR_PACOTES:-1}" = 1 ]; then
  pacman -S --needed --noconfirm mingw-w64-x86_64-libimobiledevice mingw-w64-x86_64-libusbmuxd mingw-w64-x86_64-ideviceinstaller
fi
mkdir -p "$destino/bin"
for nome in "${ferramentas[@]}"; do
  origem="$prefixo/bin/$nome.exe"
  [ -f "$origem" ] || { echo "Falta $origem" >&2; exit 1; }
  cp -f "$origem" "$destino/bin/"
  ldd "$origem" | awk '/=>/ {print $3}' | grep -iv '^/c/windows' | grep -v '^$' | while read -r dll; do
    cp -n "$dll" "$destino/bin/"
  done || true
done
( cd "$destino/bin" && sha256sum -- * > ../manifest.sha256 )
echo "$(ls "$destino/bin" | wc -l) arquivos em $destino/bin"
