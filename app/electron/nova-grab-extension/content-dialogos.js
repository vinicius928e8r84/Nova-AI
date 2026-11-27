(function () {
  'use strict';

  function encurtar(texto, limite) {
    return texto.substring(0, limite) + (texto.length > limite ? '…' : '');
  }

  function criarDiv(estilo, texto) {
    const div = document.createElement('div');
    div.style.cssText = estilo;
    div.textContent = texto;
    return div;
  }

  function criarBotao(classe, texto, aoClicar) {
    const botao = document.createElement('button');
    botao.className = classe;
    botao.textContent = texto;
    if (aoClicar) botao.onclick = aoClicar;
    return botao;
  }

  function linhaDeBotoes(estilo, botoes) {
    const btnRow = document.createElement('div');
    btnRow.style.cssText = estilo;
    botoes.forEach(botao => btnRow.appendChild(botao));
    return btnRow;
  }

  function criarDialogo(id, topo, largura) {
    const dlg = document.createElement('div');
    dlg.id = id;
    dlg.className = 'ng-panel';
    dlg.style.cssText = [
      'position:fixed', `top:${topo}`, 'right:14px', 'z-index:2147483647',
      `width:${largura}`, 'animation:nova-dialog 0.25s ease-out',
    ].join(';');
    return dlg;
  }

  function criarBarraDeTitulo(html) {
    const titleBar = document.createElement('div');
    titleBar.className = 'ng-titlebar';
    titleBar.innerHTML = html;
    return titleBar;
  }

  function abrirDialogo(dlg, titleBar, conteudo) {
    dlg.appendChild(titleBar);
    conteudo.forEach(parte => dlg.appendChild(parte));
    document.body.appendChild(dlg);
    makeDraggable(dlg, titleBar);
  }

  function makeDraggable(el, handle) {
    let ox = 0, oy = 0, mx = 0, my = 0;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      ox = el.offsetLeft; oy = el.offsetTop;
      mx = e.clientX;     my = e.clientY;
      const onMove = e2 => {
        el.style.left = (ox + e2.clientX - mx) + 'px';
        el.style.top  = (oy + e2.clientY - my) + 'px';
        el.style.right = 'auto';
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  window.__novaGrabDialogos = { encurtar, criarDiv, criarBotao, linhaDeBotoes, criarDialogo, criarBarraDeTitulo, abrirDialogo, makeDraggable };
})();
