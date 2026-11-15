#!/usr/bin/env python3
"""Separa o sequestro (item 3) da transmissão.

- physicalMobileService.js: start/stop do cam spoof iOS vão para os métodos
  dedicados startCamSpoof/stopCamSpoof (não mexem na transmissão).
- cam-live-service.js: expõe a instância do CAM LIVE no mobile service para o
  sequestro poder pausá-la em vez de brigar pelo controle.
- cam-live-iphone.js: quando o sequestro assume o controle da ponte, o CAM
  LIVE pausa (continuando transmitindo) em vez de morrer com erro.
"""
import pathlib
import sys

APP = pathlib.Path('/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services')


def trocar(arquivo, trocas, obrigatorio=True):
    p = APP / arquivo
    s = p.read_text(encoding='utf-8')
    for velho, novo in trocas:
        n = s.count(velho)
        if n != 1:
            msg = f'{arquivo}: esperava 1 ocorrência, achei {n}: {velho[:80]}'
            if obrigatorio:
                raise SystemExit(msg)
            print('AVISO:', msg)
            continue
        s = s.replace(velho, novo)
    p.write_text(s, encoding='utf-8')
    print('ok:', arquivo)


# ── physicalMobileService.js ────────────────────────────────────────────────
with open(APP / 'physicalMobileService.js', encoding='utf-8') as f:
    s = f.read()
alvo_start = "if (String(deviceId).startsWith('ios-')) return this.iosCamera().start(videoPath);"
alvo_stop_camspoof = """async stopCamSpoof(deviceId) {"""
assert s.count(alvo_start) == 1, f'start: {s.count(alvo_start)}'
s = s.replace(alvo_start,
              "if (String(deviceId).startsWith('ios-')) return this.iosCamera().startCamSpoof(videoPath);")
# stop: duas ocorrências de iosCamera().stop() — trocar só a do stopCamSpoof
i = s.find(alvo_stop_camspoof)
assert i > 0, 'stopCamSpoof não encontrado'
j = s.find("return this.iosCamera().stop();", i)
assert 0 < j < i + 600, 'stop do camspoof não encontrado perto do método'
s = s[:j] + 'return this.iosCamera().stopCamSpoof();' + s[j + len('return this.iosCamera().stop();'):]
(APP / 'physicalMobileService.js').write_text(s, encoding='utf-8')
print('ok: physicalMobileService.js')

# ── cam-live-service.js ─────────────────────────────────────────────────────
trocar('cam-live-service.js', [(
    "ipcMain.handle('camlive:start', (_e, cfg) => (cfg && cfg.target === 'iphone' ? iphone.start(cfg) : svc.start(cfg)));",
    "try { const ms = getMobileService && getMobileService(); if (ms) ms.camLiveIphone = iphone; } catch (_) {}\n"
    "ipcMain.handle('camlive:start', (_e, cfg) => (cfg && cfg.target === 'iphone' ? iphone.start(cfg) : svc.start(cfg)));",
)])

# ── cam-live-iphone.js ──────────────────────────────────────────────────────
trocar('cam-live-iphone.js', [
    # 1. latch no construtor
    ("this.stopping = null; this.generation = 0; this.running = false; this.starting = false; this.active = false; this.ownsControl = false; this.status = 'Pronto'; this.error = ''; this.droppedPcm = 0;",
     "this.stopping = null; this.generation = 0; this.running = false; this.starting = false; this.active = false; this.ownsControl = false; this.status = 'Pronto'; this.error = ''; this.droppedPcm = 0; this.sequestroPausado = false;"),
    # 2. reset do latch em nova transmissão
    ("this.session = crypto.randomBytes(16).toString('hex'); this.pcmAt = 0; this.droppedPcm = 0; this.pcmBlocked = false; this.ownsControl = false; this.active = false;",
     "this.session = crypto.randomBytes(16).toString('hex'); this.pcmAt = 0; this.droppedPcm = 0; this.pcmBlocked = false; this.ownsControl = false; this.active = false; this.sequestroPausado = false;"),
    # 3. _maybeEnable não tenta reativar enquanto o sequestro estiver no controle
    ("_maybeEnable(token) {\n    if (!this.running || this.enabling || this.active || !this.media",
     "_maybeEnable(token) {\n    if (!this.running || this.sequestroPausado || this.enabling || this.active || !this.media"),
    # 4. heartbeat idem
    ("async _heartbeat(token) {\n    if (!this.running || token !== this.generation || this.enabling || this.observing) return;",
     "async _heartbeat(token) {\n    if (!this.running || token !== this.generation || this.sequestroPausado || this.enabling || this.observing) return;"),
    # 5. métodos: leitura do controle + pausa pública do sequestro
    ("  async _observe() {",
     "  async _lerControle() { const r = await this.mobile.iosSsh('cat ' + CONTROL); if (!r || !r.ok) return null; try { return JSON.parse(r.stdout); } catch (_) { return null; } }\n"
     "  pausarSequestro() {\n"
     "    if (!this.running) return;\n"
     "    this.sequestroPausado = true; this.ownsControl = false; this.active = false;\n"
     "    this.status = 'Transmissão no ar — câmera com o sequestro'; this._emit();\n"
     "  }\n"
     "  async _observe() {"),
    # 6. _activate: ramo A (dono deixou de ser nossa sessão)
    ("if (!owner.ok || !config || config.novaCamLiveSession !== this.session) throw new Error('Outra sessão assumiu a câmera do iPhone. O CAM LIVE não a substituiu.');",
     "if (!owner.ok || !config || config.novaCamLiveSession !== this.session) {\n"
     "        if (config && config.novaSequestroSession) return this.pausarSequestro();\n"
     "        throw new Error('Outra sessão assumiu a câmera do iPhone. O CAM LIVE não a substituiu.');\n"
     "      }"),
    # 7. _activate: ramo B (perdemos o controle no meio)
    ("if (this.ownsControl && !(await this._isOwnControl())) { this.ownsControl = false; this.active = false; throw new Error('Outra sessão assumiu o controle da câmera. O CAM LIVE foi interrompido.'); }",
     "if (this.ownsControl && !(await this._isOwnControl())) { this.ownsControl = false; this.active = false; const controle = await this._lerControle(); if (controle && controle.novaSequestroSession) return this.pausarSequestro(); throw new Error('Outra sessão assumiu o controle da câmera. O CAM LIVE foi interrompido.'); }"),
    # 8. _activate: ramo C (ponte ocupada por outro injetor)
    ("if (!this.ownsControl && await this._bridgeBusy(state)) throw new Error('Outra transmissão assumiu a câmera do iPhone. O CAM LIVE não a substituiu.');",
     "if (!this.ownsControl && await this._bridgeBusy(state)) { const controle = await this._lerControle(); if (controle && controle.novaSequestroSession) return this.pausarSequestro(); throw new Error('Outra transmissão assumiu a câmera do iPhone. O CAM LIVE não a substituiu.'); }"),
])

print('todos os patches aplicados')
