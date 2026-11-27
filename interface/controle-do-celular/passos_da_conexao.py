from delimitadores import fim_do_parentese
from passos_de_patch import Substituicao, Transformacao
from passos_do_estado import INICIO_DAS_ABAS

BLOCO_DE_CONEXAO = 'b.jsxs("div",{className:"border-t border-white/5 pt-6 space-y-4",children:['

PLATAFORMA = (
    'b.jsxs("div",{className:"flex items-center gap-2.5 px-3 md:px-5 py-2 bg-black/40 border-b border-white/5 flex-shrink-0",children:['
    'b.jsx("span",{className:"hidden sm:block text-[8px] font-black text-white/25 uppercase tracking-[0.24em]",children:"Plataforma"}),'
    'b.jsxs("div",{className:"flex p-0.5 rounded-xl bg-black/50 border border-white/10 gap-0.5",children:['
    'b.jsxs("button",{onClick:()=>pPick("ios"),className:`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${pIsIos?"":"text-white/40 hover:text-white/70"}`,style:pIsIos?{background:"#fff",color:"#000",boxShadow:"0 0 16px rgba(255,255,255,0.18)"}:null,children:['
    'b.jsx(pAppleIcon,{size:12}),"iPhone",'
    'b.jsx("span",{className:`text-[8px] px-1 rounded ${pIsIos?"bg-black/10 text-black/60":"bg-white/5 text-white/35"}`,children:pIosCount})]}),'
    'b.jsxs("button",{onClick:()=>pPick("android"),className:`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${!pIsIos?"":"text-white/40 hover:text-white/70"}`,style:!pIsIos?{background:"#3ddc84",color:"#000",boxShadow:"0 0 16px rgba(61,220,132,0.22)"}:null,children:['
    'b.jsx(pAndroidIcon,{size:12}),"Android",'
    'b.jsx("span",{className:`text-[8px] px-1 rounded ${!pIsIos?"bg-black/10 text-black/60":"bg-white/5 text-white/35"}`,children:pAndroidCount})]})'
    ']}),'
    'b.jsx("span",{className:"ml-auto hidden md:block text-[8px] font-black uppercase tracking-[0.18em] text-white/25",children:pIsIos?"USB · Atalhos · Jailbreak":"USB · Wi-Fi · ADB"})'
    ']}),'
)

BANNER = (
    'pIsIos&&b.jsxs("div",{className:"mb-3 flex flex-wrap items-center gap-1.5",children:['
    'b.jsx("span",{className:"text-[9px] font-black text-white uppercase tracking-widest mr-1",children:"Modo iPhone"}),'
    '["USB","Atalhos","Câmera por jailbreak","Sem ADB"].map(pC=>b.jsx("span",{className:"px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[8px] font-bold text-white/50 uppercase tracking-wider",children:pC},pC))'
    ']}),'
)

GUIA_IOS = (
    ',pIsIos&&b.jsxs("div",{className:"p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3 max-w-xl text-[11px] text-white/70",children:['
    'b.jsxs("div",{className:"flex items-center gap-2",children:['
    'b.jsx(pAppleIcon,{size:12}),'
    'b.jsx("span",{className:"font-bold text-white uppercase tracking-wider text-xs",children:"Como conectar seu iPhone"})]}),'
    'b.jsxs("ol",{className:"list-decimal list-inside space-y-1.5 leading-relaxed text-white/80",children:['
    'b.jsx("li",{children:"Conecte o iPhone ao Mac com um cabo USB."}),'
    'b.jsxs("li",{children:["No iPhone, toque em ",b.jsx("strong",{children:"Confiar"}),\' quando aparecer "Confiar neste computador?".\']}),'
    'b.jsxs("li",{children:["O aparelho aparece acima com o ID ",b.jsx("code",{children:"ios-..."}),". Selecione e clique em ",b.jsx("strong",{children:"Conectar"})," para abrir o console USB."]}),'
    'b.jsxs("li",{children:["Wi-Fi e Bluetooth usam os atalhos ",b.jsx("code",{children:"Nova WiFi On / Nova WiFi Off"})," no app Atalhos do iPhone."]}),'
    'b.jsxs("li",{children:["A câmera exige jailbreak + OBSGraphBridge (",b.jsx("code",{children:"instalar-iphone.command"}),")."]})'
    ']}),'
    'b.jsx("p",{className:"text-[9px] text-white/30 uppercase tracking-widest leading-relaxed",children:"Conexão por IP, pareamento e busca na rede são exclusivos do Android (ADB)."})'
    ']})'
)


