#!/usr/bin/env bash
set -euo pipefail
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
destino="${1:-$raiz/app/resources/ios-tools}"
prefixo="${MINGW_PREFIX:-/ucrt64}"
pacotes="${MINGW_PACKAGE_PREFIX:-mingw-w64-ucrt-x86_64}"
ferramentas=(iproxy idevice_id ideviceinfo ideviceinstaller)
if [ "${NOVA_INSTALAR_PACOTES:-1}" = 1 ]; then
  pacman -S --needed --noconfirm "$pacotes-libimobiledevice" "$pacotes-libusbmuxd" "$pacotes-ideviceinstaller"
fi
rm -rf "$destino/bin"
mkdir -p "$destino/bin"
for nome in "${ferramentas[@]}"; do
  origem="$prefixo/bin/$nome.exe"
  [ -f "$origem" ] || { echo "Falta $origem" >&2; exit 1; }
  cp -f "$origem" "$destino/bin/"
  saida="$(ldd "$origem")"
  dlls="$(sed -n 's/.*=> \(.*\) (0x[0-9a-fA-F]*)$/\1/p' <<< "$saida" | grep -iv '^/c/windows' || true)"
  while IFS= read -r dll; do
    [ -n "$dll" ] || continue
    cp -n "$dll" "$destino/bin/"
  done <<< "$dlls"
done
( cd "$destino/bin" && sha256sum -- * > ../manifest.sha256 )
echo "$(ls "$destino/bin" | wc -l) arquivos em $destino/bin"
