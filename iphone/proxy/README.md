# Proxy no iPhone (SOCKS5 com login) — Nova AI

O campo **Proxy** da tela Identidade simulada (iPhone) aplica o proxy no aparelho.
O iOS não aceita SOCKS5 direto no ajuste do sistema, então o pacote instala um
utilitário que faz a ponte:

```
app do iPhone  ──HTTP/CONNECT──▶  127.0.0.1:8899 (novaproxy)  ──SOCKS5+auth──▶  proxy
                                   no próprio iPhone                             (Evomi etc.)
```

O ajuste de Wi‑Fi do iOS aponta para `127.0.0.1:8899`; o `novaproxy` fala SOCKS5
com o seu proxy (inclusive usuário/senha e DNS resolvido no proxy).

## O que foi instalado

| Peça | Onde |
|---|---|
| binário `novaproxy` | `/var/jb/usr/bin/novaproxy` |
| daemon (launchd) | `/var/jb/Library/LaunchDaemons/com.aquiles.novaproxy.plist` |
| configuração do proxy | `/var/jb/var/mobile/Library/Preferences/com.aquiles.novaproxy.json` (root, 600) |
| log | `/var/jb/var/log/novaproxy.log` |
| setuid root (o app chama como `mobile`) | `/var/jb/usr/bin/novaproxy` (mode 4755) |

O app chama por SSH (túnel USB): `/var/jb/usr/bin/novaproxy proxy set …`.

## Instalação (uma vez)

1. iPhone conectado por cabo, jailbreak ativo, Wi‑Fi ligado numa rede.
2. Dê dois cliques em `instalar-proxy-iphone.command`.
3. Digite a senha do **sudo do iPhone** quando o Terminal pedir.
4. No fim ele mostra o status (`off local=8899 … wifi=on`).

## Uso

No Nova: **Controle do Celular → iPhone → Identidade simulada**:

1. Cole o proxy no formato do provedor, por exemplo:
   `socks5://host:porta:usuario:senha`
2. **Salvar** → aplica no iPhone e mostra “Proxy aplicado no iPhone”.
3. **Remover identidade salva** limpa o proxy do aparelho.

Verificação:

```sh
ssh -p 2222 -i ~/.ssh/id_iphone mobile@127.0.0.1 \
  '/var/jb/usr/bin/novaproxy proxy status'
# off local=8899 upstream=host:porta daemon=running wifi=on

ssh -p 2222 -i ~/.ssh/id_iphone mobile@127.0.0.1 \
  '/var/jb/usr/bin/novaproxy proxy check system'
# mostra o IP de saída usando o proxy do sistema (prova real no aparelho)
```

## Limites (importantes)

- Aplicado no serviço Wi‑Fi, mas o efeito é do sistema: no teste no aparelho o IP de
  saída mudou mesmo com o Wi‑Fi desligado (NSURLSession/CFNetwork). Apps que usam a
  pilha do sistema seguem o proxy; apps com sockets próprios ou QUIC/UDP podem escapar.
- HTTPS normal passa por CONNECT, sem MITM — pinning não atrapalha.
- Se o daemon morrer, o aparelho fica sem internet até limpar (o launchd reinicia
  sozinho; o botão Remover também limpa).
- As credenciais ficam em texto no JSON do iPhone (root) e no `localStorage` do Nova.
- Se o proxy cair, o iPhone fica sem internet no Wi‑Fi até **Remover** (ou
  `novaproxy proxy clear`).

## Remover tudo

```sh
ssh -t -p 2222 mobile@127.0.0.1 "sudo /var/jb/usr/bin/dpkg -r com.aquiles.novaproxy"
```

O `prerm` limpa o proxy do Wi‑Fi e descarrega o daemon.

## Rebuild

```sh
cd tool && THEOS=~/theos make package
```

O instalador sempre pega o `.deb` mais novo em `tool/packages/`.
