let db = null;
let isFirebaseInit = false;

const DEFAULT_FB_CONFIG = {
    apiKey: "__GOOGLE_API_KEY_NEUTRALIZADA__",
    projectId: "nova-client-app",
    appId: "1:180803893638:web:624614a3bf677f0dde9407"
};

function cabecalhoDoToken() {
    try {
        const token = JSON.parse(localStorage.getItem('nova_token')).token;
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch (e) {
        return {};
    }
}

function mostrarConfiguracaoNosCampos(config) {
    document.getElementById('fb-apikey').value = config.apiKey || '';
    document.getElementById('fb-projectid').value = config.projectId || '';
    document.getElementById('fb-appid').value = config.appId || '';
}

function configuracaoGuardada() {
    let localConfig = localStorage.getItem('fb_license_config');
    if (!localConfig) {
        localStorage.setItem('fb_license_config', JSON.stringify(DEFAULT_FB_CONFIG));
        localConfig = localStorage.getItem('fb_license_config');
    }
    return localConfig;
}

function mostrarConfiguracaoGuardada(localConfig) {
    if (!localConfig) return;
    try {
        mostrarConfiguracaoNosCampos(JSON.parse(localConfig));
    } catch(e) {}
}

function configuracaoCompleta(config) {
    return config.apiKey && config.projectId && config.appId;
}

function adotarConfiguracaoDoServidor(parsed, localConfig) {
    mostrarConfiguracaoNosCampos({ apiKey: parsed.apiKey, projectId: parsed.projectId, appId: parsed.appId });
    const configStr = JSON.stringify(parsed);
    if (configStr === localConfig) return;
    localStorage.setItem('fb_license_config', configStr);
    if (isFirebaseInit) {
        window.location.reload();
    }
}

async function sincronizarConfiguracaoDoServidor(localConfig) {
    try {
        const response = await fetch('/api/get-firebase-config', { headers: cabecalhoDoToken() });
        if (!response.ok) return;
        const parsed = await response.json();
        if (configuracaoCompleta(parsed)) adotarConfiguracaoDoServidor(parsed, localConfig);
    } catch (e) {
        console.info('[loadSavedConfig] API sync failed (running standalone/PWA mode):', e);
    }
}

async function loadSavedConfig() {
    const localConfig = configuracaoGuardada();
    mostrarConfiguracaoGuardada(localConfig);
    await sincronizarConfiguracaoDoServidor(localConfig);
}

function configuracaoLidaDosCampos() {
    return {
        apiKey: document.getElementById('fb-apikey').value.trim(),
        projectId: document.getElementById('fb-projectid').value.trim(),
        appId: document.getElementById('fb-appid').value.trim()
    };
}

async function enviarConfiguracaoAoServidor(config) {
    try {
        await fetch('/api/save-firebase-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...cabecalhoDoToken() },
            body: JSON.stringify(config)
        });
    } catch (e) {
        console.info('[saveFirebaseSettings] API sync failed (running standalone/PWA mode):', e);
    }
}

async function saveFirebaseSettings() {
    const config = configuracaoLidaDosCampos();

    if (!configuracaoCompleta(config)) {
        alert('Please enter all Firebase Configuration values');
        return;
    }

    localStorage.setItem('fb_license_config', JSON.stringify(config));
    await enviarConfiguracaoAoServidor(config);

    alert('Settings Saved! Refreshing connection...');
    window.location.reload();
}

function configuracaoDoFirestore(config) {
    return {
        apiKey: config.apiKey,
        authDomain: `${config.projectId}.firebaseapp.com`,
        projectId: config.projectId,
        storageBucket: `${config.projectId}.appspot.com`,
        appId: config.appId
    };
}

function sdkDoFirebase() {
    if (!globalThis.firebase) throw new ReferenceError('firebase is not defined');
    return globalThis.firebase;
}

function conectarAoFirebase(config, alertBox) {
    const firebaseConfig = configuracaoDoFirestore(config);
    const sdk = sdkDoFirebase();

    if (!sdk.apps.length) {
        sdk.initializeApp(firebaseConfig);
    }

    db = sdk.firestore();
    isFirebaseInit = true;
    alertBox.style.display = 'none';
    console.info('[Firebase] Connection initialized successfully.');
    globalThis.loadLicenses();
    globalThis.initAlertsListener();
}

function initFirebase() {
    const configStr = localStorage.getItem('fb_license_config');
    const alertBox = document.getElementById('db-alert');

    if (!configStr) {
        alertBox.style.display = 'block';
        return;
    }

    try {
        conectarAoFirebase(JSON.parse(configStr), alertBox);
    } catch (error) {
        alertBox.innerText = `⚠️ Falha na conexão com o Firebase: ${error.message}`;
        alertBox.style.display = 'block';
        console.error('[Firebase] Init Error:', error);
    }
}

function openFirebaseModal() {
    document.getElementById('firebase-modal').style.display = 'flex';
}

function closeFirebaseModal() {
    document.getElementById('firebase-modal').style.display = 'none';
}

function bancoPronto() {
    return isFirebaseInit && Boolean(db);
}

function bancoDoFirebase() {
    return db;
}

Object.assign(globalThis, { loadSavedConfig, saveFirebaseSettings, initFirebase, openFirebaseModal, closeFirebaseModal, bancoPronto, bancoDoFirebase });
