const CARACTERES_DA_CHAVE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function linhaDeAviso(cor, texto) {
    return `<tr><td colspan="9" style="text-align: center; color: ${cor}; padding: 30px;">${texto}</td></tr>`;
}

function dataDoRegistro(carimbo) {
    return carimbo ? new Date(carimbo.seconds * 1000).toLocaleDateString() : 'N/A';
}

function dadosDaLicenca(doc) {
    const data = doc.data();
    return {
        key: doc.id,
        plan: data.plan || 'basic',
        status: data.status || 'active',
        machineId: data.machineId || '',
        customerName: data.customerName || '—',
        customerMobile: data.customerMobile || '—',
        createdAt: dataDoRegistro(data.createdAt),
        activatedAt: dataDoRegistro(data.activatedAt)
    };
}

function contarLicenca(totais, { plan, status, machineId }) {
    if (status === 'active' && machineId) totais.active++;
    if (status === 'blocked') totais.blocked++;
    if (plan === 'basic') totais.basic++;
    if (plan === 'pro') totais.pro++;
}

function atributosDoBotaoResetar(machineId) {
    return !machineId ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : '';
}

function criarLinhaDaLicenca({ key, plan, status, machineId, customerName, customerMobile, createdAt, activatedAt }) {
    const tr = document.createElement('tr');
    const escName = customerName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escMobile = customerMobile.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    tr.innerHTML = `
                        <td style="font-weight: 700; color: white;">${key}</td>
                        <td><span class="badge ${plan}">${plan}</span></td>
                        <td style="font-weight: 600; color: #fff;">${customerName}</td>
                        <td>${customerMobile}</td>
                        <td><span style="font-size: 10px; opacity: ${machineId ? '1' : '0.2'}">${machineId || 'SEM VÍNCULO'}</span></td>
                        <td><span class="badge ${status}">${status}</span></td>
                        <td>${createdAt}</td>
                        <td>${machineId ? activatedAt : '—'}</td>
                        <td>
                            <div class="table-actions">
                                <button onclick="editCustomer('${key}', '${escName}', '${escMobile}')" class="btn-table-action cyan-hover">Editar Info</button>
                                <button onclick="clearMachine('${key}')" class="btn-table-action cyan-hover" ${atributosDoBotaoResetar(machineId)}>Resetar HW</button>
                                <button onclick="toggleBlock('${key}', '${status}')" class="btn-table-action">${status === 'active' ? 'Bloquear' : 'Ativar'}</button>
                                <button onclick="deleteKey('${key}')" class="btn-table-action danger-hover">Excluir</button>
                            </div>
                        </td>
                    `;
    return tr;
}

function desenharLicencas(tBody, snapshot) {
    const totais = { active: 0, basic: 0, pro: 0, blocked: 0 };

    tBody.innerHTML = '';

    if (snapshot.empty) {
        tBody.innerHTML = linhaDeAviso('var(--text-muted)', 'Nenhuma licença encontrada. Use o painel acima para gerar chaves.');
        updateStats(0, 0, 0, 0);
        return;
    }

    snapshot.forEach(doc => {
        const licenca = dadosDaLicenca(doc);
        contarLicenca(totais, licenca);
        tBody.appendChild(criarLinhaDaLicenca(licenca));
    });

    updateStats(totais.active, totais.basic, totais.pro, totais.blocked);
}

async function loadLicenses() {
    if (!globalThis.bancoPronto()) return;

    const tBody = document.getElementById('table-body');
    tBody.innerHTML = linhaDeAviso('var(--text-secondary)', 'Sincronizando grade de licenças...');

    try {
        const snapshot = await globalThis.bancoDoFirebase().collection('licenses').orderBy('createdAt', 'desc').get();
        desenharLicencas(tBody, snapshot);
    } catch (err) {
        tBody.innerHTML = linhaDeAviso('var(--error)', `Falha na consulta ao registro: ${err.message}`);
        console.error('[Firebase] Load Licenses Error:', err);
    }
}

function updateStats(active, basic, pro, blocked) {
    document.getElementById('stat-active').innerText = active;
    document.getElementById('stat-basic').innerText = basic;
    document.getElementById('stat-pro').innerText = pro;
    document.getElementById('stat-blocked').innerText = blocked;
}

