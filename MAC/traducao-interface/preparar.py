#!/usr/bin/env python3
"""Prepara uma cópia do bundle e um catálogo HTML dos textos revisados."""
import html
import json
import re
import shutil
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ORIGEM = Path('/Applications/Nova AI Mac.app/Contents/Resources/app/dist/assets/index-Dun7lr2S.js')
ROTULOS = {
    'Phone Control': 'Controle do Celular', 'Browser Farm': 'Fazenda de Navegadores',
    'Nova Browser Farm': 'Fazenda de Navegadores Nova', 'AI Upload': 'Envio com IA',
    'PHOTO STUDIO': 'ESTÚDIO DE FOTOS', 'VISUAL HUB': 'CENTRAL VISUAL',
    'NOVA INVENTORY': 'ESTOQUE NOVA', 'NOVA DOWNLOADER': 'BAIXADOR NOVA',
    'Nova Recorder': 'Gravador Nova', 'TRADE SIGNALS': 'SINAIS DE NEGOCIAÇÃO',
    'Desktop': 'Computador', 'GO': 'Ir', 'Gemini API Key': 'Chave de API do Gemini',
    'Square (1:1)': 'Quadrado (1:1)', 'Standard Sans': 'Fonte sem serifa',
    'Status/Busy Reason Text (Roman Urdu)': 'Status ou motivo de indisponibilidade (urdu romanizado)',
    'Gemini Vision analyzing EMA 9 + Price Action': 'Gemini Vision analisando EMA 9 e movimento do preço',
    'Devices (': 'Dispositivos (', 'Controls': 'Controles', 'Apps': 'Aplicativos',
    'Browser': 'Navegador', 'Spoofer': 'Identidade simulada', 'SPOOFER': 'IDENTIDADE SIMULADA',
    'Stream Screen': 'Transmitir tela', 'Stop Stream': 'Parar transmissão',
    'Connect': 'Conectar', 'Pair Device': 'Parear dispositivo', 'Quick Mobile Scan': 'Busca rápida de celulares',
    'Wireless Switch': 'Alternar para Wi-Fi', 'Auto-Scan Subnet': 'Buscar na rede automaticamente',
    'Run Chrome Automation': 'Executar automação do Chrome', 'Fake GPS Location': 'Localização GPS simulada',
    'Stop GPS': 'Parar GPS simulado', 'Device Model Profile': 'Perfil do modelo do dispositivo',
    'Apply Dual IMEI (SIM1 + SIM2)': 'Aplicar IMEI duplo (SIM 1 + SIM 2)',
    'Injected Identity': 'Identidade aplicada', 'Reset & Reboot Real Identity': 'Restaurar identidade real e reiniciar',
    'Play Store Certification Fix': 'Corrigir certificação da Play Store',
    'PC Webcam Broadcast': 'Transmissão da webcam do computador', 'Direct Mobile Camera Stream': 'Transmissão direta da câmera do celular',
    'Streaming Live to Connected Phones': 'Transmitindo ao vivo para os celulares conectados',
    'Zero-latency local WebSocket & WebRTC bridge': 'Ponte local WebSocket e WebRTC de baixa latência',
    'START RTMP BROADCAST': 'INICIAR TRANSMISSÃO RTMP', 'STOP RTMP BROADCAST': 'PARAR TRANSMISSÃO RTMP',
    'Test in Browser': 'Testar no navegador', 'Reset Tunnel': 'Reiniciar túnel', 'Sync Tunnel': 'Sincronizar túnel',
    'Rescan': 'Buscar novamente', 'Refresh': 'Atualizar', 'Scan with Camera': 'Escanear com a câmera',
    'Start Recording': 'Iniciar gravação', 'Resume Task': 'Retomar tarefa',
    'TIMELINE': 'LINHA DO TEMPO', 'SESSIONS': 'SESSÕES', 'EVENTS': 'EVENTOS',
    'Canvas & Preview': 'Área de edição e prévia', 'Canvas Modes': 'Modos da área de edição',
    'Crop': 'Recortar', 'Adjust & Filters': 'Ajustes e filtros', 'Enhancements': 'Melhorias',
    'Magic Eraser': 'Borracha mágica', 'Matrix Filters': 'Filtros de matriz', 'Reset Current': 'Redefinir ajuste atual',
    'Save to Gallery': 'Salvar na galeria', 'Text': 'Texto', 'Export': 'Exportar',
    'Pitch': 'Tom', 'Speed': 'Velocidade', 'Speed:': 'Velocidade:', 'Play Video': 'Reproduzir vídeo',
    'Load': 'Carregar', 'Restore': 'Restaurar', 'Back': 'Voltar', 'Clear': 'Limpar', 'Cancel': 'Cancelar',
    'Play': 'Reproduzir', 'Stop': 'Parar', 'Save': 'Salvar', 'Save changes': 'Salvar alterações',
    'PASTE': 'COLAR', 'Copy Link': 'Copiar link', 'Exit': 'Sair', 'Locked': 'Bloqueado',
    'Entries': 'Entradas', 'Profile': 'Perfil', 'Profiles': 'Perfis', 'Add Profile': 'Adicionar perfil',
    'Run Farm': 'Iniciar fazenda', 'Stop Farm': 'Parar fazenda', 'New fingerprint': 'Nova impressão digital do navegador',
    'Checks Passed': 'Verificações concluídas', 'Key saved (': 'Chave salva (',
    'Downloads Dir': 'Pasta de downloads', 'Full Playlist': 'Playlist completa',
    'Single Item': 'Um item', 'Auto-Split': 'Divisão automática', 'Custom Timestamps': 'Marcações de tempo personalizadas',
    'MP3 Audio': 'Áudio MP3', 'Open Registration Page': 'Abrir página de cadastro',
    'CONNECTED': 'CONECTADO', 'CONNECTING...': 'CONECTANDO...', 'IDLE': 'EM ESPERA',
    'WA Intelligence': 'IA do WhatsApp', 'SPOOF CAM': 'CÂMERA VIRTUAL',
    'Researcher': 'Pesquisador', 'Active_01': 'Ativo 01', 'Nó de Runtime': 'Nó de execução',
    '// SUBSISTEMA_OCIOSO: AGUARDANDO_COMANDO_UPSTREAM': '// SUBSISTEMA OCIOSO · AGUARDANDO COMANDO',
    'LIVE': 'AO VIVO', 'STANDBY': 'EM ESPERA', 'Active': 'Ativo', 'Offline': 'Desconectado',
}
CONTEXTO = {
    '?"VISUAL_LINK_ACTIVE":"LOGIC_ACTIVE":I===ql.CONNECTING?"INITIALIZING":"STANDBY"':
        '?"CONEXÃO VISUAL ATIVA":"LÓGICA ATIVA":I===ql.CONNECTING?"INICIALIZANDO":"EM ESPERA"',
    '"DRIVER PRONTO":"STANDBY"': '"DRIVER PRONTO":"EM ESPERA"',
    'children:bI?`Active · Port ${FI}`:"Offline"': 'children:bI?`Ativo · Porta ${FI}`:"Desconectado"',
    'children:EI?"CONNECTED":"NÃO VINCULADO"': 'children:EI?"CONECTADO":"NÃO VINCULADO"',
    '"DEVICE QUICK CONTROLS ("': '"CONTROLES RÁPIDOS DO DISPOSITIVO ("',
    'children:aG===ql.CONNECTED||uI||Kc?"ONLINE":"OFFLINE"':
        'children:aG===ql.CONNECTED||uI||Kc?"CONECTADO":"DESCONECTADO"',
    'children:aG===ql.CONNECTED||uI||Kc?"Online":"Offline"':
        'children:aG===ql.CONNECTED||uI||Kc?"Conectado":"Desconectado"',
}
# Textos gerados por estados, mensagens de formulário e animação de abertura.
CONTEXTO.update({
    '"INITIALIZING KERNEL..."': '"INICIALIZANDO O NÚCLEO..."',
    '"BIOS_CHECK :: OK"': '"VERIFICAÇÃO DO BIOS CONCLUÍDA"',
    '"LOADING_NEURAL_NETWORKS..."': '"CARREGANDO REDES NEURAIS..."',
    '"DECRYPTING_USER_VAULT..."': '"DESCRIPTOGRAFANDO O COFRE DO USUÁRIO..."',
    '"ESTABLISHING_SECURE_LINK..."': '"ESTABELECENDO CONEXÃO SEGURA..."',
    '"OPTIMIZING_MEMORY_SHARDS..."': '"OTIMIZANDO A MEMÓRIA..."',
    '"LOADING_CORE_MODULES...","SYSTEM_READY"': '"CARREGANDO MÓDULOS DO NÚCLEO...","SISTEMA PRONTO"',
    'sub:y?"ACTIVE":"STREAM"': 'sub:y?"ATIVO":"TRANSMISSÃO"',
    'sub:yb&&L?"HD VOICE":"NATIVE"': 'sub:yb&&L?"VOZ HD":"NATIVA"',
    '"SYSTEM INTERCEPTED":"ELECTRON ATIVO"': '"SISTEMA INTERCEPTADO":"ELECTRON ATIVO"',
    'W("Secret Key required")': 'W("Digite a chave secreta.")',
    'new Error("Please enter a valid API key (minimum 10 characters)")':
        'new Error("Digite uma chave de API válida com pelo menos 10 caracteres.")',
    'new Error("Save failed")': 'new Error("Falha ao salvar.")',
    'W(s.message||"Verification failed")': 'W(s.message||"Falha na verificação.")',
    'e(Hl.error||"Activation failed.")': 'e(Hl.error||"Falha na ativação.")',
    'e(`Server connection error: ${Hl.message}`)': 'e(`Erro de conexão com o servidor: ${Hl.message}`)',
})
CONTEXTO.update({
    '" WA Intelligence"': '" IA do WhatsApp"',
    'sub:ed?"MUTED":"LIVE"': 'sub:ed?"MUDO":"AO VIVO"',
})
CONTEXTO.update({
    '" Devices (",e.length': '" Dispositivos (",e.length',
    """children:'Instant: Connect phone via USB once & click "Wireless Switch" or enter phone Wi-Fi IP.'""":
        'children:"Conecte o celular por USB e selecione Alternar para Wi-Fi, ou digite o IP do celular."',
    '"Connect phone via USB cable and choose "': '"Conecte o celular por USB e selecione "',
    'farm:"Farm Control",profiles:"Profile Matrix"': 'farm:"Controle da fazenda",profiles:"Painel de perfis"',
    'children:NI==="subscribe"?"Sub":NI.charAt(0).toUpperCase()+NI.slice(1)':
        'children:({watch:"Assistir",like:"Curtir",subscribe:"Inscrever",comment:"Comentar",share:"Compartilhar"})[NI]',
    '["Profiles",`${kl} selected`],["Batches",El.toString()],["Est. Runtime",':
        '["Perfis",`${kl} selecionados`],["Lotes",El.toString()],["Tempo estimado",',
    '" PROFILES • CLICK TO SELECT"': '" PERFIS · CLIQUE PARA SELECIONAR"',
    'children:["Exported Library (",nI.length': 'children:["Arquivos exportados (",nI.length',
    'confirm("Delete all exported files? This cannot be undone.")':
        'confirm("Excluir todos os arquivos exportados? Essa ação é irreversível.")',
    'sub:"Authoritative"': 'sub:"Firme"',
    'sub:"Energetic"': 'sub:"Enérgica"',
    'sub:"Lively"': 'sub:"Animada"',
    '?`${$G} Handled`:"Active"': '?`${$G} atendidas`:"Ativa"',
    '?"Active & Ready":"Standby"': '?"Ativo e pronto":"Em espera"',
    '?"System Online":"Standby"': '?"Sistema conectado":"Em espera"',
    'busyText:()=>"Searching..."': 'busyText:()=>"Pesquisando..."',
})
ROTULOS['Backup'] = 'Cópia de segurança'
CONTEXTO.update({
    'g?"Parar Câmera Interna":`Start In-App ${aI==="front"?"Front":"Back"} Camera`':
        'g?"Parar câmera interna":`Iniciar câmera ${aI==="front"?"frontal":"traseira"} no app`',
    '" 1-Click Android ADB Camera"': '" Câmera Android via ADB"',
    """children:'Click "Start In-App Mobile Camera" or scan the QR code above.'""":
        'children:"Inicie a câmera no app ou escaneie o código QR acima."',
    'g?"LIVE 30FPS":"READY"': 'g?"AO VIVO · 30 FPS":"PRONTO"',
    'N?"Copied":"Copy"': 'N?"Copiado":"Copiar"',
})
LITERAL = r'"([^"\\\n]*)"'
VISIVEL = re.compile(r'(\b(?:children|title|placeholder|aria-label):|children:\[[^\[\]]{0,100},)' + LITERAL)
revisados = {}

