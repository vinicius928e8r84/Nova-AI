# A prova real de cada corte

Parte da pesquisa [O corte do `global-spoof-service.js`](README.md).

### O roteiro da prova no Chrome de verdade (sem aparelho)

Rodei este roteiro no código de hoje, no Windows desta máquina, com Chrome 157.0.8103.80 e ffmpeg 8.1. O script fica fora do repositório (`harness/prova-atual.js`); a versão do lote vai junto do palco.

1. Gerar um clipe WebM de 0,5 s com o ffmpeg (`testsrc`). Instanciar o serviço com um `app` cujo `userData` é uma pasta temporária, um `mainWindow` que anota e `browserFarmService = null`.
2. `detectDriver` → `{ mode: 'chrome-y4m', vcamExePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }`.
3. `startHijack` com o perfil `Default` e sem `regional` → **lança** `Cannot read properties of undefined (reading 'includes')`.
4. Gravar um `profile_01` (Windows, `America/Sao_Paulo`, `pt-BR`, local personalizado) e chamar `startHijack` com o `regional` que a interface manda.
   - O resultado foi `success: true` em cerca de 1,7 s.
   - Saíram 23 argumentos do Chrome, a extensão e `--remote-debugging-port`.
   - O Y4M saiu com 1080×1920 a 29,97 quadros por segundo e **112 MB para 0,5 s** de clipe.
   - O `inject.js` saiu com 22.874 a 22.890 bytes, conforme os valores sorteados.
5. Pelo CDP, na página `http://127.0.0.1:<porta>/`, primeiro conferir se o script chegou (`window.__nova_stealth_applied`). Depois recarregar, conferir de novo e ler:

   | Item | Valor lido |
   |---|---|
   | `navigator.platform` | `Win32` |
   | núcleos e memória | 8 e 8 |
   | idiomas | `pt-BR, pt, en-US, en` |
   | fuso | `America/Sao_Paulo` |
   | deslocamento | 180 |
   | GPU | `Google Inc. (NVIDIA)` / `Intel(R) Iris(R) Xe Graphics` |
   | `enumerateDevices` | `videoinput:USB Camera` |
   | trilha do `getUserMedia` | rótulo `FaceTime HD Camera`, 1920×1080, `facingMode` `user` |

   Depois, para cada uma das 25 funções que o script troca, ler o nome, a aridade e o começo do `toString`.
6. `stopHijack` → `success: true`. O Y4M foi apagado e o status saiu com `isActive: false`. O Chrome **ainda estava vivo 6 s depois** em 2 de 4 execuções (esperando 2,5 s ou 6 s) e saiu sozinho segundos depois. A prova precisa esperar a saída do processo, e não um tempo fixo.

Este roteiro roda sem aparelho e sem o app. Ele prova o serviço com o Chrome real, mas não prova a interface nem o caminho do IPC, que ficam para o app (abaixo).

### Por corte

| Corte | Teste de hoje que cobre | Caracterização que falta | Prova real sem aparelho (agente) | Prova que pede o dono |
|---|---|---|---|---|
| 1. o texto da página | nenhum | as cenas de perfil, identidade e mídia do palco, com o sha256 do `inject.js` e do texto mandado ao CDP | o palco igual antes e depois. No Chrome real, o mesmo sha256 do `inject.js` com o sorteio fixo, e a tabela de leituras do passo 5 igual | no Mac, no app instalado: abrir o CAM spoof com um perfil `profile_NN`, ver a câmera falsa num site de teste de webcam e o fuso do perfil |
| 2. o perfil | nenhum | as cenas de perfil (nome livre, `profile_NN` com campos faltando, temporário de três plataformas, `Default`), com o `farm_profiles.json` inteiro no diário e o sorteio fixo | o palco igual. No Chrome real, criar um perfil de nome livre pelo `startHijack` e conferir o `farm_profiles.json` e a leitura na página | no app: o seletor de perfis do CAM spoof lista os mesmos perfis (`listProfiles`), e criar um perfil de nome livre aparece no farm |
| 3. a identidade | nenhum | as cenas de "ótimo" com o farm de mentira, local personalizado, fuso inválido e os seis formatos de proxy; no diário, os argumentos `--proxy-server` e `--window-size` e os envios `setTimezoneOverride`, `setGeolocationOverride` e `setUserAgentOverride` | o palco igual. No Chrome real, dois perfis (Windows e Android, que é emulado), com a tabela do passo 5 igual antes e depois | no app, um perfil com proxy autenticado: a página abre pelo proxy (pede um proxy do dono) |
| 4. o Chrome | `chromium-revisao-windows.test.js` (3) e `tool-paths.test.cjs` (texto) | as cenas de `_findChrome` (quatro navegadores, com e sem farm, Windows e Mac), da limpeza (`pkill` no Mac; `wmic` que falha e depois PowerShell no Windows), do áudio nos dois sistemas e do ffmpeg que falha | o palco igual. No Chrome real, o roteiro inteiro, conferindo os 23 argumentos e o cabeçalho do Y4M iguais, e o Chrome morrendo no `stopHijack` | **no Mac**: abrir e fechar o CAM spoof duas vezes, ver o `pkill` matar o Chrome órfão e não um Chrome pessoal aberto (o ramo `darwin` só roda lá); o áudio de ambiente com e sem arquivo escolhido |
| 5. o CDP | nenhum | as cenas do CDP (alvos `page`, `iframe` e outros, `waitingForDebugger`, proxy com senha, `send` que falha, `disconnect`, vigia do e-mail com o farm e direto no arquivo) | o palco igual. No Chrome real, a tabela do passo 5 depois de recarregar, a vigia do e-mail numa página local com `data-email` (grava no `farm_profiles.json` em até 5 s) e o fechamento do Chrome parando o serviço | no app: logar numa conta Google no Chrome do spoof e ver o e-mail aparecer no cartão do perfil do farm (`farm:profile-update`) |
| 6. o script como código | nenhum | a tabela das 25 funções trocadas na página (nome, aridade, mascaramento de `toString`) e as leituras do passo 5, gravadas no código de hoje e conferidas no Chrome real | no Chrome real, as leituras iguais. O nome, a aridade e o mascaramento iguais para as 25 funções; só o texto-fonte muda, como o dono aceitou. Também os valores de ruído do canvas, do WebGL e do áudio com semente fixa | no Mac, no app: um site de detecção de impressão digital mostra os mesmos valores antes e depois |

O que pede o dono é o Mac com o app instalado (`/Applications/Nova AI Mac.app`), a conta Google e um proxy. **Nenhum corte pede iPhone nem Android**: os perfis de celular são só o Chrome emulando um celular. As máquinas Windows da frota também servem para o agente repetir o roteiro.
