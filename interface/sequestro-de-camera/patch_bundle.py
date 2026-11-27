#!/usr/bin/env python3
import pathlib
import shutil
import sys

RESERVA = None
APP = pathlib.Path('/Applications/Nova AI Mac.app/Contents/Resources/app/dist/assets/index-Dun7lr2S.js')
PROJ = pathlib.Path(__file__).resolve().parent

origem = pathlib.Path(sys.argv[1])
s = origem.read_text(encoding='utf-8')


def match_paren(texto, abertura):
    i, prof, instr, esc = abertura, 0, None, False
    while i < len(texto):
        ch = texto[i]
        if instr:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == instr:
                instr = None
        else:
            if ch in '"\'`':
                instr = ch
            elif ch == '(':
                prof += 1
            elif ch == ')':
                prof -= 1
                if prof == 0:
                    return i + 1
        i += 1
    raise ValueError('parêntese sem fechamento')


def no_carta(prefixo, ancora):
    pos = 0
    while True:
        i = s.find(prefixo, pos)
        if i < 0:
            raise ValueError('cartão não encontrado: ' + prefixo[:60])
        fim = match_paren(s, i + len('b.jsxs(') - 1)
        if i < ancora < fim:
            return i, fim
        pos = i + 1


def apagar_span(ini, fim):
    global s
    s = s[:ini] + s[fim:]
    if ini < len(s) and s[ini - 1] == '[' and s[ini] == ',':
        s = s[:ini] + s[ini + 1:]
    elif ini < len(s) and s[ini - 1] == ',' and s[ini] == ',':
        s = s[:ini] + s[ini + 1:]
    elif ini < len(s) and s[ini - 1] == ',' and s[ini] == ']':
        s = s[:ini - 1] + s[ini:]


def substituir_unico(velho, novo):
    global s
    n = s.count(velho)
    if n != 1:
        raise ValueError(f'substituição esperava 1 ocorrência, achei {n}: {velho[:70]}')
    s = s.replace(velho, novo)


CARD = 'b.jsxs("div",{className:"bg-white/[0.02] border border-white/8 rounded-2xl p-5 space-y-3"'
COMO = 'b.jsxs("div",{className:"bg-white/[0.01] border border-white/5 rounded-2xl p-4 space-y-2"'

ancoras = {
    'item1': s.find('children:"Preparar módulo de câmera"'),
    'item2': s.find('children:"Selecionar Vídeo de Câmera Falsa"'),
    'como': s.find('children:"Como Funciona"'),
}
for k, v in ancoras.items():
    if v < 0:
        raise ValueError('âncora não encontrada: ' + k)

spans = [
    no_carta(CARD + ',children:[b.jsxs("div",{className:"flex items-center justify-between"', ancoras['item1']),
    no_carta(CARD + ',children:[b.jsxs("div",{className:"flex items-center gap-2"', ancoras['item2']),
    no_carta(COMO, ancoras['como']),
]
for ini, fim in sorted(spans, key=lambda x: -x[0]):
    apagar_span(ini, fim)

idx3 = s.find('children:"Ativar Sequestro de Câmera"')
if idx3 < 0:
    raise ValueError('item 3 não encontrado')
g = s.find('b.jsxs("div",{className:"grid grid-cols-2 gap-3"', idx3)
if g < 0:
    raise ValueError('grade de botões do item 3 não encontrada')
DESC = ('b.jsx("div",{className:"text-[9px] text-white/30 leading-relaxed",children:'
        '"Liga a injeção do OBS na câmera nativa do iPhone (visor, foto, vídeo e áudio) '
        'pelo jailbreak. Ao desligar, a câmera real volta — feche e reabra a Câmera para '
        'aplicar."}),')
s = s[:g] + DESC + s[g:]

substituir_unico(
    'disabled:HI==="active"||HI==="starting"||!ll.trim(),',
    'disabled:HI==="active"||HI==="starting",')

substituir_unico(
    'if(!ll.trim()){bl("⚠ Please select a video file first!");return}UI("starting"),'
    'bl("⏳ Pushing video to device and activating camera hijack...");',
    'UI("starting"),bl("Ligando a injeção da câmera pelo jailbreak...");')

substituir_unico(
    'eI.success?(UI("active"),bl("🎥 "+eI.message))',
    'eI.success?(UI("active"),bl("✓ "+eI.message))')

substituir_unico(
    'UI("stopping"),bl("⏳ Restoring real camera...");',
    'UI("stopping"),bl("Desligando a injeção e restaurando a câmera real...");')

substituir_unico(
    'vl(eI.installed||!1),bl(eI.message||eI.error||(eI.installed?"✓ Módulo de câmera Android instalado.":'
    '"Módulo de câmera Android não instalado."))',
    'vl(eI.installed||!1),UI(eI.active?"active":"idle"),bl(eI.message||eI.error||"Módulo de câmera não instalado.")')

substituir_unico(
    'children:"Android: módulo LSPosed. iPhone USB: Câmera nativa (prévia experimental)."',
    'children:"iPhone USB: câmera nativa pelo jailbreak (OBSGraphBridge)."')

APP.write_text(s, encoding='utf-8')
(PROJ / 'index-Dun7lr2S.patched.js').write_text(s, encoding='utf-8')
print('bundle patcheado:', APP)
print('cópia do projeto:', PROJ / 'index-Dun7lr2S.patched.js')
print('tamanho final:', len(s))
