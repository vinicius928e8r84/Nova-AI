# O retrato do pacote do iPhone

O **retrato do pacote** é a costura de teste da fase do iPhone (decisões 5 e 7 da issue 134, ticket 207). O agente monta os quatro pacotes (proxy, idioma, modelo e câmera) no Mac de prova, tira o retrato de cada `.deb` e compara com o retrato do corte seguinte. O dono só instala no iPhone.

O retrato guarda:

- o `control` do pacote, campo a campo;
- cada arquivo do `.deb` (e os scripts `DEBIAN/`): tipo, modo, dono, grupo, tamanho e `sha256` (o alvo, se for link). A data dos arquivos não entra;
- de cada binário Mach-O: os símbolos importados e exportados, as bibliotecas ligadas, os textos (`__TEXT,__cstring`), os seletores (`__TEXT,__objc_methname`), os direitos da assinatura e o `sha256` do código (`__TEXT,__text`).

Do binário em si o retrato guarda só o tamanho: o `sha256` do arquivo inteiro muda a cada montagem, porque o `ld` grava no binário um UUID novo (medido: o mesmo commit, montado duas vezes, dá `.deb` e binários com bytes diferentes e o mesmo retrato).

## Os comandos

```bash
node iphone/retrato/retrato-do-pacote.js tirar proxy.deb proxy.json
node iphone/retrato/retrato-do-pacote.js comparar antes.json depois.json --ignorar versao,bytes
```

`comparar` imprime uma linha por diferença e a contagem. Sai com 0 quando os retratos são iguais, 1 quando há diferença e 2 quando o uso está errado.

- `--ignorar versao`: não conta o campo `Version` do controle, que sobe em todo corte.
- `--ignorar bytes`: não conta o tamanho dos binários, o `sha256` do código nem o `Installed-Size`. O código de máquina muda em qualquer corte, então o retrato de um corte puro compara as partes.

Exemplo de linhas: `binário var/jb/usr/bin/novaproxy: texto acrescentado: "novo texto"`, `binário ...: seletor removido: "init"`, `arquivo acrescentado: var/jb/usr/share/x`, `controle Version: mudou de "0.2" para "0.3"`.

O comando só precisa do `node`; não lê nada do Mac. O Mac de prova não tem `node`: copie os `.deb` para a máquina do agente (`scp`) e tire o retrato lá.

Os testes (`node --test iphone/retrato/test/*.test.js`) montam `.deb` e Mach-O de mentira e rodam em qualquer máquina. Eles estão no portão dos testes, no grupo `mac-que-roda-sem-mac`.

## Montar os pacotes no Mac de prova

O Mac de prova é o MacBook do dono. Antes de cada uso, pegue o lock: `lockf -t 600 /tmp/fm-mac.lock <comando>`. Não use `sudo`, `brew`, o Xcode, os apps, o Chrome nem o Anki do dono, e não instale nada no iPhone.

### 1. O Theos e o SDK do iOS 16.5 (uma vez)

Já estão em `~/theos-nova` no Mac de prova, instalados para o ticket 207; o arquivo `~/theos-nova.instalado.txt` lista cada coisa que entrou e como desfazer. Só refaça se a pasta sumir:

```bash
git clone --depth 1 --recursive --shallow-submodules https://github.com/theos/theos.git ~/theos-nova
git clone --depth 1 --filter=blob:none --sparse https://github.com/theos/sdks.git /tmp/nova-sdks
git -C /tmp/nova-sdks sparse-checkout set iPhoneOS16.5.sdk
mv /tmp/nova-sdks/iPhoneOS16.5.sdk ~/theos-nova/sdks/ && rm -rf /tmp/nova-sdks
mkdir -p ~/theos-nova/bin
curl -sL -o ~/theos-nova/bin/ldid https://github.com/ProcursusTeam/ldid/releases/download/v2.1.5-procursus8/ldid_macosx_arm64
chmod +x ~/theos-nova/bin/ldid
```

Versões usadas: Theos no commit `8167f59de02fd32cf45b16bfcb1330dfa5c9974c`, SDK no commit `0222fd5413cf4b9af096f37b4621afa2688572f7` do repositório `theos/sdks`, `ldid` v2.1.5-procursus8. O Mac já tem `clang` (Command Line Tools); o Theos o usa sem o Xcode.

### 2. Os quatro pacotes, a partir da `main`

Use um clone novo a cada montagem, para que nenhum resto de `.theos/` ou de `packages/` entre na conta:

```bash
rm -rf /tmp/nova-clone /tmp/nova-pacotes
git clone https://github.com/vinicius928e8r84/Nova-AI.git /tmp/nova-clone
git -C /tmp/nova-clone checkout <commit>
sh /tmp/nova-clone/iphone/retrato/montar-pacotes.sh /tmp/nova-clone /tmp/nova-pacotes
```