async function clearMachine(key) {
    if (!confirm(`Tem certeza de que quer limpar o vínculo da máquina para a chave: ${key}? Isso permitirá a ativação em outro computador.`)) return;
    try {
        await globalThis.bancoDoFirebase().collection('licenses').doc(key).update({
            machineId: '',
            activatedAt: null
        });
        alert('ID da máquina limpo com sucesso!');
        loadLicenses();
    } catch (e) {
        alert(`Operação falhou: ${e.message}`);
    }
}

async function toggleBlock(key, currentStatus) {
    const nextStatus = currentStatus === 'active' ? 'blocked' : 'active';
    try {
        await globalThis.bancoDoFirebase().collection('licenses').doc(key).update({
            status: nextStatus
        });
        loadLicenses();
    } catch (e) {
        alert(`Operação falhou: ${e.message}`);
    }
}

async function deleteKey(key) {
    if (!confirm(`⚠️ ATENÇÃO: Tem certeza de que quer excluir a chave de licença: ${key}? Esta ação não pode ser desfeita.`)) return;
    try {
        await globalThis.bancoDoFirebase().collection('licenses').doc(key).delete();
        alert('Chave excluída do banco de dados.');
        loadLicenses();
    } catch (e) {
        alert(`Operação falhou: ${e.message}`);
    }
}

async function editCustomer(key, currentName, currentMobile) {
    const newName = prompt("Digite o Nome do Cliente:", currentName === '—' ? '' : currentName);
    if (newName === null) return;
    const newMobile = prompt("Digite o Número de Celular:", currentMobile === '—' ? '' : currentMobile);
    if (newMobile === null) return;

    try {
        await globalThis.bancoDoFirebase().collection('licenses').doc(key).update({
            customerName: newName.trim(),
            customerMobile: newMobile.trim()
        });
        alert('Informações do cliente atualizadas com sucesso.');
        loadLicenses();
    } catch (e) {
        alert(`Falha na atualização: ${e.message}`);
    }
}

function createRandomLicenseKey() {
    const segment = () => {
        let s = '';
        for (let i = 0; i < 4; i++) {
            s += CARACTERES_DA_CHAVE.charAt(Math.floor(Math.random() * CARACTERES_DA_CHAVE.length));
        }
        return s;
    };
    return `NOVA-${segment()}-${segment()}-${segment()}`;
}

async function gravarChaves(plan, qty, name, mobile) {
    let lastGeneratedKey = '';
    for (let i = 0; i < qty; i++) {
        const generated = createRandomLicenseKey();
        lastGeneratedKey = generated;

        await globalThis.bancoDoFirebase().collection('licenses').doc(generated).set({
            plan: plan,
            status: 'active',
            machineId: '',
            customerName: name || '',
            customerMobile: mobile || '',
            createdAt: globalThis.firebase.firestore.FieldValue.serverTimestamp(),
            activatedAt: null
        });
    }
    return lastGeneratedKey;
}

function mostrarChaveGerada(qty, lastGeneratedKey) {
    const popup = document.getElementById('gen-popup');
    const txt = document.getElementById('gen-key-txt');

    txt.innerText = qty === 1 ? lastGeneratedKey : `${qty} chaves geradas. Atualizado.`;
    popup.style.display = 'flex';
}

async function generateLicense() {
    if (!globalThis.bancoPronto()) {
        alert('Primeiro configure e salve os Ajustes do Firebase!');
        return;
    }

    const plan = document.getElementById('gen-plan').value;
    const qty = parseInt(document.getElementById('gen-qty').value, 10);
    const name = document.getElementById('gen-name').value.trim();
    const mobile = document.getElementById('gen-mobile').value.trim();

    try {
        const lastGeneratedKey = await gravarChaves(plan, qty, name, mobile);

        document.getElementById('gen-name').value = '';
        document.getElementById('gen-mobile').value = '';

        mostrarChaveGerada(qty, lastGeneratedKey);

        loadLicenses();
    } catch (e) {
        alert(`Falha na geração: ${e.message}`);
    }
}

function copyGeneratedKey() {
    const txt = document.getElementById('gen-key-txt').innerText;
    navigator.clipboard.writeText(txt).then(() => {
        alert('Chave copiada para a área de transferência!');
    }).catch(() => {
        alert('Falha ao copiar. Copie manualmente.');
    });
}

function closeToast() {
    document.getElementById('gen-popup').style.display = 'none';
}

Object.assign(globalThis, { loadLicenses, clearMachine, toggleBlock, deleteKey, editCustomer, generateLicense, copyGeneratedKey, closeToast });
