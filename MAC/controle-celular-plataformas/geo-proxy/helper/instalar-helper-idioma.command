#!/bin/bash
# Instala (uma vez) o helper root que troca fuso horário e idioma do iPhone.
# Precisa do iPhone conectado por USB, desbloqueado, com jailbreak ativo e do
# Nova aberto (o túnel USB na porta 2222 é do Nova).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
key="$HOME/.ssh/id_iphone"
opts=(-p 2222 -i "$key" -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)
phone=mobile@127.0.0.1

printf '\nNova AI — helper de fuso e idioma do iPhone\n\n'

if ! ssh "${opts[@]}" -o BatchMode=yes "$phone" 'test -d /var/jb' 2>/dev/null; then
    printf 'iPhone não acessível na porta 2222.\n'
    printf 'Abra o Nova, conecte o iPhone por USB e deixe-o desbloqueado.\n'
    exit 1
fi

printf 'Copiando arquivos...\n'
scp -q -P 2222 -i "$key" -o StrictHostKeyChecking=accept-new \
    "$here/nova-locale.sh" \
    "$here/com.aquiles.novalocale.plist" \
    "$here/instalar-root.sh" \
    "$phone:/var/tmp/"

printf '\nDigite a senha do iPhone quando o sudo pedir (ela não é salva).\n\n'
ssh -tt "${opts[@]}" "$phone" 'sudo /var/jb/bin/sh /var/tmp/instalar-root.sh'

printf '\nPronto. Volte ao Nova e clique em Salvar a proxy: o idioma e o fuso\n'
printf 'passam a ser aplicados sozinhos. Em "Parar" eles são restaurados.\n\n'
read -r -p 'Pressione Enter para fechar.'
