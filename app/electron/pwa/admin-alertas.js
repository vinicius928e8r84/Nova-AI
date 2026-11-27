let alertsListener = null;

function initAlertsListener() {
    const db = globalThis.bancoDoFirebase();
    if (!db) return;
    if (alertsListener) alertsListener();

    console.info('[Firebase] Initializing Security Alerts listener...');
    alertsListener = db.collection('security_alerts')
        .orderBy('timestamp', 'desc')
        .limit(50)
        .onSnapshot(snapshot => {
            renderAlerts(snapshot);
        }, error => {
            console.error('[Firebase Alerts Error]:', error);
        });
}

function mostrarSemAlertas(toggleBtn, alertsList) {
    toggleBtn.style.display = 'none';
    toggleBtn.innerText = '⚠️ 0 Alertas';
    toggleBtn.classList.remove('pulse-alert');
    alertsList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 30px; font-size: 12px;">Nenhum alerta de segurança detectado. Sistema seguro.</div>`;
}

function criarItemDoAlerta(doc) {
    const data = doc.data();
    const id = doc.id;
    const time = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleString() : 'N/A';

    const div = document.createElement('div');
    div.className = 'alert-item';
    div.innerHTML = `
                    <div class="alert-item-header">
                        <span class="alert-key">${data.licenseKey || 'UNKNOWN'}</span>
                        <span class="alert-time">${time}</span>
                    </div>
                    <div class="alert-details">
                        <strong>Motivo:</strong> ${data.details || 'Motivo não especificado'}
                    </div>
                    <div class="alert-ids">
                        <span><strong>ID da Máquina Tentada:</strong> ${data.attemptedMachineId || '—'}</span>
                        <span><strong>ID da Máquina Vinculada Original:</strong> ${data.boundMachineId || '—'}</span>
                    </div>
                    <button onclick="deleteAlert('${id}')" class="btn-resolve">Descartar Alerta</button>
                `;
    return div;
}

function renderAlerts(snapshot) {
    const toggleBtn = document.getElementById('btn-alerts-toggle');
    const alertsList = document.getElementById('alerts-list');

    if (snapshot.empty) {
        mostrarSemAlertas(toggleBtn, alertsList);
        return;
    }

    const alertCount = snapshot.size;
    toggleBtn.innerText = `⚠️ ${alertCount} Alerta${alertCount > 1 ? 's' : ''} de Segurança`;
    toggleBtn.style.display = 'flex';
    toggleBtn.classList.add('pulse-alert');

    alertsList.innerHTML = '';
    snapshot.forEach(doc => {
        alertsList.appendChild(criarItemDoAlerta(doc));
    });
}

async function deleteAlert(alertId) {
    if (!confirm('Tem certeza de que quer descartar este alerta?')) return;
    try {
        await globalThis.bancoDoFirebase().collection('security_alerts').doc(alertId).delete();
    } catch (e) {
        alert('Falha ao descartar alerta: ' + e.message);
    }
}

function openAlertsModal() {
    document.getElementById('alerts-modal').style.display = 'flex';
}

function closeAlertsModal() {
    document.getElementById('alerts-modal').style.display = 'none';
}

function encerrarEscutaDosAlertas() {
    if (alertsListener) {
        alertsListener();
        alertsListener = null;
    }
}

Object.assign(globalThis, { initAlertsListener, encerrarEscutaDosAlertas, deleteAlert, openAlertsModal, closeAlertsModal });
