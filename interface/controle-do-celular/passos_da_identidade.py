from passos_de_patch import Substituicao

PROXY = (
    'pIsIos&&b.jsxs("div",{children:['
    'b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",children:"Proxy do dispositivo"}),'
    'b.jsxs("div",{className:"flex gap-2",children:['
    'b.jsx("input",{type:"text",value:pProxy,onChange:pE=>{pSetProxy(pE.target.value),pSetProxyMsg("")},placeholder:"socks5://host:porta:usuario:senha",className:"flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-white text-xs font-bold placeholder-white/20 focus:outline-none focus:border-purple-400/50"}),'
    'b.jsx("button",{onClick:pSaveProxy,className:"px-3 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/40 text-purple-200 text-[10px] font-black uppercase tracking-wider hover:bg-purple-500/20 transition-all",children:"Salvar"})'
    ']}),'
    'pProxyMsg&&b.jsx("p",{className:`text-[9px] mt-1 font-bold ${pProxyStatus==="error"?"text-red-400":"text-emerald-400"}`,children:pProxyMsg})'
    ']}),'
)

PASSOS_DA_IDENTIDADE = [
    Substituicao(
        'children:"DISPARADORES DE COMANDOS ROOT"}),b.jsxs("div",{className:"flex gap-3"',
        'children:"DISPARADORES DE COMANDOS ROOT"}),pIsIos&&b.jsx("span",{className:"text-[7px] font-black text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-1.5 py-0.5 uppercase tracking-wider",children:"Exclusivo Android"}),b.jsxs("div",{className:"flex gap-3"',
        'selo Android nos comandos root',
    ),
    Substituicao(
        'children:b.jsx("div",{className:`w-4 h-4 rounded-full bg-black transition-all ${B?"translate-x-6":"translate-x-0"}`})})]})]}),b.jsxs("div",{className:"border-t border-white/5 pt-6 space-y-3"',
        'children:b.jsx("div",{className:`w-4 h-4 rounded-full bg-black transition-all ${B?"translate-x-6":"translate-x-0"}`})})]})]}),pIsIos&&b.jsx("p",{className:"text-[9px] text-white/35 uppercase tracking-widest leading-relaxed",children:"No iPhone, Wi-Fi e Bluetooth são alternados pelos atalhos Nova WiFi On/Off do app Atalhos."}),b.jsxs("div",{className:"border-t border-white/5 pt-6 space-y-3"',
        'dica dos atalhos no iPhone',
    ),
    Substituicao(
        'b.jsx("button",{onClick:async()=>{SI&&(await SI.invoke("physical-mobile:control-app",{id:W,packageName:"",action:"reboot"})',
        'b.jsx("button",{disabled:pIsIos,style:pIsIos?{opacity:.4}:null,onClick:async()=>{SI&&(await SI.invoke("physical-mobile:control-app",{id:W,packageName:"",action:"reboot"})',
        'reiniciar desabilitado no iOS',
    ),
    Substituicao(
        'b.jsx("button",{onClick:async()=>{SI&&(await SI.invoke("physical-mobile:control-app",{id:W,packageName:"",action:"shutdown"})',
        'b.jsx("button",{disabled:pIsIos,style:pIsIos?{opacity:.4}:null,onClick:async()=>{SI&&(await SI.invoke("physical-mobile:control-app",{id:W,packageName:"",action:"shutdown"})',
        'desligar desabilitado no iOS',
    ),
    Substituicao(
        'b.jsxs("div",{children:[b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",children:"Marca"})',
        'b.jsxs("div",{style:pIsIos?{display:"none"}:null,children:[b.jsx("label",{className:"text-[9px] font-bold text-white/40 tracking-widest uppercase mb-1 block",children:"Marca"})',
        'Marca escondida no iPhone',
    ),
    Substituicao(
        'b.jsx("select",{value:D,onChange:eI=>dI(eI.target.value),className:"w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-white text-xs font-bold appearance-none focus:outline-none focus:border-purple-400/50 cursor-pointer",children:(lI[mI]||[]).map(eI=>b.jsxs("option",{value:eI.model,className:"bg-[#0A0F18] text-white",children:[eI.name," (",eI.model,")"]},eI.model))})',
        'b.jsx("select",{value:pIsIos?pIphoneModel:D,onChange:pIsIos?pE=>pSetIphoneModel(pE.target.value):eI=>dI(eI.target.value),className:"w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-white text-xs font-bold appearance-none focus:outline-none focus:border-purple-400/50 cursor-pointer",children:pIsIos?pIphoneModels.map(pM=>b.jsx("option",{value:pM,className:"bg-[#0A0F18] text-white",children:pM},pM)):(lI[mI]||[]).map(eI=>b.jsxs("option",{value:eI.model,className:"bg-[#0A0F18] text-white",children:[eI.name," (",eI.model,")"]},eI.model))})',
        'select de modelo do iPhone (7 a 18)',
    ),
    Substituicao(
        ',b.jsxs("button",{onClick:el,disabled:uI==="applying"||!D',
        ',' + PROXY + 'b.jsxs("button",{onClick:el,disabled:uI==="applying"||!D',
        'campo de proxy do iPhone',
    ),
    Substituicao(
        'onClick:el,disabled:uI==="applying"||!D,',
        'onClick:pIsIos?pSaveIos:el,disabled:pIsIos?!1:uI==="applying"||!D,',
        'ação do botão no iPhone',
    ),
    Substituicao(
        'uI==="applying"?"Aplicando Falsificação Profunda de IMEI...":"Aplicar Perfil de Falsificação Completo"',
        'pIsIos?"Salvar identidade do iPhone":uI==="applying"?"Aplicando Falsificação Profunda de IMEI...":"Aplicar Perfil de Falsificação Completo"',
        'rótulo do botão no iPhone',
    ),
    Substituicao(
        'children:[["Model",k.model],',
        'children:(k.ios?[["Modelo",k.model],["Proxy",k.proxy||"—"],["Perfil","Nova (salvo no app)"]]:[["Model",k.model],',
        'painel aplicado: iPhone',
    ),
    Substituicao(
        '["IMSI",k.imsi]].map(',
        '["IMSI",k.imsi]]).map(',
        'painel aplicado: fecha lista Android',
    ),
    Substituicao(
        'eI==="Model"?"text-white font-bold"',
        'eI==="Model"||eI==="Modelo"?"text-white font-bold"',
        'cor do campo Modelo',
    ),
    Substituicao(
        'uI==="success"&&b.jsxs("button",{onClick:sG',
        'uI==="success"&&!pIsIos&&b.jsxs("button",{onClick:sG',
        'soft reboot escondido no iPhone',
    ),
    Substituicao(
        '(uI==="success"||k)&&b.jsxs("button",{onClick:Kl',
        '(uI==="success"||k)&&!pIsIos&&b.jsxs("button",{onClick:Kl',
        'verificação Android escondida no iPhone',
    ),
    Substituicao(
        'b.jsxs("button",{onClick:fI,disabled:uI==="applying",className:"w-full py-2 bg-white/[0.03] border border-red-500/20 text-red-400/70 rounded-xl font-black text-[10px] uppercase tracking-widest hover:border-red-400/50 hover:text-red-300 transition-all flex items-center justify-center gap-2",children:[b.jsx(en,{size:10})," Restaurar identidade real e reiniciar"]})',
        'b.jsxs("button",{onClick:()=>pIsIos?pClearIos():fI(),disabled:uI==="applying",className:"w-full py-2 bg-white/[0.03] border border-red-500/20 text-red-400/70 rounded-xl font-black text-[10px] uppercase tracking-widest hover:border-red-400/50 hover:text-red-300 transition-all flex items-center justify-center gap-2",children:[b.jsx(en,{size:10}),pIsIos?" Remover identidade salva":" Restaurar identidade real e reiniciar"]})',
        'Restaurar vira Remover no iPhone',
    ),
    Substituicao(
        'b.jsxs("div",{className:"flex items-center gap-2 px-3 py-2 bg-black/30 border border-white/5 rounded-xl",children:[b.jsx("span",{className:"text-[8px] font-black text-white/30 uppercase tracking-widest mr-1",children:"Segurança:"})',
        '!pIsIos&&b.jsxs("div",{className:"flex items-center gap-2 px-3 py-2 bg-black/30 border border-white/5 rounded-xl",children:[b.jsx("span",{className:"text-[8px] font-black text-white/30 uppercase tracking-widest mr-1",children:"Segurança:"})',
        'chips de segurança escondidos no iPhone',
    ),
    Substituicao(
        'b.jsxs("div",{className:"mt-1 space-y-1.5",children:[b.jsx("span",{className:"text-[9px] font-black text-white/30 uppercase tracking-widest block",children:"Propriedades Play Integrity Injetadas"})',
        '!pIsIos&&b.jsxs("div",{className:"mt-1 space-y-1.5",children:[b.jsx("span",{className:"text-[9px] font-black text-white/30 uppercase tracking-widest block",children:"Propriedades Play Integrity Injetadas"})',
        'Play Integrity escondido no iPhone',
    ),
    Substituicao(
        'b.jsxs("div",{className:"mt-2 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl space-y-2",children:[',
        '!pIsIos&&b.jsxs("div",{className:"mt-2 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl space-y-2",children:[',
        'IMEI duplo escondido no iPhone',
    ),
    Substituicao(
        'b.jsxs("div",{className:"mt-2 p-4 bg-gradient-to-r from-blue-900/10 to-purple-900/10 border border-blue-500/15 rounded-2xl space-y-3",children:[',
        '!pIsIos&&b.jsxs("div",{className:"mt-2 p-4 bg-gradient-to-r from-blue-900/10 to-purple-900/10 border border-blue-500/15 rounded-2xl space-y-3",children:[',
        'certificação Play Store escondida no iPhone',
    ),
]
