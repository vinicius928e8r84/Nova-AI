# CONTROLS no iPhone — Liga/Desliga de Wi-Fi e Bluetooth

> **Documento vivo.** Atualização: **2026-11-03 (estado: integração aplicada, aguardando
> criação dos 4 atalhos no iPhone)**.

---

## 1. Objetivo

Fazer os interruptores **Wi-Fi** e **Bluetooth** da aba **CONTROLS** da janela *Controle do
Celular – Suite de Hardware* funcionarem com o iPhone (iOS 16.7.16, palera1n rootless),
igual ao Android.

---

## 2. Arquitetura entregue (híbrida)

| Papel | Componente | Estado |
|---|---|---|
| **Disparo do toggle** | Atalho nativo do iOS ("Definir Wi-Fi/Bluetooth") acionado por `uiopen shortcuts://run-shortcut?name=…` via SSH (`iosToggleSetting` no `physicalMobileService.js`) | ✅ patch aplicado no app |
| **Leitura de estado** | CLI próprio `novactl` (`com.aquiles.novactl`) — Wi-Fi via MobileWiFi `GetPower` | ✅ instalado no iPhone, leitura calibrada |
| **Transporte** | Túnel USB `iproxy 2222 22` + chave `~/.ssh/id_iphone` (usuário `mobile`) | ✅ já existia |
| **Pendente** | Criar os 4 atalhos no iPhone (nomes exatos abaixo) | ⏳ manual, ~3 min |

**Nomes exatos dos atalhos** (app **Atalhos** do iPhone):

| Nome | Ação única |
|---|---|
| `Nova WiFi On` | Definir Wi-Fi → Ativado |
| `Nova WiFi Off` | Definir Wi-Fi → Desativado |
| `Nova BT On` | Definir Bluetooth → Ativado |
| `Nova BT Off` | Definir Bluetooth → Desativado |

Código do patch (já no app instalado e em `app/electron/services/physicalMobileService.js`):

```js
async iosToggleSetting(deviceId, setting, enable) {
    const SHORTCUTS = {
        wifi:      { on: 'Nova WiFi On', off: 'Nova WiFi Off' },
        bluetooth: { on: 'Nova BT On',   off: 'Nova BT Off' }
    };
    const names = SHORTCUTS[String(setting).toLowerCase()];
    if (!names) return { success: false, error: 'Unsupported setting.' };
    const url = 'shortcuts://run-shortcut?name=' + encodeURIComponent(enable ? names.on : names.off);
    const r = await this.iosSsh('uiopen ' + JSON.stringify(url));
    return r.ok ? { success: true } : { success: false, error: r.error };
}
```

Serviço pré-patch: `git show 1b45c3f:MAC/integracao-iphone/reservas/novactl-20261103-145612/physicalMobileService.js`.

---

## 3. Por que essa arquitetura (histórico das rotas)

1. **Atalhos + uiopen (1ª rota)** — funciona, mas abre o Atalhos na tela e exigia 4 atalhos.
2. **CLI próprio `novactl` (2ª rota, "melhor rota")** — invisível e lê estado; **a leitura
   funciona** (GetPower calibrado contra Bonjour/ping), mas a **escrita foi neutralizada**
   pela Apple no iOS 16: `WiFiManagerClientSetPower` de fora (mesmo com root, entitlement
   `com.apple.wifi.manager-access` assinado e cliente agendado no runloop) não age — os
   tweaks modernos (RealCC & cia) fazem o toggle **hookando o SpringBoard** (SBWifiManager),
   fora do alcance de um CLI.
3. **Híbrida (entregue)** — melhor dos dois: toggle 100% confiável via Atalho nativo;
   estado real via novactl; infra toda por SSH/USB.

O Bluetooth seguiu a mesma lógica: `BluetoothManager.setPoweredEnabled:` não existe no
16.7.16 (existe `setPowered:` legado e o CBController XPC — mapeados no modo
`novactl probe`), mas a escrita externa não é confiável; o Atalho nativo cobre.