def inserir_guia_do_iphone(texto):
    bloco = texto.find(BLOCO_DE_CONEXAO)
    if bloco < 0:
        raise SystemExit('não achei o bloco de conexão')
    fim = fim_do_parentese(texto, texto.find('(', bloco + len('b.jsxs')))
    if texto[fim - 3:fim] != ']})':
        raise SystemExit('fim inesperado do bloco de conexão: ' + texto[fim - 12:fim])
    return texto[:fim - 3] + GUIA_IOS + texto[fim - 3:]


PASSOS_DA_CONEXAO = [
    Substituicao(INICIO_DAS_ABAS, PLATAFORMA + INICIO_DAS_ABAS, 'seletor iPhone | Android'),
    Substituicao(
        'b.jsx("button",{onClick:XG,disabled:v,className:"hidden sm:block px-2 py-1 bg-white/5 border border-white/10 hover:border-j-cyan/40 text-j-cyan rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",title:"Reiniciar ADB",children:"Reparar ADB"})',
        'pIsIos?b.jsx("span",{className:"hidden sm:block px-2 py-1 bg-white/5 border border-white/10 text-white/25 rounded-lg text-[9px] font-black uppercase tracking-wider cursor-not-allowed",title:"Exclusivo Android",children:"Reparar ADB"}):'
        'b.jsx("button",{onClick:XG,disabled:v,className:"hidden sm:block px-2 py-1 bg-white/5 border border-white/10 hover:border-j-cyan/40 text-j-cyan rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",title:"Reiniciar ADB",children:"Reparar ADB"})',
        'Reparar ADB só no Android',
    ),
    Substituicao(
        'b.jsxs("div",{className:"flex-1 overflow-auto p-6 bg-black/10",children:[',
        'b.jsxs("div",{className:"flex-1 overflow-auto p-6 bg-black/10",children:[' + BANNER,
        'faixa Modo iPhone',
    ),
    Substituicao(
        'children:"DISPOSITIVOS REAIS CONECTADOS"',
        'children:pIsIos?"IPHONES CONECTADOS":"ANDROIDS CONECTADOS"',
        'título dos dispositivos',
    ),
    Substituicao(
        'children:pIsIos?"IPHONES CONECTADOS":"ANDROIDS CONECTADOS"}),e.length===0?',
        'children:pIsIos?"IPHONES CONECTADOS":"ANDROIDS CONECTADOS"}),pDevices.length===0?',
        'estado vazio por plataforma',
    ),
    Substituicao(
        'children:"Nenhum dispositivo USB ou Wi-Fi detectado."',
        'children:pIsIos?"Nenhum iPhone conectado.":"Nenhum Android conectado."',
        'texto vazio (título)',
    ),
    Substituicao(
        'children:"Conecte seu celular via USB com a depuração USB ativada."',
        'children:pIsIos?"Conecte o iPhone por USB e toque em Confiar neste computador.":"Conecte o celular por USB com a Depuração USB ativada."',
        'texto vazio (dica)',
    ),
    Substituicao('children:e.map(', 'children:pDevices.map(', 'cartões de dispositivo filtrados'),
    Substituicao(
        'children:[b.jsxs("div",{className:"flex items-center gap-2",children:[b.jsx("button",{onClick:()=>g("direct")',
        'children:[b.jsxs("div",{className:"flex items-center gap-2",style:pIsIos?{opacity:.4,pointerEvents:"none"}:null,children:[b.jsx("button",{onClick:()=>g("direct")',
        'modos de conexão esmaecidos no iOS',
    ),
    Substituicao(
        'onClick:yG,disabled:v,className:"px-4 py-2 bg-j-cyan/10',
        'onClick:()=>pIsIos||yG(),disabled:v||pIsIos,style:pIsIos?{opacity:.4}:null,className:"px-4 py-2 bg-j-cyan/10',
        'busca na rede desabilitada no iOS',
    ),
    Substituicao('Q==="direct"&&', '!pIsIos&&Q==="direct"&&', 'form direto oculto no iOS'),
    Substituicao('Q==="pair"&&', '!pIsIos&&Q==="pair"&&', 'form pareamento oculto no iOS'),
    Substituicao('Q==="guide"&&', '!pIsIos&&Q==="guide"&&', 'guia Android oculto no iOS'),
    Substituicao(
        ',!pIsIos&&Q==="direct"&&b.jsxs("form"',
        ',pIsIos&&b.jsx("p",{className:"text-[8px] font-black text-white/25 uppercase tracking-widest",children:"Exclusivo Android · conexão por IP, pareamento e busca na rede usam ADB"}),!pIsIos&&Q==="direct"&&b.jsxs("form"',
        'aviso Exclusivo Android na conexão',
    ),
    Transformacao('guia do iPhone', inserir_guia_do_iphone),
]