`montar-pacotes.sh` roda `make package` com `THEOS=~/theos-nova`, `FINALPACKAGE=1` (binário sem símbolos de depuração e versão sem `+debug`) e `THEOS_PLATFORM_DEB_COMPRESSION_TYPE=gzip` (o Mac não tem o `lzma` que o Theos usa por padrão). Deixa em `/tmp/nova-pacotes`: `proxy.deb`, `idioma.deb`, `modelo.deb`, `camera.deb`, o log de cada um e `commit.txt` com o commit e o número de arquivos modificados. O aviso `ld: warning: -multiply_defined is obsolete` é do Theos e não importa.

Os `.deb` não entram no git (`sem-binario-nem-lixo`). Para trazer: `ssh <mac> 'tar -C /tmp/nova-pacotes -cf - proxy.deb idioma.deb modelo.deb camera.deb' | tar -xf - -C <pasta>`.

Para montar um corte, faça o mesmo com o commit do corte em outra pasta de saída (`/tmp/nova-pacotes-depois`), de preferência no mesmo caminho de clone.

### 3. O retrato antes e depois de um corte

```bash
for n in proxy idioma modelo camera; do
  node iphone/retrato/retrato-do-pacote.js tirar antes/$n.deb antes/$n.json
  node iphone/retrato/retrato-do-pacote.js tirar depois/$n.deb depois/$n.json
  node iphone/retrato/retrato-do-pacote.js comparar antes/$n.json depois/$n.json --ignorar versao,bytes
done
```

Um corte que só move código deve sair com 0. Qualquer linha que aparecer é uma mudança que o corte fez de verdade (texto, seletor, símbolo, biblioteca, direitos, arquivo ou controle), e o revisor lê cada uma.

### 4. Conferir que o retrato morde

Para ver uma mudança de propósito aparecer sem commitar nada, altere um texto e um seletor num clone novo de `/tmp`, monte e compare com o retrato do mesmo commit sem alteração:

```bash
rm -rf /tmp/nova-clone && git clone https://github.com/vinicius928e8r84/Nova-AI.git /tmp/nova-clone
git -C /tmp/nova-clone checkout <commit>
sed -i "" 's/aguardando configuração\.\.\./aguardando a configuração.../' /tmp/nova-clone/iphone/proxy/tool/main.m
sed -i "" 's/return \[ok containsObject:s\];/return [ok member:s] != nil;/' /tmp/nova-clone/iphone/proxy/tool/ProxyConfig.m
sh /tmp/nova-clone/iphone/retrato/montar-pacotes.sh /tmp/nova-clone /tmp/nova-pacotes-alterado
```

Traga os `.deb` de `/tmp/nova-pacotes-alterado` como no passo 2, tire o retrato de cada um e compare com o do mesmo commit sem alteração, como no passo 3, com `--ignorar bytes`. A comparação do `proxy` mostra `texto acrescentado`, `texto removido`, `seletor acrescentado: "member:"` e `seletor removido: "containsObject:"`; os outros três pacotes saem iguais. Apague o clone depois: a alteração nunca entra no repositório. Montar o mesmo commit duas vezes, cada uma num clone novo, dá retratos iguais nos quatro pacotes (os `.deb` têm bytes diferentes por causa da data dos arquivos e do UUID).

## O que o retrato não vê

- Uma mudança só no código de máquina que não toca símbolo, texto nem seletor (um número, a ordem de duas contas). Sem `--ignorar bytes`, o `sha256` do código a mostra, mas todo corte a mostra também; por isso o corte puro usa `--ignorar bytes`, e esse caso fica para o teste no Mac e para a prova real.
- O que roda dentro do iOS (ganchos no `mediaserverd`, MobileGestalt, `cfprefsd`, Wi-Fi): só a prova real cobre.
- Mach-O com várias arquiteturas (fat): o comando recusa. O Theos monta `arm64`, que é Mach-O de uma arquitetura só.
- Pacote com compressão que não seja `gzip`, `xz`, `lzma` ou `zstd` (os três últimos pedem o programa `xz` ou `zstd` na máquina).

## Conferência do leitor contra as ferramentas do Mac

O leitor de Mach-O do retrato foi comparado, em binários montados pelo Theos, com as ferramentas que a pesquisa da ponte (issue 190) usou. Para refazer a conferência no Mac, sobre o binário que o Theos deixa em `.theos/_/`:

```bash
nm -u binario | sort
nm -gU binario | awk '{print $3}' | sort
otool -L binario | tail -n +2 | awk '{print $1}' | sort
otool -v -s __TEXT __cstring binario | tail -n +3
otool -v -s __TEXT __objc_methname binario | tail -n +3
~/theos-nova/bin/ldid -e binario
```

Resultado em 27/11/2026 sobre `novaproxy`, `OBSGraphBridge.dylib` e `NovaModel.dylib`: os símbolos importados, os exportados, as bibliotecas (sem a linha do próprio `dylib`, que o `otool` mostra e o retrato não guarda), os seletores e os direitos saíram iguais. Os textos saíram iguais nos de texto ASCII; o `otool` mostra os bytes não ASCII em octal e o retrato mostra o texto, então as 23 mensagens com acento do `novaproxy` só podem ser comparadas à mão.