### Experiências futuras (opcional, Fase 5)
- Testar `WiFiManagerClientSetPowerExt` / `WiFiDeviceClientSetPower` (símbolos existem no
  MobileWiFi do 16.5; assinaturas desconhecidas — risco de UB).
- Se um dia for preciso invisibilidade total: tweak injetado no SpringBoard com Theos
  (modelo RealCC), comunicando com o app por arquivo de controle — projeto maior.

---

## 4. Pré-requisitos

- [x] Túnel USB SSH + chave (pré-existentes)
- [x] iOS 16.7.16; Theos + SDK 16.5 (builds do novactl 0.1→0.4)
- [x] `novactl` 0.4 instalado (leitura de Wi-Fi calibrada; modo `probe`)
- [x] Patch `iosToggleSetting` aplicado no app (sintaxe validada, app reiniciado, túnel OK)
- [ ] **4 atalhos criados no iPhone** (nomes exatos da tabela acima)
- [ ] Teste final pela aba CONTROLS do app

---

## 5. Plano de execução restante

### Fase A — Criar os atalhos (manual, uma vez)

- [ ] No iPhone: app **Atalhos** → `+` → nomear exatamente `Nova WiFi On` → ação
      **Definir Wi-Fi** → **Ativado** → concluir
- [ ] Repetir para `Nova WiFi Off` (Desativado), `Nova BT On` e `Nova BT Off`
- [ ] Rodar um dos atalhos na mão uma vez para o iOS pedir permissão (se pedir)

### Fase B — Teste final

- [ ] No Nova AI Mac: janela Controle do Celular → iPhone selecionado → aba CONTROLS
- [ ] Alternar Wi-Fi: confirmar no iPhone que ligou/desligou de verdade
- [ ] Alternar Bluetooth: idem
- [ ] (Opcional) conferir leitura: `ssh -p 2222 … 'novactl wifi status'`

### Fase C — Encerramento

- [ ] Atualizar `MAC/LEIA-ME.md`
- [ ] Fechar os pendentes da seção 4

---

## 6. Descobertas técnicas (consulta futura)

- **Trustcache rootless**: binário assinado fora do trustcache morre com SIGKILL (137)
  mesmo sob `/var/jb`. A instalação via `dpkg` (root) registra. `dpkg -i` só funciona
  **dentro do iPhone** (ex.: `ssh -t -p 2222 mobile@127.0.0.1 "sudo dpkg -i …"`).
- **HOME do mobile**: `/var/jb/var/mobile`. Sem sudo sem senha; root não aceita a chave do app.
- **MobileWiFi no iOS 16**: `GetPower` devolve o estado **no retorno** (não no out-param);
  sem `WiFiManagerClientScheduleWithRunLoop` as chamadas voltam lixo. `SetPower` externo
  não age (nem com root/entitlement/runloop) — escrita exige processo dentro do
  SpringBoard (SBWifiManager) nos moldes do RealCC.
- **Bluetooth iOS 16**: `BluetoothManager` existe com `setPowered:`/`powered`/`+sharedInstance`
  (não `setPoweredEnabled:`); `CBController` (CoreBluetooth) tem
  `activateWithCompletion:`/`setPowerState:completion:`/`getPowerStateWithCompletion:`.
- **Verdade de terreno sem tocar no aparelho**: Bonjour (`dns-sd -G v4 iPhone-8-Plus.local`)
  resolve `192.0.2.24` quando o Wi-Fi está on; `ping 192.0.2.24` confirma rádio ativo.
- **Entitlements no Theos**: `novactl_CODESIGN_FLAGS = -Sentitlements.plist` (assina na
  staging; verificar com `ldid -e .theos/_/var/jb/usr/bin/<tool>`).

---

## 7. Registro de progresso

