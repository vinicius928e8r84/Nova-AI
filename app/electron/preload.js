const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onUpdateLog: (callback) => {
        const sub = (_event, value) => callback(value);
        ipcRenderer.on('update-log', sub);
        return () => ipcRenderer.removeListener('update-log', sub);
    },
    setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
    getZoomFactor: () => webFrame.getZoomFactor(),
    webviewBridgePath: ipcRenderer.sendSync('get-webview-bridge-path'),
    stealthPreloadPath: ipcRenderer.sendSync('get-stealth-preload-path'),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, callback) => {
        const subscription = (_event, ...args) => callback(...args);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
    },
    triggerSwarm: (command, apiKey) => ipcRenderer.invoke('trigger-swarm', { command, apiKey }),
    cancelSwarm: () => ipcRenderer.send('cancel-swarm'),
    onSwarmLog: (callback) => {
        const sub = (_event, data) => callback(data);
        ipcRenderer.on('swarm:log', sub);
        return () => ipcRenderer.removeListener('swarm:log', sub);
    },
    onSwarmStatus: (callback) => {
        const sub = (_event, data) => callback(data);
        ipcRenderer.on('swarm:status', sub);
        return () => ipcRenderer.removeListener('swarm:status', sub);
    },
    onSwarmTaskResult: (callback) => {
        const sub = (_event, data) => callback(data);
        ipcRenderer.on('swarm:task-result', sub);
        return () => ipcRenderer.removeListener('swarm:task-result', sub);
    },

    send: (channel, data) => ipcRenderer.send(channel, data),
    onActivateMic: (callback) => {
        const sub = (_event, val) => callback(val);
        ipcRenderer.on('activate-mic', sub);
        return () => ipcRenderer.removeListener('activate-mic', sub);
    },
    onActivateCamera: (callback) => {
        const sub = (_event, val) => callback(val);
        ipcRenderer.on('activate-camera', sub);
        return () => ipcRenderer.removeListener('activate-camera', sub);
    },
    onActivateMirror: (callback) => {
        const sub = (_event, val) => callback(val);
        ipcRenderer.on('activate-mirror', sub);
        return () => ipcRenderer.removeListener('activate-mirror', sub);
    },
    onOpenDownloader: (callback) => {
        const sub = (_event, val) => callback(val);
        ipcRenderer.on('open-downloader', sub);
        return () => ipcRenderer.removeListener('open-downloader', sub);
    },
    onOpenStudio: (callback) => {
        const sub = (_event, val) => callback(val);
        ipcRenderer.on('open-studio', sub);
        return () => ipcRenderer.removeListener('open-studio', sub);
    },
    onNovaAction: (callback) => {
        const sub = (_event, data) => callback(data);
        ipcRenderer.on('nova-action', sub);
        return () => ipcRenderer.removeListener('nova-action', sub);
    },

    onYtFloatingDownload: (callback) => {
        const sub = (_event, data) => callback(data);
        ipcRenderer.on('nova-yt-floating-download', sub);
        return () => ipcRenderer.removeListener('nova-yt-floating-download', sub);
    },
    
    virtualCam: {
        control: (payload) => ipcRenderer.invoke('virtual-cam:control', payload),
        onStatus: (callback) => {
            const sub = (event, data) => callback(data);
            ipcRenderer.on('virtual-cam:status', sub);
            return () => ipcRenderer.removeListener('virtual-cam:status', sub);
        },
        onInstallProgress: (callback) => {
            const sub = (event, data) => callback(data);
            ipcRenderer.on('virtual-cam:install-progress', sub);
            return () => ipcRenderer.removeListener('virtual-cam:install-progress', sub);
        },
        streamChunk: (arrayBuffer) => ipcRenderer.send('virtual-cam:stream-chunk', arrayBuffer),
        spoofRegistry: () => ipcRenderer.invoke('virtual-cam:spoof-registry'),
    },

    screenRecorder: {
        getSources: () => ipcRenderer.invoke('screen-recorder:get-sources'),
        saveRecording: (buffer, extension) => ipcRenderer.invoke('screen-recorder:save', { buffer, extension })
    },

    farm: {
        loadProfiles:      ()                      => ipcRenderer.invoke('farm:load-profiles'),
        addProfile:        (name, browser)         => ipcRenderer.invoke('farm:add-profile', { name, browser }),
        updateProfile:     (profileId, patch)      => ipcRenderer.invoke('farm:update-profile', { profileId, patch }),
        deleteProfile:     (profileId)             => ipcRenderer.invoke('farm:delete-profile', profileId),
        openLoginBrowser:  (profileId, platform)   => ipcRenderer.invoke('farm:open-login-browser', { profileId, platform }),
        checkProxy:        (profileId)             => ipcRenderer.invoke('farm:check-proxy', profileId),
        run:               (config)                => ipcRenderer.invoke('farm:run', config),
        stop:              ()                      => ipcRenderer.invoke('farm:stop'),
        backup:            ()                      => ipcRenderer.invoke('farm:backup'),
        restore:           (data)                  => ipcRenderer.invoke('farm:restore', data),
        onLog: (callback) => {
            const sub = (_e, data) => callback(data);
            ipcRenderer.on('farm:log', sub);
            return () => ipcRenderer.removeListener('farm:log', sub);
        },
        onProfileUpdate: (callback) => {
            const sub = (_e, data) => callback(data);
            ipcRenderer.on('farm:profile-update', sub);
            return () => ipcRenderer.removeListener('farm:profile-update', sub);
        },
        onStarted: (callback) => {
            const sub = (_e, data) => callback(data);
            ipcRenderer.on('farm:started', sub);
            return () => ipcRenderer.removeListener('farm:started', sub);
        },
        onBatchStart: (callback) => {
            const sub = (_e, data) => callback(data);
            ipcRenderer.on('farm:batch-start', sub);
            return () => ipcRenderer.removeListener('farm:batch-start', sub);
        },
        onCompleted: (callback) => {
            const sub = (_e, data) => callback(data);
            ipcRenderer.on('farm:completed', sub);
            return () => ipcRenderer.removeListener('farm:completed', sub);
        },
    },
    
    rtmp: {
        startBroadcast: () => ipcRenderer.invoke('rtmp:start-broadcast'),
        stopBroadcast: () => ipcRenderer.invoke('rtmp:stop-broadcast'),
        streamChunk: (buffer) => ipcRenderer.send('rtmp:video-chunk', buffer)
    }

});

// iPhone por USB: o modal "Conectar iPhone" é desenhado dentro desta janela,
// no mundo isolado do preload, em vez de abrir uma janela/página à parte.
try {
    const { attach: attachIphoneSetup } = require('./services/iphone-setup/inapp');
    attachIphoneSetup({ ipcRenderer });
} catch (error) {
    console.error('[Nova] Não foi possível preparar o modal do iPhone:', error);
}