def traduzir(m):
    texto = m[2]
    base = texto.strip()
    traducao = ROTULOS.get(base)
    if m[1] == 'placeholder:' and base.startswith('e.g. '):
        traducao = 'ex.: ' + base[5:].replace(' or ', ' ou ')
    if not traducao:
        return m[0]
    revisados[base] = traducao
    valor = texto[:len(texto) - len(texto.lstrip())] + traducao + texto[len(texto.rstrip()):]
    return m[1] + json.dumps(valor, ensure_ascii=False)

s = VISIVEL.sub(traduzir, ORIGEM.read_text())
for antes, depois in CONTEXTO.items():
    assert antes in s, antes
    s = s.replace(antes, depois)
assert {'Phone Control', 'AI Upload', 'Controls', 'Browser Farm'} <= revisados.keys()
(AQUI / ORIGEM.name).write_text(s)
shutil.copyfile(AQUI.parent.parent / "app" / "dist" / "cam-live.js", AQUI / "cam-live.js")
linhas = ''.join(f'<tr><td>{html.escape(a)}</td><td>{html.escape(b)}</td></tr>\n' for a, b in sorted(revisados.items()))
(AQUI / 'revisao.html').write_text('''<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revisão da tradução do Nova</title>
<style>body{font:16px system-ui;background:#101622;color:#eef2ff;max-width:900px;margin:32px auto;padding:0 16px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:9px;border-bottom:1px solid #38435c}th{color:#99e6c8}td:first-child{color:#b3bfd5}</style>
<h1>Tradução da interface do Nova</h1><p>Rótulos revisados para a cópia de teste.</p>
<table><thead><tr><th>Texto anterior</th><th>Português</th></tr></thead><tbody>''' + linhas + '</tbody></table></html>\n')
print(f'{len(revisados)} rótulos e {len(CONTEXTO)} expressões de interface revisados.')
