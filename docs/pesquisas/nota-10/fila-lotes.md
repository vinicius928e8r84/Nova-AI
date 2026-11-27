# A fila, lote a lote

Parte de [A fila dos lotes até a nota 10](fila.md). As notas são da análise 163 do painel, sobre a `main` em `2eb4212`. Todo item é de atenção ALTA, menos os marcados BAIXA.

- **M** = `app/electron/main.js` (nota 2,44, hotspot), cortes da [#127](https://github.com/vinicius928e8r84/Nova-AI/issues/127).
- **P** = `app/electron/services/physicalMobileService.js` (3,13, hotspot), cortes da [#130](https://github.com/vinicius928e8r84/Nova-AI/issues/130).
- **G** = `app/electron/services/global-spoof-service.js` (3,15, hotspot), cortes da [#128](https://github.com/vinicius928e8r84/Nova-AI/issues/128).
- **F** = `app/electron/services/browserFarmService.js` (2,64), cortes da [#129](https://github.com/vinicius928e8r84/Nova-AI/issues/129).
- Os pequenos ficam em `app/electron/services/`, salvo quando o caminho diz outra coisa.

## Fase 1: produto

O `main.js` anda nos lotes 1 a 11, um corte por lote. Cada lote leva com ele um segundo corte grande e dois pequenos. O farm vem um lote antes do spoof onde os dois se tocam (o `farm-perfil.js` do F1 antes do G2, o `farm-scripts-da-pagina.js` do F2 antes do G5), como a #128 prefere. Os cortes P1 a P5 caem junto do M4 ao M9, porque o corte do celular no `main.js` (M9) e os do serviço pedem os mesmos aparelhos.

| Lote | Grandes | Pequenos (nota) | Prova do dono | Provas pendentes que se pagam |
| --- | --- | --- | --- | --- |
| 1 | M1 a fundação e o sistema · G1 o texto da página | `cam-live-iphone.js` (4,43, hotspot), `ios-camera.js` (7,89, hotspot) | iPhone com jailbreak no Mac; CAM spoof no app do Mac | #60, #99, #97 (parte do iPhone), #90 |
| 2 | M2 a configuração e o atualizador · F1 o perfil | `whatsapp-manager.js` (5,62, hotspot), `nova-shutdown.js` (8,03, hotspot) | certificado Apple; WhatsApp e e-mail de teste; aparelhos ligados ao sair | #93, #81, #75 |
| 3 | M3 os dados · G2 o perfil | `cam-live-service.js` (4,72), `agent-swarm-controller.js` (5,58) | CAM spoof e CAM LIVE no app do Mac | nenhuma |
| 4 | M4 os arquivos · P1 caminhos, adb e conexão | `idioma-ipc.js` (6,71), `child-worker-agent.js` (7,61) | Android por USB e por Wi-Fi, no Mac e no Windows; senha do Mac e `.msi` | #89, #94, #92 |
| 5 | M5 a mensageria · P2 o iPhone pelo SSH | `iphone-setup/setup.js` (6,96), `iphone-setup/inapp.js` (7,81) | iPhone com jailbreak no Mac e no Windows; Windows sem OpenSSH | #78 |
| 6 | M6 a mídia e a voz · P3 o GPS | `ios-bridge.js` (8,81), `geo-proxy.js` (9,58) | iPhone comum; credencial de proxy de teste; microfone e câmera | #76, #62, #69; se o dono quiser, #61, #82 e #98 |
| 7 | M7 o YouTube e o Kling · G3 a identidade | `app/dist/cam-live-audio.js` (7,41), `user-profile-manager.js` (9,13) | proxy autenticado do dono no CAM spoof | nenhuma |
| 8 | M8 os agentes · P4 controle do Android e o navegador | `nova-human-controller.js` (9,45), `app/electron/webview-bridge.js` (9,22) | Android com root (Wi-Fi, Bluetooth, apps) | nenhuma |
| 9 | M9 o celular · P5 câmera, transmissão e Frida | `rtmp-server.js` (9,68), `ios-devices.js` (9,66) | Android com root, APK e LSPosed; iPhone com jailbreak | #77; se o dono quiser, #74 |
| 10 | M10 o cofre · G4 o Chrome | `tool-paths.js` (9,68), `MAC/integracao-iphone/conexao-usb/proxy-parse.js` (7,55) | CAM spoof no Mac: o Chrome órfão e o áudio de ambiente | nenhuma |
| 11 | M11 a janela e o ciclo de vida · F2 o que roda na página | 2 vagas: cortes do `app/dist/cam-live.js` (1,65, hotspot) | o app instalado abre, fecha e atualiza | #95 e #97 com o corte do `cam-live.js` |
| 12 | G5 o CDP · F3 o disfarce | 2 vagas | conta Google de teste no CAM spoof | nenhuma |
| 13 | P6 identidade e módulo Magisk · F4 a rede | 2 vagas | Android com Magisk; proxy do dono no farm | #96 (parte da identidade) |
| 14 | P7 aplicar, conferir e desfazer o perfil · G6 o script como código | 2 vagas | Android com Magisk, só de teste; site de impressão digital no Mac | #96 |
| 15 | F5 o lançamento e o login | 3 vagas | login Google com conta de teste, se o dono quiser | nenhuma |
| 16 | F6 a corrida | 3 vagas | nenhuma (o agente prova numa página local) | nenhuma |

O `proxy-parse.js` já tem a caracterização pronta: o teste que a PR dos protótipos move para junto dele.

## Fase 2: teto (arquivos em 10 acima de 20.000 bytes)

| Lote | Itens | Prova do dono | Provas pendentes |
| --- | --- | --- | --- |
| 17 | `telegram-manager.js` (28.494 bytes), `remote-access.js` (26.337), `app/electron/pwa/admin.html` (32.651), `kling-video-service.js` (25.209); `MAC/LEIA-ME.md` (133.516, BAIXA) | Telegram, acesso remoto pelo celular, Kling | #67, #83, #79; se o dono quiser, #103 e #187 |
| 18 | `browser-manager.js` (22.182), `ytdlp-manager.js` (21.283), `gemini-browser-engine.js` (20.447), `live-cam-bridge.js` (20.106); `live-cam-paginas.js` (24.966, BAIXA), `app/electron/nova-grab-extension/content.js` (24.722, BAIXA) | Gemini e Antigravity; celular no navegador | #80, #74 |

## Fase 3: ferramenta

| Lote | Itens (nota) |
| --- | --- |
| 19 | `scripts/regras/registro-da-pr.js` (8,01, hotspot), `scripts/regras/verificar.js` (9,68, hotspot), `scripts/regras/registrar-na-pr.js` (7,64), `scripts/regras/regra-linhas.js` (8,66) |
| 20 | `scripts/regras/regra-comentario.js` (8,67), `scripts/regras/regra-segredo.js` (9,16), `scripts/regras/regra-binario.js` (9,24), `scripts/regras/auditoria.js` (9,37) |
| 21 | `MAC/integracao-sequestro-cam/patch_bundle.py` (8,13), `MAC/controle-celular-plataformas/aplicar.py` (8,65, 25.056 bytes), `MAC/controle-celular-plataformas/geo-proxy/aplicar-geo.py` (8,93), `MAC/integracao-iphone/distribuicao/empacotar-python.py` (9,68) |

O `prototype-sequestro-cam/servir.py` (9,36) sai com a PR dos protótipos e não tem lote. Nenhum lote de ferramenta pede o dono.

## Fase 4: testes

| Lote | Itens (nota) |
| --- | --- |
| 22 | `MAC/integracao-camlive/test/harness-usb.js` (9,38), `MAC/integracao-camlive/test/harness.js` (9,38), `MAC/integracao-iphone/idioma-iphone/teste/teste-ipc.js` (9,68) |
| 23 | `MAC/proxy-iphone/tool/teste/upstream_test.m` (8,34), `MAC/proxy-iphone/tool/teste/parse_test.m` (9,38) |

## Fase 5: Objective-C e Logos (decidida na #134 e na #190)

| Lote | Itens | Prova do dono (iPhone10,2 com jailbreak, no Mac) |
| --- | --- | --- |
| 24, Proxy A | `MAC/proxy-iphone/tool/Upstream.m` (6,54), `Socks5.m` (8,63), `Forwarder.m` (7,47) | `novaproxy proxy status`, `set`, `check system` e `clear`, com proxy de teste; e #188 |
| 25, Proxy B | `ProxyConfig.m` (8,45), `SysProxy.m` (8,33), `main.m` (8,63) | o mesmo roteiro, logo depois do Proxy A |
| 26, idioma e modelo | `MAC/integracao-iphone/idioma-iphone/novalanguage/main.m` (5,69), `MAC/integracao-modelo/main.m` (9,38), `MAC/integracao-modelo/Tweak.x` virando `.m` | `novalanguage` e `novamodel` com respring |
| 27 | a ponte: divisão mecânica do `bridge/Tweak.x` em dez `.m` e `Ponte.h` | os passos 1 a 11 da pesquisa da ponte; e a Sessão 1 da #137 |
| 28 a 36 | a ponte, um corte por lote: `Estado`, `Controle`, `Audio`, `Quadros`, `Saidas`, `Foto`, `CicloDoGrafo`, `Grafo`, `Ganchos` | os mesmos passos em cada lote |

Um arquivo da ponte que já nascer em 10 depois do lote 27 sai da fila, e os lotes seguintes andam uma casa.
