#!/bin/sh
set -eu

uso='uso: montar-pacotes.sh <pasta-do-clone> <pasta-de-saida>'
clone=${1:?$uso}
saida=${2:?$uso}

THEOS=${THEOS:-$HOME/theos-nova}
export THEOS
PATH=$THEOS/bin:$PATH
export PATH
THEOS_PLATFORM_DEB_COMPRESSION_TYPE=gzip
FINALPACKAGE=1
export THEOS_PLATFORM_DEB_COMPRESSION_TYPE FINALPACKAGE

[ -d "$THEOS/sdks/iPhoneOS16.5.sdk" ] || { echo "falta o SDK do iOS 16.5 em $THEOS/sdks" >&2; exit 2; }
[ -x "$THEOS/bin/ldid" ] || { echo "falta o ldid em $THEOS/bin" >&2; exit 2; }
[ -d "$clone/iphone" ] || { echo "$clone não é um clone do Nova-AI" >&2; exit 2; }

mkdir -p "$saida"
commit=$(git -C "$clone" rev-parse HEAD)
sujo=$(git -C "$clone" status --porcelain --untracked-files=no | wc -l | tr -d ' ')
echo "commit $commit, arquivos modificados: $sujo" | tee "$saida/commit.txt"

for item in proxy:iphone/proxy/tool idioma:iphone/idioma/novalanguage modelo:iphone/modelo camera:iphone/camera; do
  nome=${item%%:*}
  pasta=$clone/${item#*:}
  rm -rf "$pasta/.theos" "$pasta/packages"
  (cd "$pasta" && make package) >"$saida/$nome.log" 2>&1 || { echo "falhou: $nome (veja $saida/$nome.log)" >&2; exit 1; }
  cp "$pasta"/packages/*.deb "$saida/$nome.deb"
  echo "montado: $nome.deb"
done