| Data | Etapa | O que foi feito | Resultado | Próximo passo |
|---|---|---|---|---|
| 2026-11-03 | Levantamento | Código lido; SSH de leitura; pesquisa Atalhos/Activator | Rota Atalhos+uiopen documentada | — (substituída) |
| 2026-11-03 | Levantamento | Inventário: tweaks `com.aquiles.*` no aparelho, Theos no Mac, `apt` | Rota alterada para CLI próprio | criar projeto |
| 2026-11-03 | Fase 0 | novactl 0.1 compilado; binário solto no aparelho morre (137) | Confirma trustcache; `.deb` enviado | instalar via root |
| 2026-11-03 | Fase 1 | 3 tentativas de instalação: faltou 2ª linha; comando rodou no **Mac** por engano; por fim `ssh -t … "sudo dpkg -i …"` | 0.1 instalada | testes |
| 2026-11-03 | Fase 2 | Testes 0.1 mobile+root: Wi-Fi sem efeito; BT sem `setPoweredEnabled:` | Wi-Fi exige entitlement; BT mudou de API | rebuild |
| 2026-11-03 | Fase 0 | 0.2 com entitlements + probe; instalada | Probe revelou `setPowered:` legado + CBController completo | rebuild 0.3 |
| 2026-11-03 | Fase 0 | 0.3 com duas vias BT + Wi-Fi runloop pendente; instalada | Wi-Fi dá erros variados (UB); BT rc=0 sem efeito | calibrar |
| 2026-11-03 | Fase 2 | Calibração Bonjour: iPhone em 192.0.2.24 com Wi-Fi **ligado** enquanto CLI dizia "off" | Leitura também errada → falta de runloop | rebuild 0.4 |
| 2026-11-03 | Fase 0/2 | 0.4 (runloop) instalada: GetPower agora correto (=1, ligado); `wifi off` com ping de prova **não desligou** | Escrita MobileWiFi externa neutralizada no iOS 16 (tweaks usam hook SBWifiManager) | decisão de arquitetura |
| 2026-11-03 | Fase 3 | **Híbrida**: patch `iosToggleSetting` (Atalho via uiopen) aplicado no app; reserva salva; sintaxe OK; app reiniciado; túnel/iPhone OK | Integração pronta | usuário cria 4 atalhos → teste final |

---

## 8. Riscos e reversão

- **Atalho com nome errado** → toggle falha com erro do uiopen; conferir nomes exatos.
- **Primeira execução do Atalho** pode pedir permissão na tela do iPhone — aceitar uma vez.
- **"Definir Wi-Fi Off"** do Atalho é toggle completo do Ajustes (não o "suave" do CC).
- **Reversão do app**: restaurar o arquivo de `git show 1b45c3f:MAC/integracao-iphone/reservas/novactl-20261103-145612/physicalMobileService.js`
  e reiniciar. **Reversão do CLI**: `dpkg -r com.aquiles.novactl`.

---

## 9. Referências

- [The Apple Wiki — MobileWiFi.framework](https://theapplewiki.com/wiki/Dev:MobileWiFi.framework)
- [jakeajames/RealCC — fonte do tweak (hook SBWifiManager)](https://github.com/jakeajames/RealCC)
- [SBWifiManager — write-up técnico](https://zhangkn.github.io/2018/04/SBWiFiManager)
- [BluetoothManager.h — headers de runtime](https://github.com/nst/iOS-Runtime-Headers/blob/master/PrivateFrameworks/BluetoothManager.framework/BluetoothManager.h)
- [RealDisable (sucessor do RealCC) — r/jailbreak](https://www.reddit.com/r/jailbreak/comments/f77mo3/release_realdisable_disable_wifi_and_bluetooth)
- [Tutorial — run-shortcut via uiopen](https://www.reddit.com/r/jailbreak/comments/axi9yh/tutorial_run_shortcuts_via_activator)
- [Nimbus — ações do Activator por SSH](https://www.reddit.com/r/jailbreak/comments/6fs9wx/release_nimbus_control_your_ios_device_from_ssh)
