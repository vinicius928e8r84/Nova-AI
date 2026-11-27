ANCORA_DO_ITEM3 = 'children:"Ativar Sequestro de Câmera"'
GRADE_DE_BOTOES = 'b.jsxs("div",{className:"grid grid-cols-2 gap-3"'
DESCRICAO_DO_ITEM3 = (
    'b.jsx("div",{className:"text-[9px] text-white/30 leading-relaxed",children:'
    '"Liga a injeção do OBS na câmera nativa do iPhone (visor, foto, vídeo e áudio) '
    'pelo jailbreak. Ao desligar, a câmera real volta — feche e reabra a Câmera para '
    'aplicar."}),')

SUBSTITUICOES = (
    (
        'disabled:HI==="active"||HI==="starting"||!ll.trim(),',
        'disabled:HI==="active"||HI==="starting",',
    ),
    (
        'if(!ll.trim()){bl("⚠ Please select a video file first!");return}UI("starting"),'
        'bl("⏳ Pushing video to device and activating camera hijack...");',
        'UI("starting"),bl("Ligando a injeção da câmera pelo jailbreak...");',
    ),
    (
        'eI.success?(UI("active"),bl("🎥 "+eI.message))',
        'eI.success?(UI("active"),bl("✓ "+eI.message))',
    ),
    (
        'UI("stopping"),bl("⏳ Restoring real camera...");',
        'UI("stopping"),bl("Desligando a injeção e restaurando a câmera real...");',
    ),
    (
        'vl(eI.installed||!1),bl(eI.message||eI.error||(eI.installed?"✓ Módulo de câmera Android instalado.":'
        '"Módulo de câmera Android não instalado."))',
        'vl(eI.installed||!1),UI(eI.active?"active":"idle"),bl(eI.message||eI.error||"Módulo de câmera não instalado.")',
    ),
    (
        'children:"Android: módulo LSPosed. iPhone USB: Câmera nativa (prévia experimental)."',
        'children:"iPhone USB: câmera nativa pelo jailbreak (OBSGraphBridge)."',
    ),
)
