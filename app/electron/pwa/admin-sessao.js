const CHAVE_DA_SESSAO_DO_ADMIN = 'admin_sessao';

function cabecalhoDaSessaoDoAdmin() {
    return { 'X-Admin-Sessao': sessionStorage.getItem(CHAVE_DA_SESSAO_DO_ADMIN) || '' };
}

async function restaurarSessaoDoAdmin() {
    if (!sessionStorage.getItem(CHAVE_DA_SESSAO_DO_ADMIN)) return;
    try {
        const resposta = await fetch('/api/admin-sessao', { headers: cabecalhoDaSessaoDoAdmin() });
        if (resposta.ok) showDashboard();
        else sessionStorage.removeItem(CHAVE_DA_SESSAO_DO_ADMIN);
    } catch (e) {
        sessionStorage.removeItem(CHAVE_DA_SESSAO_DO_ADMIN);
    }
}

async function pedirSessaoDoAdmin(codigo) {
    try {
        const resposta = await fetch('/api/admin-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo })
        });
        const corpo = await resposta.json();
        return resposta.ok ? { sessao: corpo.sessao } : { erro: corpo.error || 'Acesso Negado' };
    } catch (e) {
        return { erro: 'Servidor do painel indisponível' };
    }
}

async function attemptAuthentication() {
    const campo = document.getElementById('passcode-input');
    const errLbl = document.getElementById('auth-error-lbl');
    const resultado = await pedirSessaoDoAdmin(campo.value);

    if (resultado.sessao) {
        sessionStorage.setItem(CHAVE_DA_SESSAO_DO_ADMIN, resultado.sessao);
        errLbl.style.display = 'none';
        showDashboard();
    } else {
        errLbl.textContent = resultado.erro;
        errLbl.style.display = 'block';
    }
    campo.value = '';
}

function showDashboard() {
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('dash-view').style.display = 'flex';
    document.querySelector('.admin-card').classList.add('dashboard-mode');
    globalThis.initFirebase();
}

function terminateSession() {
    fetch('/api/admin-logout', { method: 'POST', headers: cabecalhoDaSessaoDoAdmin() }).catch(() => {});
    sessionStorage.removeItem(CHAVE_DA_SESSAO_DO_ADMIN);
    document.getElementById('dash-view').style.display = 'none';
    document.getElementById('auth-view').style.display = 'flex';
    document.querySelector('.admin-card').classList.remove('dashboard-mode');
    globalThis.encerrarEscutaDosAlertas();
}

Object.assign(globalThis, { restaurarSessaoDoAdmin, attemptAuthentication, terminateSession });
