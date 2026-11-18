const { app, BrowserWindow, ipcMain, powerSaveBlocker, nativeImage, desktopCapturer, Tray, Menu } = require('electron');
const { spawn } = require('child_process');
const macNative = require('./services/mac-native');
if (process.platform === 'darwin') {
 process.env.PATH = [pathForBin(), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':');
}
function pathForBin() { return require('path').join(process.resourcesPath || __dirname, 'bin'); }

const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { dialog, shell } = require('electron');
const mime = require('mime-types');
const si = require('systeminformation');
const screenshot = require('screenshot-desktop');

console.log('[SYSTEM-WAKEUP] System Restored: Awaiting Fresh Command');
const axios = require('axios');
const { clipboard, Notification } = require('electron');
const http = require('http');
require('dotenv').config();
if (process.env.NOVA_SMOKE_TEST === '1') {
 const scratch=require('path').resolve(process.env.NOVA_SMOKE_DIR || require('path').join(require('os').tmpdir(),'nova-mac-smoke'));
 require('fs').mkdirSync(scratch,{recursive:true});
 app.setPath('userData',scratch);
 app.setPath('documents',scratch);
 app.setPath('downloads',scratch);
 app.on('web-contents-created',(_,contents)=>{
  if (contents.getType()!=='window')return;
  contents.on('did-finish-load',()=>setTimeout(async()=>{
   try {
    const data=await contents.executeJavaScript('JSON.stringify({title:document.title,url:location.href,text:document.body.innerText.slice(0,500),rootChildren:document.getElementById("root")?.children.length,api:typeof window.electronAPI})');
    const image=await contents.capturePage();
    require('fs').writeFileSync(require('path').join(scratch,'screen.png'),image.toPNG());
    require('fs').writeFileSync(require('path').join(scratch,'result.json'),data);
    console.log('[SMOKE-PASS]',data);
    app.exit(0);
   } catch(e) {console.error('[SMOKE-FAIL]',e);app.exit(2);}
  },8000));
 });
 setTimeout(()=>app.exit(3),45000).unref();
}


app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Ignore GPU blocklist so Electron can use available GPU without crashing
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-sandbox');

// Global User-Agent spoofing to prevent Google from detecting Electron
app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0';

app.whenReady().then(() => {
  powerSaveBlocker.start('prevent-app-suspension');
});

let remoteAccessService = null;
let wakeWordProcess = null;
const WhatsAppManager = require('./services/whatsapp-manager');
let whatsappManager = null;

const TelegramManager = require('./services/telegram-manager');
let telegramManager = null;

const YtDlpManager = require('./services/ytdlp-manager');
let ytdlpManager = null;

const AgentSwarmController = require('./services/agent-swarm-controller');
let agentSwarmController = null;

const NovaHumanController = require('./services/nova-human-controller');
let novaHumanController = null;

const AntigravityController = require('./services/antigravity-controller');
let antigravityController = null;

const { analyzeUserGraph, getUserContext } = require('./services/user-profile-manager');

const VirtualCamInjector = require('./services/virtual-cam-injector');
let virtualCamInjector = null;

const NovaStudioController = require('./services/nova-studio-controller');
let novaStudioController = null;

const BrowserFarmService = require('./services/browserFarmService');
let browserFarmService = new BrowserFarmService(null);
browserFarmService.loadProfiles();

const RtmpServerService = require('./services/rtmp-server');


// Production Server for YouTube embeds (file:// origin is blocked by YouTube)
let productionServer = null;
let productionPort = process.env.NOVA_TEST_PORT || 45678;

const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const { autoUpdater } = require('electron-updater');
const { hasUpdateConfig, edgeTtsBinary } = require('./services/paridade-utils');
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// Disable signature verification for unsigned builds
autoUpdater.verifySourceSignature = false;
autoUpdater.verifyUpdaterSignature = false;
console.log('Auto-Updater logic: Signature verification disabled.');

// FORCE DEV UPDATE CONFIG (For testing without building)
if (process.env.NODE_ENV === 'development') {
  autoUpdater.forceDevUpdateConfig = true;
  console.log('FORCE DEV UPDATE CONFIG ENABLED');
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
let tray = null; // Prevent garbage collection of the system tray icon

autoUpdater.logger = {
  info(text) {
    console.log(text);
    if (typeof mainWindow !== 'undefined' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-log', text);
    }
  },
  warn(text) {
    console.warn(text);
    if (typeof mainWindow !== 'undefined' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-log', `WARN: ${text}`);
    }
  },
  error(text) {
    console.error(text);
    if (typeof mainWindow !== 'undefined' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-log', `ERROR: ${text}`);
    }
  }
};


const { GoogleGenerativeAI } = require('@google/generative-ai');

let powerSaveId = null;



const migrateStonicToNova = () => {
  try {
    const documentsPath = app.getPath('documents');
    const oldDocsPath = path.join(documentsPath, 'Stonic Data');
    const newDocsPath = path.join(documentsPath, 'Nova Data');
    const oldVaultPath = path.join(documentsPath, 'Stonic_Vault');
    const newVaultPath = path.join(documentsPath, 'Nova_Vault');

    if (!fs.existsSync(newDocsPath) && fs.existsSync(oldDocsPath)) {
      console.log('[Migration] Copying Nova Data...');
      fs.mkdirSync(newDocsPath, { recursive: true });
      const files = fs.readdirSync(oldDocsPath);
      files.forEach(file => {
        const src = path.join(oldDocsPath, file);
        const dest = path.join(newDocsPath, file);
        if (fs.lstatSync(src).isFile()) {
          fs.copyFileSync(src, dest);
        }
      });
    }

    if (!fs.existsSync(newVaultPath) && fs.existsSync(oldVaultPath)) {
        console.log('[Migration] Renaming old vault to Nova_Vault...');
        fs.renameSync(oldVaultPath, newVaultPath);
    }

    const newUserData = app.getPath('userData');
    const oldUserData = path.join(path.dirname(newUserData), 'Stonic AI');

    if (fs.existsSync(oldUserData) && oldUserData !== newUserData) {
      const filesToMigrate = [
        'memories.json', 'user_profile.json', 'dashboard_settings.json', 
        'imported_folders.json', 'history.json', 'history_settings.json', 
        'contacts.json', 'notes.json', 'tasks.json', 'secret_key.json', 
        'groq_key.json', 'openrouter_key.json', 'thinking_settings.json', 
        'gemini_preference.json', 'chats.json', 'custom_models.json', 
        'whatsapp_settings.json'
      ];

      filesToMigrate.forEach(file => {
        const src = path.join(oldUserData, file);
        const dest = path.join(newUserData, file);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          console.log(`[Migration] Copying ${file} to new profile...`);
          fs.copyFileSync(src, dest);
        }
      });
    }
  } catch (error) {
    console.error('[Migration] Failed:', error);
  }
};

const ensureNovaDirectories = () => {
  try {
    migrateStonicToNova();
    const notesPath = path.join(app.getPath('documents'), 'Nova Data');
    if (!fs.existsSync(notesPath)) {
      fs.mkdirSync(notesPath, { recursive: true });
      console.log('Created Nova Data directory:', notesPath);
    }
    return notesPath;
  } catch (error) {
    console.error('Failed to create Nova directories:', error);
    return null;
  }
};

function openIphoneConsole() {
  const consoleWin = new BrowserWindow({
    width: 1080, height: 800,
    title: 'Console do iPhone',
    backgroundColor: '#050a10',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  consoleWin.loadURL('http://127.0.0.1:' + require('./services/ios-bridge').PORT + '/');
}

function createWindow() {
  ensureNovaDirectories();

  const trayIconPath = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '../public/nova.ico')
    : path.join(process.resourcesPath, 'public', process.platform === 'darwin' ? 'nova-icon.png' : 'nova.ico');

  if (fs.existsSync(trayIconPath)) {
    try {
      tray = new Tray(nativeImage.createFromPath(trayIconPath).resize({width:18,height:18}));
      const contextMenu = Menu.buildFromTemplate([
        ...(require('./services/ios-tools').available() ? [{ label: 'Console do iPhone', click: openIphoneConsole }, { type: 'separator' }] : []),
        { label: 'Nova AI — Mostrar Janela', click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.maximize();
              mainWindow.focus();
            }
        }},
        { label: 'Ocultar Janela', click: () => { if (mainWindow) mainWindow.hide(); }},
        { type: 'separator' },
        { label: 'Sair do Nova', click: () => { app.quit(); }}
      ]);
      tray.setContextMenu(contextMenu);
      tray.setToolTip('Nova AI');
      tray.on('click', () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.maximize();
          mainWindow.focus();
        }
      });
      console.log('[Nova] System tray icon created.');
    } catch (err) {
      console.error('[Nova] Failed to create system tray icon:', err);
    }
  }

  mainWindow = new BrowserWindow({
    title: 'Nova AI',
    width: 1400,
    height: 900,
    show: true,
    frame: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    backgroundColor: '#020406',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      backgroundThrottling: false,
    },
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(
      process.env.NODE_ENV === 'development'
        ? path.join(__dirname, '../public/nova.ico')
        : path.join(process.resourcesPath, 'public', process.platform === 'darwin' ? 'nova-icon.png' : 'nova.ico')
    )
  });

  if (process.platform === 'darwin') {
    mainWindow.on('close', event => {
      if (isShuttingDown()) return;
      event.preventDefault();
      app.quit();
    });
  }

  const appMenuTemplate = menuTemplate(process.platform);
  if (appMenuTemplate) Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate));
  if (process.platform !== 'win32') mainWindow.setMenu(null);

  // Set app ID for proper Windows taskbar grouping
  app.setAppUserModelId('com.nova.ai');


  mainWindow.show();
  mainWindow.focus();

  // After 2s turn off alwaysOnTop (only needed during startup)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.maximize();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(false);
      console.log('[Nova] Window maximized and focused.');
    }
  }, 2000);



  // Prevent GPU crash from killing entire process — log and continue
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Nova] Renderer process gone:', details.reason, details.exitCode);
    if (details.reason !== 'clean-exit') {
      console.log('[Nova] Attempting recovery...');
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (process.env.NODE_ENV === 'development') {
            mainWindow.loadURL('http://localhost:5173');
          } else {
            mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
          }
        }
      }, 2000);
    }
  });

  app.getGeminiToken = async () => {
    try {
      const p = getSecretKeyPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.apiKey || data.geminiKey || process.env.GEMINI_API_KEY || null;
      }
      return process.env.GEMINI_API_KEY || null;
    } catch (e) {
      console.error('[Brain-Link] Error fetching token:', e);
      return process.env.GEMINI_API_KEY || null;
    }
  };

  if (!ytdlpManager) {
    ytdlpManager = new YtDlpManager(mainWindow, app);
    app.ytdlpManager = ytdlpManager; 
  } else {
    ytdlpManager.mainWindow = mainWindow;
  }

  if (!virtualCamInjector) {
    virtualCamInjector = new VirtualCamInjector(mainWindow, app, browserFarmService);
    app.virtualCamInjector = virtualCamInjector;
  } else {
    virtualCamInjector.mainWindow = mainWindow;
  }
  if (!agentSwarmController) {
    agentSwarmController = new AgentSwarmController(mainWindow, app);
    app.agentSwarmController = agentSwarmController;
  } else {
    agentSwarmController.mainWindow = mainWindow;
  }

  if (!novaHumanController) {
    novaHumanController = new NovaHumanController(mainWindow, app);
    app.novaHumanController = novaHumanController;
  } else {
    novaHumanController.mainWindow = mainWindow;
  }

  if (!antigravityController) {
    antigravityController = new AntigravityController(mainWindow, app);
    app.antigravityController = antigravityController;
  } else {
    antigravityController.mainWindow = mainWindow;
  }

  if (!novaStudioController) {
    novaStudioController = new NovaStudioController(mainWindow, app);
    app.novaStudioController = novaStudioController;
  } else {
    novaStudioController.mainWindow = mainWindow;
  }
  const PhysicalMobileService = require('./services/physicalMobileService');
  if (!app.physicalMobileService) {
    app.physicalMobileService = new PhysicalMobileService(mainWindow, app);
  } else {
    app.physicalMobileService.mainWindow = mainWindow;
  }

  app.physicalMobileService.camLiveIphone = app.camLiveService?.iphone;

  const LiveCamBridgeService = require('./services/live-cam-bridge');
  if (!app.liveCamBridgeService) {
    app.liveCamBridgeService = new LiveCamBridgeService(mainWindow, app, app.physicalMobileService);
  } else {
    app.liveCamBridgeService.mainWindow = mainWindow;
  }

  browserFarmService.mainWindow = mainWindow;

  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      mainWindow.moveTop();
      console.log('[Nova] Page loaded — window visible.');
    }
  });

  setTimeout(async () => {
    if (isShuttingDown()) return;
    try {
      const p = getWhatsAppSettingsPath();
      if (fs.existsSync(p)) {
        const settings = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (settings.autoConnect) {
          console.log('[WhatsApp] Auto-connecting service...');
          if (!whatsappManager) {
            whatsappManager = new WhatsAppManager(mainWindow, app);
          } else {
            whatsappManager.updateMainWindow(mainWindow);
          }
          await whatsappManager.initialize();
        }
      }
    } catch (e) {
      console.error('[WhatsApp] Auto-connect failed:', e);
    }
  }, 5000); // 5-second delay to let app settle

  setTimeout(async () => {
    if (isShuttingDown()) return;
    try {
      console.log('[Telegram] Auto-connecting service...');
      if (!telegramManager) {
        telegramManager = new TelegramManager(mainWindow, app);
      } else {
        telegramManager.updateMainWindow(mainWindow);
      }
      await telegramManager.autoConnect();
    } catch (e) {
      console.error('[Telegram] Auto-connect failed:', e);
    }
  }, 6000); // 6-second delay to let app settle





  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    startProductionServer().then(port => {
      mainWindow.loadURL(`http://localhost:${port}/index.html`);
    }).catch(err => {
      console.error('Failed to start production server:', err);
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  }

  return mainWindow;
}

function startProductionServer() {
  return new Promise((resolve, reject) => {
    const distPath = path.join(__dirname, '../dist');

    productionServer = http.createServer((req, res) => {
      let filePath = path.join(distPath, req.url === '/' ? 'index.html' : req.url);

      // Security: prevent directory traversal
      if (!filePath.startsWith(distPath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const extname = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.ico': 'image/x-icon'
      };

      const contentType = mimeTypes[extname] || 'application/octet-stream';

      fs.readFile(filePath, (error, content) => {
        if (error) {
          if (error.code === 'ENOENT') {
            fs.readFile(path.join(distPath, 'index.html'), (err, indexContent) => {
              if (err) {
                res.writeHead(500);
                res.end('Server Error');
              } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(indexContent, 'utf-8');
              }
            });
          } else {
            res.writeHead(500);
            res.end(`Server Error: ${error.code}`);
          }
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content, 'utf-8');
        }
      });
    });

    productionServer.listen(productionPort, '127.0.0.1', () => {
      console.log(`Production server running at http://localhost:${productionPort}`);
      resolve(productionPort);
    });

    productionServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        productionPort++;
        productionServer.listen(productionPort, '127.0.0.1');
      } else {
        reject(err);
      }
    });
  });
}


function setupPermissions(session) {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (process.env.NOVA_SMOKE_TEST === '1') return callback(false);
    const allowedPermissions = ['media', 'camera', 'microphone', 'videoCapture', 'audioCapture', 'desktopCapture'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // CRITICAL: Also override the permission CHECK handler so Electron never
  // silently blocks camera access without even asking (which causes the alert).
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (process.env.NOVA_SMOKE_TEST === '1') return false;
    const allowedPermissions = ['media', 'camera', 'microphone', 'videoCapture', 'audioCapture', 'desktopCapture'];
    if (allowedPermissions.includes(permission)) {
      return true;
    }
    return false;
  });

  // Google Login Bypass for Pro Core and Nova Studio
  const stealthSessions = [
    session.defaultSession,
    session.fromPartition('persist:gemini_session'),
    session.fromPartition('persist:nova_global_brain')
  ];

  const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0';

  stealthSessions.forEach(ses => {
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['*://*.google.com/*', '*://*.youtube.com/*'] },
      (details, callback) => {
        details.requestHeaders['User-Agent'] = USER_AGENT;
        delete details.requestHeaders['sec-ch-ua'];
        delete details.requestHeaders['sec-ch-ua-mobile'];
        delete details.requestHeaders['sec-ch-ua-platform'];
        callback({ cancel: false, requestHeaders: details.requestHeaders });
      }
    );
  });
}

const getMemoryPath = () => path.join(app.getPath('userData'), 'memories.json');
const getUserProfilePath = () => path.join(app.getPath('userData'), 'user_profile.json');
const getDashboardSettingsPath = () => path.join(app.getPath('userData'), 'dashboard_settings.json');
const getFolderConfigPath = () => path.join(app.getPath('userData'), 'imported_folders.json');
const getVaultPath = () => path.join(app.getPath('documents'), 'Nova_Vault');
const getHistoryPath = () => path.join(app.getPath('userData'), 'history.json');
const getHistorySettingsPath = () => path.join(app.getPath('userData'), 'history_settings.json');
const getContactsPath = () => path.join(app.getPath('userData'), 'contacts.json');
const getNotesPath = () => path.join(app.getPath('userData'), 'notes.json');
const getTasksPath = () => path.join(app.getPath('userData'), 'tasks.json');
const getSecretKeyPath = () => path.join(app.getPath('userData'), 'secret_key.json');
const getGroqKeyPath = () => path.join(app.getPath('userData'), 'groq_key.json');
const getOpenRouterKeyPath = () => path.join(app.getPath('userData'), 'openrouter_key.json');
const getThinkingSettingsPath = () => path.join(app.getPath('userData'), 'thinking_settings.json');
const getGeminiPreferencePath = () => path.join(app.getPath('userData'), 'gemini_preference.json');
const getChildAgentModelPath = () => path.join(app.getPath('userData'), 'child_agent_model.json');
const getChildAgentKeyPath   = () => path.join(app.getPath('userData'), 'child_agent_key.json');
const getNovaVoicePath       = () => path.join(app.getPath('userData'), 'nova_voice.json');
const getChatsPath = () => path.join(app.getPath('userData'), 'chats.json');
const getCustomModelsPath = () => path.join(app.getPath('userData'), 'custom_models.json');
const getWhatsAppSettingsPath = () => path.join(app.getPath('userData'), 'whatsapp_settings.json');
const getGoogleKeyPath = () => path.join(app.getPath('userData'), 'google_key.json');
const getVisualSettingsPath = () => path.join(app.getPath('userData'), 'visual_settings.json');
const getElevenLabsSettingsPath = () => path.join(app.getPath('userData'), 'elevenlabs_settings.json');
const getWaApiKeyPath = () => path.join(app.getPath('userData'), 'wa_api_key.json');
const getBackupConfigPath = () => path.join(process.cwd(), 'config_bak_C.dat');

const syncConfigurationBackup = () => {
  try {
    const userData = app.getPath('userData');
    const backupPath = getBackupConfigPath();
    const filesToSync = [
      'secret_key.json', 'whatsapp_settings.json', 'dashboard_settings.json',
      'thinking_settings.json', 'gemini_preference.json', 'visual_settings.json',
      'elevenlabs_settings.json', 'google_key.json', 'groq_key.json', 'openrouter_key.json'
    ];

    const backupData = {};
    filesToSync.forEach(file => {
      const p = path.join(userData, file);
      if (fs.existsSync(p)) {
        try {
          backupData[file] = JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) { console.error(`Failed to pack ${file}:`, e); }
      }
    });

    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    return { success: true, count: Object.keys(backupData).length };
  } catch (error) {
    console.error('Backup failed:', error);
    return { success: false, error: error.message };
  }
};

const restoreConfigurationBackup = () => {
  try {
    const backupPath = getBackupConfigPath();
    if (!fs.existsSync(backupPath)) return { success: false, error: 'Backup file not found' };

    const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const userData = app.getPath('userData');
    let count = 0;

    Object.keys(backupData).forEach(file => {
      const p = path.join(userData, file);
      fs.writeFileSync(p, JSON.stringify(backupData[file], null, 2));
      count++;
    });

    return { success: true, count };
  } catch (error) {
    console.error('Restore failed:', error);
    return { success: false, error: error.message };
  }
};

// This user-requested local build does not use activation keys or the vendor license service.
const getLocalEditionStatus = () => ({plan:'pro',status:'active',edition:'mac-local',activationRequired:false});

// Confere se o iPhone Console (servidor local do ios-bridge) já aceita conexões.
function novaIosConsolePortOpen(port) {
  return new Promise((resolve) => {
    const socket = require('net').connect({ host: '127.0.0.1', port, timeout: 800 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

function registerHandlers() {
  ipcMain.on('get-webview-bridge-path', (event) => {
    event.returnValue = path.join(__dirname, 'webview-bridge.js');
  });

  ipcMain.on('get-stealth-preload-path', (event) => {
    event.returnValue = path.join(__dirname, 'google-stealth-preload.js');
  });


  ipcMain.handle('rtmp:start-broadcast', async () => {
    try {
      await RtmpServerService.startBroadcast();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('rtmp:stop-broadcast', async () => {
    try {
      await RtmpServerService.stopBroadcast();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.on('rtmp:video-chunk', (event, buffer) => {
    RtmpServerService.receiveVideoChunk(buffer);
  });

  // CAMLIVE:begin
  try { app.camLiveService = require('./services/cam-live-service').register({ ipcMain, getWindow: () => mainWindow, userDataDir: app.getPath('userData'), getMobileService: () => app.physicalMobileService }); } catch (e) { console.error('[CamLive] falhou ao registrar:', e); }
  // CAMLIVE:end

  ipcMain.handle('physical-mobile:get-status', async () => {
    return app.physicalMobileService.getStatus();
  });
  ipcMain.handle('physical-mobile:connect-wifi', async (event, ipAddress) => {
    return app.physicalMobileService.connectWifi(ipAddress);
  });
  ipcMain.handle('physical-mobile:disconnect', async (event, id) => {
    return app.physicalMobileService.disconnectDevice(id);
  });
  ipcMain.handle('physical-mobile:start-stream', async (event, id) => {
    // iPhone: nenhuma janela externa. O modal de senha é desenhado dentro do Nova.
    if (String(id).startsWith('ios-')) {
      const setup = require('./services/iphone-setup/setup');
      const result = setup.prompt(mainWindow, { id: String(id) });
      // O nome do aparelho chega depois (ideviceinfo); o modal não espera por ele.
      app.physicalMobileService.getStatus().then((status) => {
        const device = (status.devices || []).find((item) => item.id === id);
        if (device && device.name && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('nova:iphone-setup-open', { id: String(id), name: device.name });
        }
      }).catch(() => { /* segue com o identificador do aparelho */ });
      return result;
    }
    return app.physicalMobileService.startStream(id);
  });
  ipcMain.handle('physical-mobile:iphone-prepare', async (event, data) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { success: false, error: 'Janela do Nova indisponível.' };
    const { id, password } = data || {};
    if (!id) return { success: false, error: 'Selecione um iPhone conectado.' };
    let result;
    try { result = await require('./services/iphone-setup/setup').prepare(String(id), password, app.physicalMobileService); }
    catch (e) { return { success: false, error: e.message }; }
    // O cartão do aparelho troca "Conectar" por "Abrir controle" na hora.
    if (result && result.success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('physical-mobile:status-updated', { deviceId: String(id), streaming: true });
    }
    return result;
  });
  ipcMain.handle('physical-mobile:ios-console-open', async (event, id) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { success: false, error: 'Janela do Nova indisponível.' };
    if (!id) return { success: false, error: 'Selecione um iPhone conectado.' };
    mainWindow.webContents.send('nova:iphone-console-open', { id: String(id) });
    return { success: true };
  });
  ipcMain.handle('physical-mobile:ios-console-url', async () => {
    try {
      const iosBridge = require('./services/ios-bridge');
      const started = iosBridge.isRunning() ? null : iosBridge.start();
      if (started && started.ok === false) return { success: false, error: started.error };
      const port = Number(iosBridge.PORT) || 8778;
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        if (await novaIosConsolePortOpen(port)) return { success: true, url: 'http://127.0.0.1:' + port + '/' };
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return { success: false, error: 'O controle do iPhone não iniciou. Feche e reabra o Nova.' };
    } catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('physical-mobile:ios-console', async (event, id) => {
    return app.physicalMobileService.iosStartStream(id);
  });
  ipcMain.handle('physical-mobile:stop-stream', async (event, id) => {
    return app.physicalMobileService.stopStream(id);
  });
  ipcMain.handle('physical-mobile:toggle-setting', async (event, { id, setting, enable }) => {
    return app.physicalMobileService.toggleSetting(id, setting, enable);
  });
  ipcMain.handle('physical-mobile:control-app', async (event, { id, packageName, action }) => {
    return app.physicalMobileService.controlApp(id, packageName, action);
  });
  ipcMain.handle('physical-mobile:automate-browser', async (event, { id, url, searchText }) => {
    return app.physicalMobileService.automateBrowser(id, url, searchText);
  });
  ipcMain.handle('iphone:proxy:set', async (event, { id, proxy }) => {
    return app.physicalMobileService.iosProxySet(id, proxy);
  });
  ipcMain.handle('iphone:proxy:clear', async (event, { id }) => {
    return app.physicalMobileService.iosProxyClear(id);
  });
  ipcMain.handle('iphone:proxy:status', async (event, { id }) => {
    return app.physicalMobileService.iosProxyStatus(id);
  });
  ipcMain.handle('iphone:proxy:check', async (event, { id }) => {
    return app.physicalMobileService.iosProxyCheck(id);
  });
  // Spoofing de modelo do iPhone (novamodel) — painel "Identidade simulada".
  // Contrato com a UI (branch agent/frontend/modelo-iphone-20261105): nomes exatos.
  ipcMain.handle('spoofer:get-ios-models', async () => {
    return app.physicalMobileService.getIosModels();
  });
  ipcMain.handle('spoofer:apply-ios-model', async (event, { deviceId, productType }) => {
    return app.physicalMobileService.applyIOSModel(deviceId, productType);
  });
  ipcMain.handle('spoofer:clear-ios-model', async (event, { deviceId }) => {
    return app.physicalMobileService.clearIOSModel(deviceId);
  });
  ipcMain.handle('spoofer:get-ios-model', async (event, { deviceId }) => {
    return app.physicalMobileService.getIOSModel(deviceId);
  });
  ipcMain.handle('physical-mobile:auto-pair-wireless', async (event, { id }) => {
    return app.physicalMobileService.autoPairUsbToWireless(id);
  });
  ipcMain.handle('physical-mobile:scan-wifi-devices', async () => {
    return app.physicalMobileService.scanWifiDevices();
  });
  ipcMain.handle('physical-mobile:restart-adb', async () => {
    return app.physicalMobileService.restartAdbServer();
  });
  ipcMain.handle('physical-mobile:pair-wireless', async (event, { ip, port, pairingCode }) => {
    return app.physicalMobileService.pairWirelessDevice(ip, port, pairingCode);
  });
  ipcMain.handle('physical-mobile:ensure-tools', async (event, force) => {
    return app.physicalMobileService.ensureTools(force);
  });

  ipcMain.handle('physical-mobile:get-cam-spoof-status', async (event, { id }) => {
    return app.physicalMobileService.getCamSpoofStatus(id);
  });
  ipcMain.handle('physical-mobile:install-cam-spoofer', async (event, { id }) => {
    return app.physicalMobileService.installCamSpoofer(id);
  });
  ipcMain.handle('physical-mobile:start-cam-spoof', async (event, { id, videoPath }) => {
    return app.physicalMobileService.startCamSpoof(id, videoPath);
  });
  ipcMain.handle('physical-mobile:stop-cam-spoof', async (event, { id }) => {
    return app.physicalMobileService.stopCamSpoof(id);
  });

  ipcMain.handle('physical-mobile:start-live-stream', async (event, { id, port }) => {
    return app.physicalMobileService.startLiveStream(id, port || 8899);
  });
  // push-live-frame: called at 30fps — use 'on' not 'handle' for perf
  ipcMain.on('physical-mobile:push-live-frame', (event, { frame }) => {
    app.physicalMobileService.pushLiveFrame(frame);
  });
  ipcMain.handle('physical-mobile:stop-live-stream', async (event, { id }) => {
    return app.physicalMobileService.stopLiveStream(id);
  });
  ipcMain.handle('physical-mobile:frida-inject', async (event, { id, app: appName }) => {
    return app.physicalMobileService.fridaInject(id, appName);
  });
  ipcMain.handle('physical-mobile:trigger-lsposed-broadcast', async (event, { id, port }) => {
    const p = port || 8899;
    return new Promise((resolve) => {
        const { exec } = require('child_process');
        const broadcastCmd = `"${app.physicalMobileService.adbPath}" -s ${id} shell am broadcast -a com.nova.action.START_LIVE_STREAM --es stream_url "http://127.0.0.1:${p}/stream"`;
        exec(broadcastCmd, { timeout: 10000 }, (err) => {
            if (err) {
                const suCmd = `"${app.physicalMobileService.adbPath}" -s ${id} shell su -c "am broadcast -a com.nova.action.START_LIVE_STREAM --es stream_url 'http://127.0.0.1:${p}/stream'"`;
                exec(suCmd, { timeout: 10000 }, () => resolve({ success: true, message: 'Hook de Hardware LSPosed Ativado!' }));
            } else {
                resolve({ success: true, message: 'Hook de Hardware LSPosed Ativado!' });
            }
        });
    });
  });

  ipcMain.handle('live-cam-bridge:get-status', async () => {
    return app.liveCamBridgeService.getStatus();
  });
  ipcMain.handle('live-cam-bridge:start-server', async (event, port) => {
    return app.liveCamBridgeService.startServer(port || 8899);
  });
  ipcMain.handle('live-cam-bridge:stop-server', async () => {
    return app.liveCamBridgeService.stopServer();
  });
  ipcMain.on('live-cam-bridge:push-pc-frame', (event, frame) => {
    app.liveCamBridgeService.pushPcFrame(frame);
  });
  ipcMain.handle('live-cam-bridge:set-spoof-video', async (event, { filePath, meta }) => {
    return app.liveCamBridgeService.setSpoofVideo(filePath, meta || {});
  });
  ipcMain.handle('live-cam-bridge:set-selected-ip', async (event, ip) => {
    return app.liveCamBridgeService.setSelectedIp(ip);
  });
  ipcMain.handle('live-cam-bridge:broadcast-spoof-cmd', async (event, command) => {
    app.liveCamBridgeService.broadcastSpoofCommand(command);
    return { success: true };
  });
  ipcMain.handle('live-cam-bridge:select-spoof-video', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Vídeo ou Foto Falsa para Sequestro de Câmera Celular/PC',
      filters: [
        { name: 'Video & Photo Files', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'jpg', 'jpeg', 'png', 'bmp'] },
        { name: 'Video Files', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] },
        { name: 'Image / Photos', extensions: ['jpg', 'jpeg', 'png', 'bmp'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      const stats = fs.statSync(selectedPath);
      const filename = path.basename(selectedPath);
      app.liveCamBridgeService.setSpoofVideo(selectedPath, {
        filename,
        size: stats.size,
        lastModified: stats.mtimeMs
      });
      return { success: true, filePath: selectedPath, filename, size: stats.size };
    }
    return { canceled: true };
  });

  // Identidade simulada: registrado depois do createWindow (precisa do physicalMobileService).
  ipcMain.handle('spoofer:get-models', async () => {
    return app.physicalMobileService.getSpooferModels();
  });
  ipcMain.handle('spoofer:apply-profile', async (event, { deviceId, brand, model, customImei }) => {
    return app.physicalMobileService.applySpoofProfile(deviceId, brand, model, customImei || null);
  });
  ipcMain.handle('spoofer:set-location', async (event, { deviceId, latitude, longitude }) => {
    return app.physicalMobileService.setSpoofLocation(deviceId, latitude, longitude);
  });
  ipcMain.handle('spoofer:stop-gps', async (event, { deviceId }) => {
    return app.physicalMobileService.stopFakeGPS(deviceId);
  });
  ipcMain.handle('spoofer:geo-from-proxy', async (event, { deviceId, proxy }) => {
    return app.physicalMobileService.geoFromProxy(deviceId, proxy);
  });
  ipcMain.handle('spoofer:apply-locale', async (event, { deviceId, timezone, countryCode }) => {
    return app.physicalMobileService.iosApplyLocale(deviceId, timezone, countryCode);
  });
  ipcMain.handle('spoofer:revert-locale', async (event, { deviceId }) => {
    return app.physicalMobileService.iosRevertLocale(deviceId);
  });
  ipcMain.handle('spoofer:reboot-device', async (event, { deviceId }) => {
    return app.physicalMobileService.rebootDevice(deviceId);
  });
  ipcMain.handle('spoofer:reset', async (event, { deviceId }) => {
    return app.physicalMobileService.resetSpoof(deviceId);
  });
  ipcMain.handle('spoofer:get-gsf-id', async (event, { deviceId }) => {
    return app.physicalMobileService.getGSFAndroidId(deviceId);
  });
  ipcMain.handle('spoofer:generate-random', async (event, { deviceId, preferredBrand }) => {
    return app.physicalMobileService.generateRandomProfile(deviceId, preferredBrand || null);
  });
  ipcMain.handle('spoofer:apply-dual-imei', async (event, { deviceId, imei1, imei2 }) => {
    return app.physicalMobileService.applyDualIMEI(deviceId, imei1, imei2);
  });
  ipcMain.handle('spoofer:verify-profile', async (event, { deviceId }) => {
    return app.physicalMobileService.verifyAppliedProfile(deviceId);
  });


  // Compatibility channels used by the shipped renderer. No key is read, stored or sent.
  ipcMain.handle('license:get-status', async () => getLocalEditionStatus());
  ipcMain.handle('license:verify', async () => ({success:true,...getLocalEditionStatus()}));
  ipcMain.handle('license:save', async () => true);

  ipcMain.handle('wakeword:start', async () => {
    try {
      console.log('[IPC] Starting Wake Word Detector via IPC request...');
      startWakeWordDetector(mainWindow);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('wakeword:stop', async () => {
    try {
      console.log('[IPC] Stopping Wake Word Detector via IPC request...');
      if (wakeWordProcess) {
        wakeWordProcess.kill();
        wakeWordProcess = null;
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-custom-models', async () => {
    try {
      const p = getCustomModelsPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return { openRouter: [], gemini: [] };
    } catch (e) { return { openRouter: [], gemini: [] }; }
  });

  ipcMain.handle('save-custom-models', async (event, models) => {
    try {
      fs.writeFileSync(getCustomModelsPath(), JSON.stringify(models, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('get-ytdl-stats', async () => {
    return { totalDownloads: 0 };
  });

  ipcMain.handle('start-autonomous-download', async (event, { searchQuery, format, type, chatId }) => {
    if (app.ytdlpManager) {
      await app.ytdlpManager.smartDownload(searchQuery, format, type, chatId || 'self');
      return true;
    }
    return false;
  });

  ipcMain.handle('smart-ytdl-check-confirm', async (event, message) => {
    if (app.ytdlpManager) {
      return await app.ytdlpManager.handleConfirmation(message);
    }
    return false;
  });

  ipcMain.handle('fetch-youtube-url', async (event, query) => {
    if (app.agentSwarmController) {
      return await app.agentSwarmController.executeVisibleYouTubeDownload(query);
    }
    return null;
  });
  ipcMain.handle('focus-app', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  ipcMain.handle('screen-recorder:get-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], fetchWindowIcons: true });
      return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL()
      }));
    } catch (e) {
      console.error('[Main] get-sources failed:', e);
      return [];
    }
  });

  ipcMain.handle('screen-recorder:save', async (event, { buffer, extension }) => {
    const tempWebmPath = path.join(app.getPath('temp'), `nova_temp_rec_${Date.now()}.webm`);
    let finalSavePath = null;
    try {
      fs.writeFileSync(tempWebmPath, Buffer.from(buffer));

      const defaultExt = extension || 'mp4';
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Salvar Gravação de Tela',
        defaultPath: path.join(app.getPath('videos'), `Nova_Record_${Date.now()}.${defaultExt}`),
        filters: [
          { name: 'Video File', extensions: [defaultExt] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!filePath) {
        if (fs.existsSync(tempWebmPath)) fs.unlinkSync(tempWebmPath);
        return { success: false, cancelled: true };
      }

      finalSavePath = filePath;

      let ffmpegPath = path.join(process.cwd(), 'resources', 'bin', (process.platform === 'darwin' ? 'ffmpeg' : 'ffmpeg.exe'));
      if (!fs.existsSync(ffmpegPath)) {
        ffmpegPath = path.join(process.resourcesPath, 'bin', (process.platform === 'darwin' ? 'ffmpeg' : 'ffmpeg.exe'));
      }
      if (!fs.existsSync(ffmpegPath)) {
        ffmpegPath = 'ffmpeg';
      }

      console.log('[Main] FFmpeg path for remuxing:', ffmpegPath);

      const lowerPath = filePath.toLowerCase();
      let args = [];
      if (lowerPath.endsWith('.mp4')) {
        args = ['-y', '-i', tempWebmPath, '-c', 'copy', '-movflags', '+faststart', filePath];
      } else {
        args = ['-y', '-i', tempWebmPath, '-c', 'copy', filePath];
      }

      const { execFile } = require('child_process');
      await new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, { windowsHide: true }, (error, stdout, stderr) => {
          if (error) {
            console.error('[Main] FFmpeg remuxing error:', error, stderr);
            reject(error);
          } else {
            console.log('[Main] FFmpeg remuxing complete.');
            resolve();
          }
        });
      });

      if (fs.existsSync(tempWebmPath)) fs.unlinkSync(tempWebmPath);

      shell.showItemInFolder(filePath);
      return { success: true, filePath };

    } catch (e) {
      console.error('[Main] save-recording failed, falling back to direct write:', e);
      
      // Fallback: if conversion failed for any reason, write raw file so we don't lose the user's data!
      if (finalSavePath) {
        try {
          fs.writeFileSync(finalSavePath, Buffer.from(buffer));
          shell.showItemInFolder(finalSavePath);
          return { success: true, filePath: finalSavePath, fallback: true };
        } catch (fallbackError) {
          console.error('[Main] Fallback write failed:', fallbackError);
        }
      }
      
      if (fs.existsSync(tempWebmPath)) {
        try { fs.unlinkSync(tempWebmPath); } catch (_) {}
      }

      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('set-clipboard', async (event, text) => {
    try {
      clipboard.writeText(String(text));
      console.log('[Main] Clipboard set for Pro Core injection.');
      return { success: true };
    } catch (e) {
      console.error('[Main] set-clipboard failed:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('direct-nova-download', async (event, { query, attempt = 1 }) => {
    if (app.novaHumanController) {
      return await app.novaHumanController.executeHumanDownload(query, attempt);
    }
    return { success: false, error: 'Controller not initialized' };
  });

  ipcMain.on('retry-human-download', async (event, query) => {
    if (app.novaHumanController) {
        await app.novaHumanController.executeHumanDownload(query, 2);
    }
  });

  ipcMain.handle('antigravity:prepare', async (event, { prompt }) => {
    if (app.antigravityController) {
      return await app.antigravityController.preparePrompt(prompt);
    }
    return { success: false, error: 'Antigravity Controller not initialized' };
  });

  ipcMain.handle('antigravity:confirm', async () => {
    if (app.antigravityController) {
      const success = await app.antigravityController.confirmAndExecute();
      return { success };
    }
    return { success: false, error: 'Antigravity Controller not initialized' };
  });

  ipcMain.handle('antigravity:cancel', async () => {
    if (app.antigravityController) {
      app.antigravityController.pendingPrompt = null;
      app.antigravityController.stopMonitoring();
      app.antigravityController.log('Pending prompt cancelled by user.');
      app.antigravityController.restoreWindow();
      await app.antigravityController.minimizeEditor();
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('antigravity:close', async () => {
    if (app.antigravityController) {
      const success = await app.antigravityController.closeEditor();
      return { success };
    }
    return { success: false };
  });

  ipcMain.handle('antigravity:minimize', async () => {
    if (app.antigravityController) {
      app.antigravityController.stopMonitoring();
      app.antigravityController.restoreWindow();
      const success = await app.antigravityController.minimizeEditor();
      return { success };
    }
    return { success: false };
  });

  ipcMain.handle('antigravity:maximize', async () => {
    if (app.antigravityController) {
      const success = await app.antigravityController.maximizeEditor();
      return { success };
    }
    return { success: false };
  });

  ipcMain.on('nova-self', (event, data) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    switch(data.action) {
      case 'window-minimize':
        mainWindow.minimize(); 
        break;
      case 'window-maximize':
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
        break;
      case 'window-restore':
        mainWindow.restore(); 
        break;
      
      case 'mic-on':
        mainWindow.webContents.send('ui-command-trigger', { component: 'sensors', type: 'mic', action: 'turn_on' });
        break;
      case 'mic-off':
        mainWindow.webContents.send('ui-command-trigger', { component: 'sensors', type: 'mic', action: 'turn_off' });
        break;
      case 'camera-on':
        mainWindow.webContents.send('ui-command-trigger', { component: 'sensors', type: 'camera', action: 'turn_on' });
        break;
      case 'camera-off':
        mainWindow.webContents.send('ui-command-trigger', { component: 'sensors', type: 'camera', action: 'turn_off' });
        break;
      case 'camera-snapshot':
        mainWindow.webContents.send('ui-command-trigger', { component: 'camera', action: 'snapshot' });
        break;
      case 'mood-detect-on':
        mainWindow.webContents.send('ui-command-trigger', { component: 'camera', action: 'mood-detect' });
        break;
      case 'screen-mirror-on':
        mainWindow.webContents.send('ui-command-trigger', { component: 'sensors', type: 'screen', action: 'turn_on' });
        break;
      case 'screen-mirror-off':
        mainWindow.webContents.send('ui-command-trigger', { component: 'sensors', type: 'screen', action: 'turn_off' });
        break;
      case 'downloader-open':
        mainWindow.webContents.send('ui-command-trigger', { component: 'downloader', action: 'open' });
        break;
      case 'downloader-close':
        mainWindow.webContents.send('ui-command-trigger', { component: 'downloader', action: 'close' });
        break;
      case 'downloader-folder':
        shell.openPath(path.join(os.homedir(), 'Downloads', 'Nova Downloads'));
        break;
      case 'chat-open':
        mainWindow.webContents.send('ui-command-trigger', { component: 'window', action: 'chat_open' });
        break;
      case 'chat-close':
        mainWindow.webContents.send('ui-command-trigger', { component: 'window', action: 'chat_close' });
        break;
      case 'chat-clear':
        mainWindow.webContents.send('nova-action', { component: 'chat', action: 'clear' });
        break;
      case 'agentic-mode-on':
        mainWindow.webContents.send('nova-action', { component: 'agentic', action: 'on' });
        break;
      case 'agentic-mode-off':
        mainWindow.webContents.send('nova-action', { component: 'agentic', action: 'off' });
        break;
      case 'voice-male':
        mainWindow.webContents.send('nova-action', { component: 'voice', action: 'male' });
        break;
      case 'voice-female':
        mainWindow.webContents.send('nova-action', { component: 'voice', action: 'female' });
        break;
      case 'analytics-open':
        mainWindow.webContents.send('nova-action', { component: 'analytics', action: 'open' });
        break;
      case 'history-open':
        mainWindow.webContents.send('nova-action', { component: 'history', action: 'open' });
        break;
      case 'youtube-play':
        if (data.videoId) {
          mainWindow.webContents.send('ui-command-trigger', {
            component: 'youtube',
            action: 'play',
            videoId: data.videoId
          });
          console.log('[Main] Nova Player: Playing videoId:', data.videoId);
        }
        break;
    }
  });

  ipcMain.handle('dialog:open-file', async (event, options) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, options || { properties: ['openFile'] });
    if (result.canceled) return null;
    return result;
  });

  ipcMain.handle('open-media-dialog', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'jpg', 'jpeg', 'png'] }
        ]
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('open-audio-dialog', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Audio Files', extensions: ['wav'] }
        ]
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

    ipcMain.handle('virtual-cam:control', async (event, payload) => {
    if (!virtualCamInjector) return { error: 'Virtual Camera Service not initialized' };

    const { action, filePath, buffer, settings } = payload;

    try {
        switch (action) {
            case 'detect':
                return await virtualCamInjector.detectDriver();

            case 'list-profiles':
                return virtualCamInjector.globalSpoof.listProfiles();

            // Canvas Bridge: no filePath needed — canvas chunks arrive via stream-chunk
            case 'hijack': {
                const p = virtualCamInjector.globalSpoof.disableAllPhysicalCams();
                if (p && typeof p.catch === 'function') {
                    p.catch(e => console.warn('[Main] disableAllPhysicalCams:', e.message));
                }
                const result = await virtualCamInjector.startHijack(buffer, settings);
                return result;
            }

            case 'restore':
                return await virtualCamInjector.stopHijack();

            case 'status':
                return virtualCamInjector.getStatus();

            case 'install-driver':
                return await virtualCamInjector.installDriver();

            case 'install-guide':
                shell.openExternal('https://github.com/CatxFish/obs-virtual-cam/releases/tag/2.0.4');
                return { success: true };

            default:
                return { error: `Unsupported action: ${action}` };
        }
    } catch (err) {
        console.error('[Main:GlobalSpoof] Command failed:', err.message);
        const isNoDriver = err.message && err.message.startsWith('NO_DRIVER:');
        return {
            error: isNoDriver ? err.message.replace('NO_DRIVER: ', '') : err.message,
            noDriver: isNoDriver,
        };
    }
  });

  ipcMain.handle('virtual-cam:update-regional', async (event, regional) => {
    if (!virtualCamInjector) return { success: false, error: 'Service not initialized' };
    try {
        const result = await virtualCamInjector.globalSpoof.updateRegional(regional);
        try {
            const { browserService } = require('./services/browser-manager');
            if (browserService && typeof browserService.updateRegional === 'function') {
                await browserService.updateRegional(regional);
            }
        } catch (err) {
            console.error('[Main] Failed to update browserService regional:', err.message);
        }
        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
  });

  ipcMain.handle('virtual-cam:update-transform', async (event, { zoom, rotate, mirror }) => {
    if (!virtualCamInjector) return { success: false };
    try {
        virtualCamInjector.globalSpoof.broadcastTransform(zoom, rotate, mirror);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
  });


  ipcMain.handle('virtual-cam:spoof-registry', async () => {
    if (!virtualCamInjector) return { success: false, error: 'Service not initialized' };
    try {
        const result = await virtualCamInjector.globalSpoof.spoofRegistryName();
        if (result.success) virtualCamInjector.globalSpoof.registrySpoofed = true;
        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
  });

  // Re-enables all physical camera devices that were disabled by Spoof Cam's
  // disableAllPhysicalCams() at the Windows Device Manager level.
  // Safe to call even when cameras are already enabled (no-op in that case).
  ipcMain.handle('enable-physical-cameras', async () => {
    if (process.platform === 'darwin') return { success: true, output: 'macOS camera devices are managed by System Settings.' };
    return new Promise((resolve) => {
      const psCommand = `
        $cameras = Get-PnpDevice | Where-Object { $_.Class -eq 'Camera' -or $_.Class -eq 'Image' };
        if ($cameras) {
          $cameras | ForEach-Object {
            try { Enable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue } catch {}
          };
          Write-Output "OK:$($cameras.Count)"
        } else { Write-Output "OK:0" }
      `.trim();

      const ps = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command', psCommand
      ]);

      let out = '';
      ps.stdout.on('data', d => { out += d.toString(); });
      ps.stderr.on('data', d => { console.warn('[CamRestore] PS stderr:', d.toString()); });

      ps.on('close', (code) => {
        const success = out.trim().startsWith('OK');
        console.log(`[CamRestore] Physical cameras re-enabled. Output: ${out.trim()} | Exit: ${code}`);
        resolve({ success, output: out.trim() });
      });

      ps.on('error', (err) => {
        console.error('[CamRestore] PowerShell spawn error:', err.message);
        resolve({ success: false, error: err.message });
      });
    });
  });



  ipcMain.on('virtual-cam:stream-chunk', (event, arrayBuffer) => {
    if (virtualCamInjector) {
        // arrayBuffer from frontend comes across IPC as a Uint8Array/Buffer in Electron
        virtualCamInjector.writeChunk(Buffer.from(arrayBuffer));
    }
  });





  ipcMain.handle('execute-ui-command', async (event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;

    if (payload.component === 'window') {
        switch (payload.action) {
            case 'minimize': mainWindow.minimize(); break;
            case 'maximize': 
                if (mainWindow.isMaximized()) mainWindow.unmaximize();
                else mainWindow.maximize();
                break;
            case 'fullscreen': mainWindow.setFullScreen(!mainWindow.isFullScreen()); break;
            case 'restore': 
                mainWindow.show(); 
                mainWindow.restore();
                break;
            case 'close': mainWindow.close(); break;
        }
    }

    mainWindow.webContents.send('ui-command-trigger', payload);
    return true;
  });

  ipcMain.on('trigger-system-log', (event, { text }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const ts = new Date().toLocaleTimeString([], { hour12: false });
        mainWindow.webContents.send('swarm:log', { 
            agent: 'nova', 
            text: `[${ts}] [NOVA] → ${text}` 
        });
    }
  });

  ipcMain.handle('trigger-swarm-status', async (event, { agentId, status, progress }) => {
    if (app.agentSwarmController) {
      app.agentSwarmController.setStatus(agentId, status, progress);
      return true;
    }
    return false;
  });

  ipcMain.handle('trigger-swarm-log', async (event, { agent, text }) => {
    if (app.agentSwarmController) {
      app.agentSwarmController.log(agent, text);
      return true;
    }
    return false;
  });

  ipcMain.handle('save-child-agent-model', async (event, model) => {
    try {
      fs.writeFileSync(getChildAgentModelPath(), JSON.stringify({ model, updatedAt: Date.now() }, null, 2));
      return true;
    } catch(e) { return false; }
  });
  ipcMain.handle('get-child-agent-model', async () => {
    try {
      const p = getChildAgentModelPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.model || 'gemini-3.8-flash';
      }
      return 'gemini-3.8-flash';
    } catch(e) { return 'gemini-3.8-flash'; }
  });
  ipcMain.handle('save-nova-voice', async (event, voice) => {
    try {
      fs.writeFileSync(getNovaVoicePath(), JSON.stringify({ voice, updatedAt: Date.now() }, null, 2));
      return true;
    } catch(e) { return false; }
  });
  ipcMain.handle('get-nova-voice', async () => {
    try {
      const p = getNovaVoicePath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.voice || 'female';
      }
      return 'female';
    } catch(e) { return 'female'; }
  });

  ipcMain.handle('save-child-agent-key', async (event, apiKey) => {
    try {
      fs.writeFileSync(getChildAgentKeyPath(), JSON.stringify({ apiKey, updatedAt: Date.now() }, null, 2));
      return true;
    } catch(e) { return false; }
  });
  ipcMain.handle('get-child-agent-key', async () => {
    try {
      const p = getChildAgentKeyPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.apiKey || '';
      }
      return '';
    } catch(e) { return ''; }
  });

  ipcMain.handle('select-media-file', async (event, type) => {
    let filters = [];
    if (type === 'video') filters = [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov'] }];
    else if (type === 'audio') filters = [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac'] }];
    else filters = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }];
    
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('select-directory', async (event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('select-multiple-media', async (event, type) => {
    const filters = type === 'video' 
      ? [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov'] }]
      : [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac'] }];
    
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: filters
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths;
    }
    return null;
  });

  ipcMain.handle('save-youtube-settings', async (event, { geminiKey, clientSecret, selectedVideoPath, selectedThumbnailPath }) => {
    try {
      const ytDir = path.join(__dirname, '..', 'youtube_auto');
      if (!fs.existsSync(ytDir)) {
        try {
            fs.mkdirSync(ytDir, { recursive: true });
        } catch(e) {
            return { success: false, error: "Failed to create youtube_auto folder. Permission denied." };
        }
      }
      
      if (geminiKey !== undefined) {
        const envPath = path.join(ytDir, '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : 'VIDEO_DIR=./videos\nDEFAULT_PRIVACY=private\nDEFAULT_CATEGORY=22\nWHISPER_MODEL=base\n';
        
        if (envContent.includes('GEMINI_API_KEY=')) {
          envContent = envContent.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${geminiKey}`);
        } else {
          envContent += `\nGEMINI_API_KEY=${geminiKey}`;
        }

        if (selectedVideoPath !== undefined) {
          if (envContent.includes('SELECTED_VIDEO_PATH=')) {
            envContent = envContent.replace(/SELECTED_VIDEO_PATH=.*/g, `SELECTED_VIDEO_PATH=${selectedVideoPath}`);
          } else {
            envContent += `\nSELECTED_VIDEO_PATH=${selectedVideoPath}`;
          }
        }

        if (selectedThumbnailPath !== undefined) {
          if (envContent.includes('SELECTED_THUMBNAIL_PATH=')) {
            envContent = envContent.replace(/SELECTED_THUMBNAIL_PATH=.*/g, `SELECTED_THUMBNAIL_PATH=${selectedThumbnailPath}`);
          } else {
            envContent += `\nSELECTED_THUMBNAIL_PATH=${selectedThumbnailPath}`;
          }
        }

        try {
            fs.writeFileSync(envPath, envContent);
        } catch(e) {
            return { success: false, error: "Failed to write .env file. Permission denied." };
        }
      }
      
      if (clientSecret !== undefined && clientSecret.trim().length > 0) {
        try {
            JSON.parse(clientSecret);
        } catch(e) {
            return { success: false, error: "Invalid JSON format in client_secret.json. Please check your copy-paste." };
        }
        const csPath = path.join(ytDir, 'client_secret.json');
        try {
            fs.writeFileSync(csPath, clientSecret);
        } catch(e) {
            return { success: false, error: "Failed to write client_secret.json. Permission denied." };
        }
      }
      return { success: true };
    } catch(e) {
      console.error('Failed to save YouTube settings:', e);
      return { success: false, error: `System error: ${e.message}` };
    }
  });

  ipcMain.handle('get-youtube-settings', async () => {
    try {
      const ytDir = path.join(__dirname, '..', 'youtube_auto');
      let geminiKey = '';
      let clientSecret = '';
      let selectedVideoPath = '';
      let selectedThumbnailPath = '';
      
      const envPath = path.join(ytDir, '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const matchGemini = envContent.match(/GEMINI_API_KEY=(.*)/);
        if (matchGemini) geminiKey = matchGemini[1].trim();

        const matchVideo = envContent.match(/SELECTED_VIDEO_PATH=(.*)/);
        if (matchVideo) selectedVideoPath = matchVideo[1].trim();

        const matchThumb = envContent.match(/SELECTED_THUMBNAIL_PATH=(.*)/);
        if (matchThumb) selectedThumbnailPath = matchThumb[1].trim();
      }
      
      const csPath = path.join(ytDir, 'client_secret.json');
      if (fs.existsSync(csPath)) {
        clientSecret = fs.readFileSync(csPath, 'utf8');
      }
      
      return { geminiKey, clientSecret, selectedVideoPath, selectedThumbnailPath };
    } catch (e) {
      return { geminiKey: '', clientSecret: '' };
    }
  });
  ipcMain.handle('get-exported-files', async () => {
    try {
      const exportsDir = path.join(__dirname, '..', 'youtube_auto', 'exports');
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
        return [];
      }
      
      const files = fs.readdirSync(exportsDir);
      const exportsList = files
        .filter(file => {
          try { return fs.statSync(path.join(exportsDir, file)).isFile(); } catch(e) { return false; }
        })
        .map(file => {
          const fullPath = path.join(exportsDir, file);
          const stats = fs.statSync(fullPath);
          return {
            name: file,
            path: fullPath,
            size: stats.size,
            created: stats.birthtime.toISOString()
          };
        });
      exportsList.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
      return exportsList;
    } catch (e) {
      console.error('Error fetching exported files:', e);
      return [];
    }
  });

  ipcMain.handle('open-file', async (event, filePath) => {
    try {
      const { shell } = require('electron');
      const error = await shell.openPath(filePath);
      if (error) {
        console.error('Failed to open file:', error);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Failed to open file exception:', e);
      return false;
    }
  });

  ipcMain.handle('delete-file', async (event, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return true;
    } catch (e) {
      console.error('Error deleting file:', e);
      return false;
    }
  });

  ipcMain.handle('save-file', async (event, sourcePath, fileName) => {
    try {
      const { dialog } = require('electron');
      const win = require('electron').BrowserWindow.getFocusedWindow();
      const { filePath } = await dialog.showSaveDialog(win, {
        title: 'Salvar Vídeo',
        defaultPath: fileName,
        filters: [{ name: 'Videos', extensions: ['mp4'] }]
      });
      if (filePath) {
        fs.copyFileSync(sourcePath, filePath);
        return true;
      }
      return false;
    } catch (e) {
      console.error('Failed to save file:', e);
      return false;
    }
  });

  const KlingVideoService = require('./services/kling-video-service');
  const klingVideoService = new KlingVideoService(app);

  // Salva um vídeo exportado copiando o arquivo real (o download de URLs file:// é
  // bloqueado no Chromium e gerava uma página HTML quebrada no lugar do vídeo).
  ipcMain.handle('kling:save-video', async (event, payload = {}) => {
    try {
      const src = String(payload.sourcePath || '').replace(/^file:\/*/, '/');
      if (!src || !fs.existsSync(src)) return { success: false, error: 'Arquivo de origem não encontrado.' };
      const dl = app.getPath('downloads');
      const ext = path.extname(path.basename(src));
      const base = path.basename(src, ext);
      let dest = path.join(dl, path.basename(src));
      for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dl, base + '-' + i + ext);
      fs.copyFileSync(src, dest);
      shell.showItemInFolder(dest);
      return { success: true, path: dest };
    } catch (err) {
      console.error('[Main] Kling save video error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('kling:convert-picture-to-video', async (event, payload = {}) => {
    try {
      console.log('[Main] Kling Picture-to-Video conversion requested:', payload.prompt);
      const result = await klingVideoService.convertPictureToVideo({
        ...payload,
        onProgress: (p) => {
          if (event && event.sender && !event.sender.isDestroyed()) {
            event.sender.send('kling:progress', p);
          }
        }
      });
      return result;
    } catch (err) {
      console.error('[Main] Kling video conversion error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('run-youtube-pipeline', async (event, args = {}) => {
    return new Promise((resolve) => {
      try {
        const { phase, uploadMode, videoPath, thumbnailPath, hints, metadata } = args;
        const ytDir = path.join(__dirname, '..', 'youtube_auto');
        const scriptPath = path.join(ytDir, 'pipeline.py');
        if (!fs.existsSync(scriptPath)) { resolve({success:false,error:'The original installer does not include youtube_auto/pipeline.py.'}); return; }
        
        // Write args to a temp JSON file to avoid ALL Windows escaping/quoting issues
        const os = require('os');
        
        let geminiApiKey = process.env.GEMINI_API_KEY || '';
        try {
          const secretPath = getSecretKeyPath();
          if (fs.existsSync(secretPath)) {
            const secretData = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
            geminiApiKey = secretData.apiKey || secretData.geminiKey || geminiApiKey;
          }
        } catch(e) {}

        const argsPayload = { phase: phase || 'full', uploadMode: uploadMode || 'existing', videoPath, thumbnailPath, hints, metadata, geminiApiKey };
        const tmpFile = path.join(os.tmpdir(), `nova_yt_args_${Date.now()}.json`);
        fs.writeFileSync(tmpFile, JSON.stringify(argsPayload), 'utf8');

        const { exec } = require('child_process');
        
        // Simple quoted command — no array-to-shell conversion issues
        const cmd = `python "${scriptPath}" --args-file "${tmpFile}"`;
        const pyProcess = exec(cmd, { cwd: ytDir });
        
        let extractedMetadata = null;
        let generatedVideoPath = null;

        pyProcess.stdout.on('data', (data) => {
          const output = data.toString();
          console.log(`[YouTube Auto]: ${output}`);
          
          const lines = output.split('\n');
          for (const line of lines) {
              if (!line.trim()) continue;
              
              if (line.includes('[[METADATA_JSON]]')) {
                  try {
                      const jsonStr = line.split('[[METADATA_JSON]]')[1].trim();
                      extractedMetadata = JSON.parse(jsonStr);
                  } catch(e) {
                      console.error("Failed to parse metadata JSON", e);
                  }
                  continue;
              }

              if (line.includes('[[VIDEO_PATH]]')) {
                  generatedVideoPath = line.split('[[VIDEO_PATH]]')[1].trim();
                  continue;
              }

              try {
                  const parsed = JSON.parse(line.trim());
                  if (parsed.status && parsed.message) {
                      event.sender.send('youtube-pipeline-status', parsed);
                  }
              } catch(err) {
              }
          }
        });
        
        pyProcess.stderr.on('data', (data) => {
          console.error(`[YouTube Auto Error]: ${data}`);
        });

        pyProcess.on('error', (err) => {
          console.error(`[YouTube Auto Spawn Error]: ${err}`);
          event.sender.send('youtube-pipeline-status', { status: 'error', message: `Spawn Error: ${err.message}` });
          resolve({ success: false, error: err.message });
        });
        
        pyProcess.on('close', (code) => {
            try { fs.unlinkSync(tmpFile); } catch(e) {}
            if (code === 0) {
                resolve({ success: true, metadata: extractedMetadata, videoPath: generatedVideoPath });
            } else {
                resolve({ success: false, error: `Process exited with code ${code}` });
            }
        });

      } catch (e) {
        console.error('Failed to run YouTube pipeline:', e);
        resolve({ success: false, error: e.message });
      }
    });
  });

  ipcMain.handle('preview-voice', async (event, { aiVoice, aiLanguage, aiSpeed, aiPitch, scriptText }) => {
    return new Promise((resolve) => {
      try {
        const { exec } = require('child_process');
        const os = require('os');
        const ts  = Date.now();
        const tmpAudio = path.join(os.tmpdir(), `nova_prev_${ts}.mp3`);
        const tmpSubs  = path.join(os.tmpdir(), `nova_prev_${ts}.vtt`);
        const tmpTxt   = path.join(os.tmpdir(), `nova_prev_txt_${ts}.txt`);

        let voice = 'en-US-ChristopherNeural';
        if (aiVoice && aiVoice.includes('Asad'))  voice = 'ur-PK-AsadNeural';
        else if (aiVoice && aiVoice.includes('Uzma'))  voice = 'ur-PK-UzmaNeural';
        else if (aiVoice && aiVoice.includes('Christopher')) voice = 'en-US-ChristopherNeural';
        else if (aiLanguage && aiLanguage.includes('Hindi')) voice = 'hi-IN-MadhurNeural';

        // Use real script — no character limit so every word is spoken naturally
        let textToSpeak = (scriptText || '').trim();
        if (!textToSpeak) {
          textToSpeak = voice.startsWith('ur-')
            ? 'السلام علیکم، میں نووا اے آئی ہوں، آپ کی خدمت میں حاضر ہوں'
            : voice.startsWith('hi-')
              ? 'नमस्ते, मैं Nova AI हूँ। आपकी सेवा में हाजिर हूँ।'
              : 'Hello! I am Nova AI, your intelligent voice assistant. How can I help you today?';
        }

        // Write to temp file (BOM for proper Urdu/Hindi on Windows)
        fs.writeFileSync(tmpTxt, '\uFEFF' + textToSpeak, 'utf8');

        const speed = aiSpeed || 50;
        const pitch = aiPitch || 50;
        let rateArg  = '';
        let pitchArg = '';
        if (speed !== 50) rateArg  = `--rate "${speed > 50 ? '+' : ''}${(speed - 50) * 2}%"`;
        if (pitch !== 50) pitchArg = `--pitch "${pitch > 50 ? '+' : ''}${pitch - 50}Hz"`;

        const ttsCmd = [
          edgeTtsBinary(process.platform, () => macNative.python()),
          `--file "${tmpTxt}"`,
          `--write-media "${tmpAudio}"`,
          `--write-subtitles "${tmpSubs}"`,
          `--voice ${voice}`,
          rateArg, pitchArg
        ].filter(Boolean).join(' ');

        event.sender.send('preview-voice-status', { state: 'generating', message: '🎙️ Gerando voz...' });

        exec(ttsCmd, (err) => {
          try { fs.unlinkSync(tmpTxt); } catch(e) {}

          if (err) {
            event.sender.send('preview-voice-status', { state: 'error', message: `❌ edge-tts: ${err.message.slice(0,100)}` });
            resolve({ success: false, error: err.message });
            return;
          }
          if (!fs.existsSync(tmpAudio) || fs.statSync(tmpAudio).size === 0) {
            event.sender.send('preview-voice-status', { state: 'error', message: '❌ Arquivo de áudio vazio' });
            resolve({ success: false, error: 'Audio empty' });
            return;
          }

          let wordTimings = [];
          try {
            const vttRaw = fs.existsSync(tmpSubs) ? fs.readFileSync(tmpSubs, 'utf8') : '';
            // VTT format: "HH:MM:SS.mmm --> HH:MM:SS.mmm\nword\n"
            const blocks = vttRaw.split(/\n\n+/).filter(b => b.includes('-->'));
            blocks.forEach(block => {
              const lines = block.trim().split('\n');
              const timeLine = lines.find(l => l.includes('-->'));
              const wordLine = lines[lines.length - 1];
              if (timeLine && wordLine) {
                const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
                const toSec = t => {
                  const [hms, ms] = t.split('.');
                  const parts = hms.split(':').map(Number);
                  return parts[0]*3600 + parts[1]*60 + parts[2] + (parseInt(ms||'0')/1000);
                };
                wordTimings.push({ word: wordLine.trim(), start: toSec(startStr), end: toSec(endStr) });
              }
            });
            try { fs.unlinkSync(tmpSubs); } catch(e) {}
          } catch(e) { wordTimings = []; }

          event.sender.send('preview-voice-status', {
            state: 'playing',
            message: '🔊 Reproduzindo...',
            wordTimings
          });

          // Play with ffplay (-nodisp = no window, -autoexit = stop when done)
          const playCmd = `ffplay -nodisp -autoexit -loglevel quiet "${tmpAudio}"`;
          exec(playCmd, (playErr) => {
            try { fs.unlinkSync(tmpAudio); } catch(e) {}
            if (playErr) {
              if (process.platform === 'darwin') shell.openPath(tmpAudio); else exec(`start "" "${tmpAudio}"`);
            }
            event.sender.send('preview-voice-status', { state: 'done', message: '✅ Pronto!' });
            resolve({ success: true });
          });
        });
      } catch(e) {
        resolve({ success: false, error: e.message });
      }
    });
  });



  ipcMain.handle('start-manual-download', async (event, { url, format, type }) => {
    if (app.ytdlpManager) {
      await app.ytdlpManager.manualDownload(url, format, type);
      return true;
    }
    return false;
  });

  ipcMain.handle('cancel-manual-download', async () => {
    if (app.ytdlpManager) {
      return app.ytdlpManager.cancelManualDownload();
    }
    return false;
  });

  ipcMain.handle('open-downloader-folder', async () => {
    try {
      const folderPath = path.join(os.homedir(), 'Downloads', 'Nova Downloads');
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
      require('electron').shell.showItemInFolder(folderPath);
      return true;
    } catch(e) {
      return false;
    }
  });

  ipcMain.handle('load-memories', async () => {
    try {
      const p = getMemoryPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return [];
    } catch (e) { return []; }
  });
  ipcMain.handle('save-memories', async (e, memories) => {
    try {
      fs.writeFileSync(getMemoryPath(), JSON.stringify(memories, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('load-user-profile', async () => {
    try {
      const p = getUserProfilePath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return {};
    } catch (e) { return {}; }
  });

  ipcMain.handle('save-user-profile', async (event, profile) => {
    try {
      fs.writeFileSync(getUserProfilePath(), JSON.stringify(profile, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('load-dashboard-settings', async () => {
    try {
      const p = getDashboardSettingsPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return { interests: ['Tech', 'Pakistan', 'Global Economy'], refreshInterval: 3600 };
    } catch (e) { return { interests: [], refreshInterval: 3600 }; }
  });

  ipcMain.handle('save-dashboard-settings', async (event, settings) => {
    try {
      fs.writeFileSync(getDashboardSettingsPath(), JSON.stringify(settings, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('fetch-dashboard-data', async (event, { location, interests }) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('API Key missing');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: "gemini-3.8-flash",
        tools: [{ googleSearch: {} }]
      }, { apiVersion: 'v1beta' });
      
      const prompt = `Search for top 5 news headlines for: ${interests.join(', ')} in ${location || 'Pakistan'}. Also get weather. Respond in ENGLISH and return JSON: {"headlines": [...], "weather": {"today": "...", "tomorrow": "...", "dayAfter": "..."}}`;
      
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { headlines: ['Error parsing data'], weather: { today: 'N/A' } };
    } catch (error) {
      return { headlines: [`Error: ${error.message}`], weather: { today: "Error ⚠️" } };
    }
  });

  ipcMain.handle('load-history', async () => {
    try {
      const p = getHistoryPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return [];
    } catch (e) { return []; }
  });

  ipcMain.handle('save-history', async (event, history) => {
    try {
      fs.writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('clear-history', async () => {
    try {
      const p = getHistoryPath();
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('load-chats', async () => {
    try {
      const p = getChatsPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));

      const h = getHistoryPath();
      if (fs.existsSync(h)) {
        const legacyMessages = JSON.parse(fs.readFileSync(h, 'utf8'));
        if (legacyMessages && legacyMessages.length > 0) {
          const firstChat = {
            id: 'legacy-history',
            title: 'Chat Legado',
            messages: legacyMessages,
            timestamp: Date.now(),
            model: 'Claude 4.5 Sonnet'
          };
          return [firstChat];
        }
      }
      return [];
    } catch (e) { return []; }
  });

  let globalChatSaveSessionCount = 0;
  ipcMain.handle('save-chats', async (event, chats) => {
    try {
      fs.writeFileSync(getChatsPath(), JSON.stringify(chats, null, 2));
      
      globalChatSaveSessionCount++;
      if (globalChatSaveSessionCount % 10 === 0) {
        // Continuous Learning Trigger: Silently update the backend User Context profile.
        // It fetches API Key from the same path as Gemini configuration.
        const tokenPath = getSecretKeyPath();
        if (fs.existsSync(tokenPath)) {
           const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
           const apiKey = tokenData.apiKey || tokenData.geminiKey || process.env.GEMINI_API_KEY;
           if (apiKey) {
               analyzeUserGraph(apiKey, chats).catch(e => console.error('[Continuous Learning] Sync error:', e));
           }
        }
      }
      
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('get-user-context', () => {
    return getUserContext();
  });

  ipcMain.handle('sync-user-context', async (event, chats) => {
    try {
        const tokenPath = getSecretKeyPath();
        let apiKey = process.env.GEMINI_API_KEY;
        if (fs.existsSync(tokenPath)) {
           const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
           apiKey = tokenData.apiKey || tokenData.geminiKey || apiKey;
        }
        return await analyzeUserGraph(apiKey, chats);
    } catch(e) {
      return null;
    }
  });

  ipcMain.handle('load-history-settings', async () => {
    try {
      const p = getHistorySettingsPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return { maxContextMessages: 20, storeHistory: true };
    } catch (e) { return { maxContextMessages: 20, storeHistory: true }; }
  });

  ipcMain.handle('save-history-settings', async (event, settings) => {
    try {
      fs.writeFileSync(getHistorySettingsPath(), JSON.stringify(settings, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('load-contacts', async () => {
    try {
      const p = getContactsPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return [];
    } catch (e) { return []; }
  });

  ipcMain.handle('save-contacts', async (event, contacts) => {
    try {
      fs.writeFileSync(getContactsPath(), JSON.stringify(contacts, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('load-notes', async () => {
    try {
      const p = getNotesPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return [];
    } catch (e) { return []; }
  });

  ipcMain.handle('save-notes', async (event, notes) => {
    try {
      fs.writeFileSync(getNotesPath(), JSON.stringify(notes, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('save-quick-note', async (event, { text, timestamp }) => {
    try {
      const p = getNotesPath();
      let notes = [];
      if (fs.existsSync(p)) {
        try { notes = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { notes = []; }
      }
      const newNote = {
        id: `qn_${Date.now()}`,
        title: text.length > 40 ? text.substring(0, 40) + '...' : text,
        content: text,
        timestamp: timestamp || Date.now(),
        createdAt: new Date().toISOString(),
        source: 'whatsapp'
      };
      notes.unshift(newNote);
      fs.writeFileSync(p, JSON.stringify(notes, null, 2));
      console.log('[Main] Quick note saved via WhatsApp:', text.substring(0, 50));
      return { success: true, note: newNote };
    } catch (e) {
      console.error('[Main] save-quick-note error:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('load-tasks', async () => {
    try {
      const p = getTasksPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return [];
    } catch (e) { return []; }
  });

  ipcMain.handle('save-tasks', async (event, tasks) => {
    try {
      fs.writeFileSync(getTasksPath(), JSON.stringify(tasks, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('ltm:save-insight', async (event, { content, category }) => {
    try {
      const p = getMemoryPath();
      const memories = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
      memories.push({ id: Date.now().toString(), content, category, timestamp: Date.now() });
      fs.writeFileSync(p, JSON.stringify(memories, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('ltm:get-insights', async (event, query) => {
    try {
      const p = getMemoryPath();
      if (!fs.existsSync(p)) return [];
      const memories = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!query) return memories;
      return memories.filter(m => m.content.toLowerCase().includes(query.toLowerCase()));
    } catch (e) { return []; }
  });

  ipcMain.handle('ltm:clear-all', async () => {
    try {
      const p = getMemoryPath();
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('chat:get-recall-summary', async (event, limit) => {
    try {
      const p = getHistoryPath();
      if (!fs.existsSync(p)) return "No previous history found.";
      const history = JSON.parse(fs.readFileSync(p, 'utf8'));
      const lastMsgs = history.slice(-(limit || 5));
      return lastMsgs.map(m => `${m.role === 'user' ? 'User' : 'Nova'}: ${m.text}`).join('\n');
    } catch (e) { return "Error recalling history."; }
  });

  const getMarkdownNotesPath = () => path.join(app.getPath('documents'), 'Nova Data');

  ipcMain.handle('get-documents-path', async () => {
    return app.getPath('documents');
  });

  ipcMain.handle('get-notes-path', async () => {
    const notesPath = path.join(app.getPath('documents'), 'Nova Data');
    if (!fs.existsSync(notesPath)) {
      fs.mkdirSync(notesPath, { recursive: true });
    }
    return notesPath;
  });

  ipcMain.handle('get-nova-data-path', async () => {
    const novaDataPath = path.join(app.getPath('documents'), 'Nova Data');
    if (!fs.existsSync(novaDataPath)) {
      fs.mkdirSync(novaDataPath, { recursive: true });
    }
    return novaDataPath;
  });


  ipcMain.handle('initialize-vault', async () => {
    console.log('IPC: Initializing Vault...');
    try {
      const notesDir = getMarkdownNotesPath();
      if (!fs.existsSync(notesDir)) {
        fs.mkdirSync(notesDir, { recursive: true });
        console.log('IPC: Re-created Nova Data:', notesDir);
      }

      return { notesDir };
    } catch (e) {
      console.error('IPC: Vault Initialization Failed:', e);
      try { return { notesDir: getMarkdownNotesPath() }; } catch (err) { return null; }
    }
  });

  ipcMain.handle('open-vault-folder', async (event, folderName) => {
    try {
      const folderPath = path.join(getVaultPath(), folderName);
      const open = (await import('open')).default;
      await open(folderPath);
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('load-imported-folders', async () => {
    try {
      const p = getFolderConfigPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return [];
    } catch (e) { return []; }
  });

  ipcMain.handle('save-imported-folders', async (event, folders) => {
    try {
      fs.writeFileSync(getFolderConfigPath(), JSON.stringify(folders, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('pick-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Selecionar Pasta para Importar'
    });
    if (canceled || filePaths.length === 0) return null;
    return {
      name: path.basename(filePaths[0]),
      path: filePaths[0]
    };
  });

  ipcMain.handle('save-vault-md', async (event, { filename, content }) => {
    try {
      const dir = path.join(getVaultPath(), 'Chats');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), content);
      return true;
    } catch (e) {
      console.error('save-vault-md error:', e);
      return false;
    }
  });

  // MEMORY GATE: Only search when user explicitly asks about past events/memory.
  // This prevents wasting API tokens on every simple WhatsApp message.
  const MEMORY_TRIGGER_KEYWORDS = [
    'yaad', 'puran', 'pichl', 'remember', 'last time', 'hafta', 'memory',
    'did we', 'kya humne', 'pehle', 'kya tha', 'batao kal', 'recall',
    'history', 'past', 'before', 'previously', 'kal bhi', 'jo hum'
  ];

  ipcMain.handle('search-vault-memory', async (event, currentPrompt) => {
    try {
      if (!currentPrompt) return "";

      const promptLower = String(currentPrompt).toLowerCase();

      const isMemoryQuery = MEMORY_TRIGGER_KEYWORDS.some(kw => promptLower.includes(kw));
      if (!isMemoryQuery) {
        console.log("🧠 Memory Search SKIPPED (no memory keyword in message)");
        return "";
      }

      const stopWords = new Set(['aur', 'hai', 'ki', 'ka', 'mein', 'ko', 'se', 'tha', 'thi', 'the', 'main', 'mujhe', 'karo', 'koi', 'hi', 'bhi', 'to', 'yeh', 'woh', 'is', 'a', 'an', 'the', 'and', 'or', 'for', 'to', 'in', 'on', 'with', 'by', 'of', 'how', 'what', 'who', 'when', 'where', 'why']);
      
      const keywords = (promptLower.match(/\b\w+\b/g) || []).filter(w => w.length > 2 && !stopWords.has(w));
      
      console.log("🔍 Search Keywords:", keywords);
      
      if (keywords.length === 0) return "";

      const activityJsonPath = path.join(path.dirname(app.getPath('exe')), 'Nova_Vault', 'MyActivity.json');
      const activityJsonAlt = path.join(__dirname, '..', 'Nova_Vault', 'MyActivity.json');
      const jsonPath = fs.existsSync(activityJsonPath) ? activityJsonPath : fs.existsSync(activityJsonAlt) ? activityJsonAlt : null;

      if (!jsonPath) {
        console.warn("🔍 RAG Skip: MyActivity.json not found!");
        return "";
      }

      const rawJson = fs.readFileSync(jsonPath, 'utf8');
      const activities = JSON.parse(rawJson);

      let matchedNodes = [];

      for (const entry of activities) {
          const title = (entry.title || "");
          const htmlContent = (entry.safeHtmlItem || []).map(h => h.html).join(" ");
          
          const searchableText = (title + " " + htmlContent).toLowerCase();
          
          let score = 0;
          for (const kw of keywords) {
              if (searchableText.includes(kw)) score++;
          }

          if (score > 0) {
              const rawText = htmlContent
                .replace(/<[^>]+>/g, ' ')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/\s+/g, ' ')
                .trim();
              
              const cleanSnippet = rawText.length > 400 ? rawText.substring(0, 400) + "..." : rawText;
              matchedNodes.push({ title, snippet: cleanSnippet, score });
          }
      }

      matchedNodes.sort((a, b) => b.score - a.score);
      const top2 = matchedNodes.slice(0, 2);

      if (top2.length > 0) {
          const matchedContext = top2.map(n => `{Title: ${n.title}, Snippet: ${n.snippet}}`).join(" | ");
          console.log("🧠 Retrieved Memory:", matchedContext);
          return matchedContext;
      }

      console.log("🧠 Retrieved Memory: No exact topic match found.");
      return "";

    } catch (err) {
      console.error("🔍 RAG Engine Error:", err);
      return "";
    }
  });

  ipcMain.handle('scan-vault-graph', async () => {
    try {
      const nodes = [];
      const links = [];
      const nodeMap = new Set();

      const addNode = (id, name, group, val, snippet = '', tags = [], date = '', fullText = '') => {
        if (!nodeMap.has(id)) {
          nodes.push({ id, name, group, val, snippet, tags, date, fullText });
          nodeMap.add(id);
        }
      };

      addNode('nova_core', 'Nova Central Memory', 0, 5);

      const TAG_RULES = [
        { tag: 'Code',      keywords: ['code', 'function', 'script', 'program', 'implement'] },
        { tag: 'Error',     keywords: ['error', 'bug', 'fix', 'crash', 'fail', 'issue', 'problem'] },
        { tag: 'AI',        keywords: ['ai', 'gemini', 'model', 'gpt', 'llm', 'neural', 'prompt'] },
        { tag: 'Video',     keywords: ['video', 'youtube', 'stream', 'play', 'watch'] },
        { tag: 'App',       keywords: ['app', 'software', 'electron', 'desktop', 'install', 'launch'] },
        { tag: 'Design',    keywords: ['design', 'ui', 'css', 'style', 'layout', 'color', 'theme'] },
        { tag: 'API',       keywords: ['api', 'endpoint', 'request', 'fetch', 'axios', 'http', 'token'] },
        { tag: 'React',     keywords: ['react', 'component', 'hook', 'state', 'useeffect', 'tsx'] },
        { tag: 'Python',    keywords: ['python', 'pip', 'django', 'flask', 'numpy', 'pandas'] },
        { tag: 'Voice',     keywords: ['voice', 'speech', 'audio', 'mic', 'tts', 'stt', 'elevenlabs'] },
        { tag: 'Vision',    keywords: ['camera', 'screen', 'screenshot', 'image', 'vision', 'face'] },
        { tag: 'WhatsApp',  keywords: ['whatsapp', 'wa', 'message', 'chat', 'send'] },
        { tag: 'System',    keywords: ['volume', 'brightness', 'sleep', 'shutdown', 'battery'] },
        { tag: 'File',      keywords: ['file', 'folder', 'directory', 'path', 'read', 'write'] },
        { tag: 'General',   keywords: [] },
      ];

      const detectTags = (text) => {
        const lower = (text || '').toLowerCase();
        const matched = TAG_RULES
          .filter(r => r.keywords.length > 0 && r.keywords.some(k => lower.includes(k)))
          .map(r => r.tag);
        return matched.length > 0 ? matched : ['General'];
      };

      const stripHtml = (html) => {
        return (html || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      };

      // SOURCE 1: Google Takeout MyActivity.json
      //   Location: Stonic_Vault/MyActivity.json  (project folder)
      //   Structure: Array of { header, title, time, safeHtmlItem: [{html}] }
      const activityJsonPath = path.join(
        path.dirname(app.getPath('exe')),
        'Nova_Vault', 'MyActivity.json'
      );

      // Fallback: also check next to main.js (electron/ folder sibling)
      const activityJsonAlt = path.join(
        __dirname, '..', 'Nova_Vault', 'MyActivity.json'
      );

      const jsonPath = fs.existsSync(activityJsonPath) ? activityJsonPath
                     : fs.existsSync(activityJsonAlt)  ? activityJsonAlt
                     : null;

      let jsonEntriesLoaded = 0;

      if (jsonPath) {
        console.log('[scan-vault-graph] Reading MyActivity.json from:', jsonPath);
        const rawJson = fs.readFileSync(jsonPath, 'utf8');
        const activities = JSON.parse(rawJson);

        // File has 1000s of entries — sample 20% for performance
        // (later: make this configurable via settings)
        const SAMPLE_RATE = 0.2;
        const sampled = activities.filter((_, idx) => Math.random() < SAMPLE_RATE || idx < 50);

        sampled.forEach((entry, idx) => {
          const title   = (entry.title || `Chat ${idx + 1}`).trim();
          const dateRaw = entry.time || '';
          const date    = dateRaw ? new Date(dateRaw).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
          }) : '';

          const htmlChunks = (entry.safeHtmlItem || [])
            .map(h => stripHtml(h.html))
            .join(' ');
          const snippet = htmlChunks.length > 200
            ? htmlChunks.substring(0, 200) + '...'
            : (htmlChunks || title);

          const tags = detectTags(`${title} ${htmlChunks}`);

          const nodeId = `ga_${idx}_${title.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_')}`;
          addNode(nodeId, title, 1, 1, snippet, tags, date, htmlChunks || title);
          links.push({ source: 'nova_core', target: nodeId });

          tags.forEach(tag => {
            const tagId = `tag_${tag}`;
            addNode(tagId, `#${tag}`, 3, 2);
            links.push({ source: nodeId, target: tagId });
          });
        });

        jsonEntriesLoaded = sampled.length;
        console.log(`[scan-vault-graph] MyActivity.json: ${activities.length} total → ${sampled.length} sampled`);
      } else {
        console.warn('[scan-vault-graph] MyActivity.json not found at:', activityJsonPath);
      }

      // SOURCE 2: Nova_Vault Markdown files (Chat notes, secondary source)
      //   Location: Documents/Nova_Vault/ and /Chats/ subfolder
      const vaultRoot = getVaultPath();
      const chatsDir  = path.join(vaultRoot, 'Chats');

      const collectMdFiles = (dir) => {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
          .filter(f => f.endsWith('.md'))
          .map(f => path.join(dir, f));
      };

      const mdFiles = [...collectMdFiles(chatsDir), ...collectMdFiles(vaultRoot)];

      mdFiles.forEach(filePath => {
        const rawContent = fs.readFileSync(filePath, 'utf8');
        const fileName   = path.basename(filePath, '.md');

        let title = fileName.replace(/_/g, ' ');
        let mdTags = [];
        let date = '';

        const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          const fm = fmMatch[1];
          const titleLine = fm.match(/^title:\s*(.+)$/m);
          if (titleLine) title = titleLine[1].replace(/['"]/g, '').trim();

          const dateLine = fm.match(/^date:\s*(.+)$/m);
          if (dateLine) date = dateLine[1].trim();

          const tagsLine = fm.match(/^tags:\s*(.*)$/m);
          if (tagsLine) {
            const tagsRaw = tagsLine[1].trim();
            if (tagsRaw.startsWith('[')) {
              try { mdTags = JSON.parse(tagsRaw).map(t => t.replace(/^#/, '').trim()); } catch(e) {}
            } else if (!tagsRaw) {
              const yamlList = fm.match(/^tags:\s*\n((?:\s+- .+\n?)+)/m);
              if (yamlList) mdTags = yamlList[1].split('\n').map(l => l.replace(/^\s+- /, '').replace(/^#/, '').trim()).filter(Boolean);
            } else {
              mdTags = [tagsRaw.replace(/^#/, '').trim()];
            }
          }
        }

        const wikilinks = [];
        const wikiRe = /\[\[(.*?)\]\]/g;
        let wm;
        while ((wm = wikiRe.exec(rawContent)) !== null) wikilinks.push(wm[1].trim());

        const bodyStart = fmMatch ? rawContent.indexOf('---', 3) + 3 : 0;
        const bodyLines = rawContent.substring(bodyStart).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        const snippetRaw = bodyLines.slice(0, 3).join(' ').replace(/\[\[.*?\]\]/g, '').trim();
        const snippet = snippetRaw.length > 150 ? snippetRaw.substring(0, 150) + '...' : snippetRaw;
        
        const fullTextRaw = rawContent.substring(bodyStart).trim();

        const autoTags = mdTags.length > 0 ? mdTags : detectTags(`${title} ${snippet}`);
        const nodeId = `md_${fileName}`;
        addNode(nodeId, title, 4, 1, snippet, autoTags, date, fullTextRaw);
        links.push({ source: 'nova_core', target: nodeId });

        autoTags.forEach(tag => {
          const tagId = `tag_${tag.replace(/\s+/g, '_')}`;
          addNode(tagId, `#${tag}`, 3, 2);
          links.push({ source: nodeId, target: tagId });
        });

        wikilinks.forEach(w => {
          const wikiId = `wiki_${w.replace(/\s+/g, '_')}`;
          addNode(wikiId, w, 2, 2.5);
          links.push({ source: nodeId, target: wikiId });
        });
      });

      nodes.forEach(n => {
        if (n.id === 'nova_core') {
          n.val = Math.min(12, 3 + links.length * 0.05);
          return;
        }
        const connCount = links.filter(l => l.source === n.id || l.target === n.id).length;
        n.val = Math.max(1, Math.min(10, 1 + connCount * 0.5));
      });

      console.log(`[scan-vault-graph] TOTAL → ${nodes.length} nodes, ${links.length} links (JSON: ${jsonEntriesLoaded}, MD: ${mdFiles.length})`);
      return { nodes, links };

    } catch (e) {
      console.error('[scan-vault-graph] Fatal error:', e.message);
      return { nodes: [], links: [] };
    }
  });


  ipcMain.handle('trigger-swarm', async (event, { command, apiKey, isDelegated }) => {
    try {
      if (!agentSwarmController) {
        console.warn('[Swarm] Controller not initialized yet.');
        return { handled: false };
      }
      let childModel = 'gemini-3.8-flash';
      let effectiveApiKey = apiKey;
      let groqKey = '';
      try {
        const mp = getChildAgentModelPath();
        if (fs.existsSync(mp)) {
          const data = JSON.parse(fs.readFileSync(mp, 'utf8'));
          childModel = data.model || 'gemini-3.8-flash';
        }
        // Use dedicated child API key if set (avoids sharing quota with Nova live)
        const kp = getChildAgentKeyPath();
        if (fs.existsSync(kp)) {
          const keyData = JSON.parse(fs.readFileSync(kp, 'utf8'));
          if (keyData.apiKey && keyData.apiKey.length > 20) {
            effectiveApiKey = keyData.apiKey;
            console.log('[Swarm] Using dedicated child-agent API key.');
          }
        }
        // Read Groq key (ultimate fallback — completely separate API quota)
        const gp = path.join(app.getPath('userData'), 'groq_key.json');
        if (fs.existsSync(gp)) {
          const gd = JSON.parse(fs.readFileSync(gp, 'utf8'));
          groqKey = gd.apiKey || gd.groqKey || gd.key || '';
          if (groqKey) console.log('[Swarm] Groq fallback key loaded.');
        }
      } catch(e) { }
      return await agentSwarmController.executeWorkflow(command, effectiveApiKey, isDelegated, childModel, groqKey);
    } catch (e) {
      console.error('[Swarm] Error:', e);
      return { handled: false, error: e.message };
    }
  });



  ipcMain.on('cancel-swarm', () => {
    if (agentSwarmController) agentSwarmController.cancel();
  });

  ipcMain.handle('get-gemini-token', async () => {
    try {
      const p = getSecretKeyPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.apiKey || data.geminiKey || process.env.GEMINI_API_KEY || null;
      }
      return process.env.GEMINI_API_KEY || null;
    } catch (e) {
      return process.env.GEMINI_API_KEY || null;
    }
  });

  ipcMain.handle('save-gemini-token', async (event, apiKey) => {
    try {
      const p = getSecretKeyPath();
      let data = {};
      if (fs.existsSync(p)) {
        try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { }
      }
      data.apiKey = apiKey; // Keep for backward compatibility
      data.geminiKey = apiKey;
      data.updatedAt = Date.now();
      fs.writeFileSync(p, JSON.stringify(data, null, 2));
      return true;
    } catch (e) {
      return false;
    }
  });

  ipcMain.handle('get-groq-token', async () => {
    try {
      const p = getGroqKeyPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.apiKey || null;
      }
      return process.env.GROQ_API_KEY || null;
    } catch (e) { return null; }
  });

  ipcMain.handle('save-groq-token', async (event, apiKey) => {
    try {
      fs.writeFileSync(getGroqKeyPath(), JSON.stringify({ apiKey, updatedAt: Date.now() }, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('get-wa-api-key', async () => {
    try {
      const p = getWaApiKeyPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.apiKey || null;
      }
      return null;
    } catch (e) { return null; }
  });

  ipcMain.handle('save-wa-api-key', async (event, apiKey) => {
    try {
      fs.writeFileSync(getWaApiKeyPath(), JSON.stringify({ apiKey, updatedAt: Date.now() }, null, 2));
      console.log('[Main] WhatsApp dedicated API key saved.');
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('get-openrouter-token', async () => {
    try {
      const p = getOpenRouterKeyPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.apiKey || null;
      }
      return process.env.OPENROUTER_API_KEY || null;
    } catch (e) { return null; }
  });

  ipcMain.handle('save-openrouter-token', async (event, apiKey) => {
    try {
      fs.writeFileSync(getOpenRouterKeyPath(), JSON.stringify({ apiKey, updatedAt: Date.now() }, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('get-thinking-enabled', async () => {
    try {
      const p = getThinkingSettingsPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.enabled !== undefined ? data.enabled : true;
      }
      return true;
    } catch (e) { return true; }
  });

  ipcMain.handle('save-thinking-enabled', async (event, enabled) => {
    try {
      fs.writeFileSync(getThinkingSettingsPath(), JSON.stringify({ enabled, updatedAt: Date.now() }, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('get-prefer-direct-gemini', async () => {
    try {
      const p = getGeminiPreferencePath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.preferDirect !== undefined ? data.preferDirect : false;
      }
      return false;
    } catch (e) { return false; }
  });

  ipcMain.handle('save-prefer-direct-gemini', async (event, preferDirect) => {
    try {
      fs.writeFileSync(getGeminiPreferencePath(), JSON.stringify({ preferDirect, updatedAt: Date.now() }, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('get-google-token', async () => {
    try {
      const p = getGoogleKeyPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.apiKey || null;
      }
      return process.env.GOOGLE_API_KEY || null;
    } catch (e) { return null; }
  });

  ipcMain.handle('save-google-token', async (event, apiKey) => {
    try {
      fs.writeFileSync(getGoogleKeyPath(), JSON.stringify({ apiKey, updatedAt: Date.now() }, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('get-elevenlabs-settings', async () => {
    try {
      const p = getElevenLabsSettingsPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return { apiKey: '', voiceId: '21m00Tcm4TlvDq8ikWAM' };
    } catch (e) { return { apiKey: '', voiceId: '21m00Tcm4TlvDq8ikWAM' }; }
  });

  ipcMain.handle('save-elevenlabs-settings', async (event, settings) => {
    try {
      fs.writeFileSync(getElevenLabsSettingsPath(), JSON.stringify(settings, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('get-visual-feed-enabled', async () => {
    try {
      const p = getVisualSettingsPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return data.enabled !== undefined ? data.enabled : true;
      }
      return true;
    } catch (e) { return true; }
  });

  ipcMain.handle('save-visual-feed-enabled', async (event, enabled) => {
    try {
      fs.writeFileSync(getVisualSettingsPath(), JSON.stringify({ enabled, updatedAt: Date.now() }, null, 2));
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('get-openrouter-models', async () => {
    try {
      const p = getOpenRouterKeyPath();
      let apiKey = process.env.OPENROUTER_API_KEY;

      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (data.apiKey) apiKey = data.apiKey;
      }

      if (!apiKey) return { error: 'OpenRouter Key missing' };

      const response = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://nova.ai',
          'X-Title': 'Nova AI'
        }
      });

      return response.data;
    } catch (e) {
      console.error('[Electron] Error fetching models:', e.message);
      return { error: e.message };
    }
  });

  ipcMain.handle('system-fs-op', async (event, { operation, path: targetPath, content, dest }) => {
    try {
      // CRITICAL FIX: Resolve relative paths to Nova Data folder
      // If path starts with "Documents\Nova Data" or similar, treat as relative to user Documents
      let resolvedPath = targetPath;

      // CRITICAL FIX: If AI literally used "${resolvedNotesPath}" string, strip it out
      if (targetPath && (targetPath.includes('${resolvedNotesPath}') || targetPath.includes('$resolvedNotesPath'))) {
        console.warn(`[FS-OP] WARNING: AI used literal template variable "${targetPath}". Fixing...`);
        resolvedPath = targetPath.replace(/\$\{?resolvedNotesPath\}?[\\\/]?/g, '');
        if (!resolvedPath || resolvedPath === targetPath) {
          resolvedPath = app.getPath('documents') + path.sep + 'Nova Data';
        } else {
          resolvedPath = path.join(app.getPath('documents'), 'Nova Data', resolvedPath);
        }
        console.log(`[FS-OP] Fixed literal variable: ${targetPath} → ${resolvedPath}`);
      }
      else if (targetPath && !path.isAbsolute(targetPath)) {
        if (targetPath.startsWith('Documents\\') || targetPath.startsWith('Documents/')) {
          resolvedPath = path.join(app.getPath('documents'), targetPath.substring('Documents\\'.length));
        } else if (targetPath.startsWith('Nova Data\\') || targetPath.startsWith('Nova Data/')) {
          resolvedPath = path.join(app.getPath('documents'), targetPath);
        } else {
          resolvedPath = path.join(app.getPath('documents'), 'Nova Data', targetPath);
        }
        console.log(`[FS-OP] Resolved relative path: ${targetPath} → ${resolvedPath}`);
      }

      let resolvedDest = dest;
      if (dest) {
        if (dest.includes('${resolvedNotesPath}') || dest.includes('$resolvedNotesPath')) {
          console.warn(`[FS-OP] WARNING: AI used literal template variable in dest "${dest}". Fixing...`);
          resolvedDest = dest.replace(/\$\{?resolvedNotesPath\}?[\\\/]?/g, '');
          if (!resolvedDest || resolvedDest === dest) {
            resolvedDest = app.getPath('documents') + path.sep + 'Nova Data';
          } else {
            resolvedDest = path.join(app.getPath('documents'), 'Nova Data', resolvedDest);
          }
          console.log(`[FS-OP] Fixed literal variable in dest: ${dest} → ${resolvedDest}`);
        }
        else if (!path.isAbsolute(dest)) {
          if (dest.startsWith('Documents\\') || dest.startsWith('Documents/')) {
            resolvedDest = path.join(app.getPath('documents'), dest.substring('Documents\\'.length));
          } else if (dest.startsWith('Nova Data\\') || dest.startsWith('Nova Data/')) {
            resolvedDest = path.join(app.getPath('documents'), dest);
          } else {
            resolvedDest = path.join(app.getPath('documents'), 'Nova Data', dest);
          }
        }
      }

      if (resolvedPath) resolvedPath = path.resolve(resolvedPath);
      if (resolvedDest) resolvedDest = path.resolve(resolvedDest);

      switch (operation) {
        case 'read-dir': 
          const files = fs.readdirSync(resolvedPath);
          if (files.length > 50) {
            return [...files.slice(0, 50), `... and ${files.length - 50} more items (Truncated for stability)`];
          }
          return files;
        case 'create-dir':
          if (!fs.existsSync(resolvedPath)) fs.mkdirSync(resolvedPath, { recursive: true });
          return true;
        case 'write-file':
          const dir = path.dirname(resolvedPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(resolvedPath, content || '');
          return true;
        case 'read-file': return fs.readFileSync(resolvedPath, 'utf8');
        case 'delete': fs.rmSync(resolvedPath, { recursive: true, force: true }); return true;
        case 'exists': return fs.existsSync(resolvedPath);
        case 'rename': fs.renameSync(resolvedPath, resolvedDest); return true;
        case 'copy-file': fs.copyFileSync(resolvedPath, resolvedDest); return true;
      }
    } catch (e) { throw e; }
  });


  ipcMain.handle('system-open', async (event, { target }) => {
    const open = (await import('open')).default;
    await open(target);
    return true;
  });

  ipcMain.handle('system-exec-command', async (event, { command }) => {
    return new Promise((resolve) => {
      exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ success: !error, stdout, stderr, error: error?.message });
      });
    });
  });

  ipcMain.handle('save-image', async (event, { base64Data }) => {
    try {
      const filePath = path.join(app.getPath('downloads'), `NOVA_Generated_${Date.now()}.png`);
      const buffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ""), 'base64');
      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch (e) { throw e; }
  });

  ipcMain.handle('read-file-content', async (event, { path: filePath }) => {
    try {
      console.log(`[File-Reader] Reading file: ${filePath}`);
      if (!fs.existsSync(filePath)) {
        console.error(`[File-Reader] File not found: ${filePath}`);
        return { error: 'File not found' };
      }

      const mimeType = mime.lookup(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const buffer = fs.readFileSync(filePath);
      console.log(`[File-Reader] Detected Mime: ${mimeType}, Ext: ${ext}, Size: ${buffer.length} bytes`);

      if (mimeType === 'application/pdf' || ext === '.pdf') {
        console.log(`[File-Reader] Parsing PDF...`);
        const data = await PDFParse(buffer);
        console.log(`[File-Reader] PDF Parsed. Content length: ${data.text?.length || 0}`);
        return { content: data.text };
      }
      else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') {
        console.log(`[File-Reader] Parsing Docx...`);
        const result = await mammoth.extractRawText({ buffer });
        console.log(`[File-Reader] Docx Parsed. Content length: ${result.value?.length || 0}`);
        return { content: result.value };
      }
      else if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/javascript' || ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.css'].includes(ext)) {
        console.log(`[File-Reader] Reading as Text...`);
        return { content: buffer.toString('utf8') };
      }

      console.warn(`[File-Reader] Unsupported file type: ${mimeType}`);
      return { content: `[Binary/Image File: ${path.basename(filePath)}]. The content of this file is visual or binary.` };

    } catch (e) {
      console.error('[File-Reader] CRITICAL ERROR:', e);
      return { error: e.message };
    }
  });

  ipcMain.handle('pick-and-read-files', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Multimodal Files', extensions: ['jpg', 'png', 'jpeg', 'webp', 'pdf', 'doc', 'docx', 'txt', 'mp3', 'wav', 'mpeg'] }
      ]
    });

    if (canceled) return [];

    const results = [];
    for (const filePath of filePaths) {
      const stats = fs.statSync(filePath);
      // Limit to 50MB per file for inline playback safely
      if (stats.size > 50 * 1024 * 1024) {
        continue;
      }

      const buffer = fs.readFileSync(filePath);
      const mimeType = mime.lookup(filePath) || 'application/octet-stream';
      results.push({
        name: path.basename(filePath),
        data: buffer.toString('base64'),
        mimeType,
        path: filePath
      });
    }
    return results;
  });

  ipcMain.handle('studio:execute-edit', async (event, data) => {
    if (app.novaStudioController) {
      return await app.novaStudioController.executeEdit(data);
    }
    return { success: false, error: 'Studio Controller not initialized' };
  });

  ipcMain.handle('studio:select-sd-path', async () => {
    const result = dialog.showOpenDialogSync(mainWindow, {
      title: 'Selecionar Pasta do Stable Diffusion',
      properties: ['openDirectory']
    });
    return result ? result[0] : null;
  });

  let sdProcess = null;
  ipcMain.handle('studio:boot-engine', async (event, sdPath) => {
    if (!sdPath || !fs.existsSync(sdPath)) {
        return { success: false, error: 'Invalid Stable Diffusion path' };
    }

    const batPath = path.join(sdPath, process.platform === 'darwin' ? 'webui.sh' : 'webui-user.bat');
    if (!fs.existsSync(batPath)) {
        return { success: false, error: 'webui-user.bat not found in selected folder' };
    }

    try {
        if (sdProcess) {
        }

        sdProcess = spawn(process.platform === 'darwin' ? '/bin/bash' : 'cmd.exe', process.platform === 'darwin' ? ['webui.sh', '--api'] : ['/c', 'webui-user.bat', '--api', '--xformers'], {
            cwd: sdPath,
            detached: true,
            stdio: 'ignore'
        });
        sdProcess.unref();

        let checkCounter = 0;
        const checkInterval = setInterval(async () => {
            checkCounter++;
            try {
                const response = await axios.get('http://127.0.0.1:7860/sdapi/v1/options', { timeout: 1000 });
                if (response.status === 200) {
                    clearInterval(checkInterval);
                    mainWindow.webContents.send('studio:engine-status', { status: 'LIVE' });
                }
            } catch (e) {
            }

            if (checkCounter > 120) {
                clearInterval(checkInterval);
                mainWindow.webContents.send('studio:engine-status', { status: 'TIMEOUT' });
            }
        }, 3000);

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
  });

  ipcMain.handle('studio:get-engine-status', async () => {
    try {
        const response = await axios.get('http://127.0.0.1:7860/sdapi/v1/options', { timeout: 500 });
        return { status: response.status === 200 ? 'LIVE' : 'OFFLINE' };
    } catch (e) {
        return { status: 'OFFLINE' };
    }
  });


  ipcMain.on('studio:open', (event, val) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-studio', val);
    }
  });


  ipcMain.handle('clipboard-read', async () => {
    try {
      return {
        text: clipboard.readText(),
        html: clipboard.readHTML(),
        image: clipboard.readImage().isEmpty() ? null : clipboard.readImage().toDataURL()
      };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('clipboard-write', async (event, { text, html, image }) => {
    try {
      if (text) clipboard.writeText(text);
      if (html) clipboard.writeHTML(html);
      if (image) {
        const img = nativeImage.createFromDataURL(image);
        clipboard.writeImage(img);
      }
      return { success: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('take-screenshot', async () => {
    try {
      const { screen, desktopCapturer } = require('electron');
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height }
      });

      if (!sources || sources.length === 0) {
        return { success: false, error: 'No screen sources found' };
      }

      const source = sources[0];
      let img = source.thumbnail;

      // Resizing to maximum width of 1024px to keep base64 size under 200KB
      const imgSize = img.getSize();
      if (imgSize.width > 1024) {
        const scale = 1024 / imgSize.width;
        img = img.resize({
          width: 1024,
          height: Math.round(imgSize.height * scale),
          quality: 'better'
        });
      }

      const pngBuffer = img.toPNG();

      return {
        success: true,
        data: pngBuffer.toString('base64'),
        mimeType: 'image/png'
      };
    } catch (e) {
      console.error('[Screenshot] Error:', e.message);
      return { success: false, error: e.message };
    }
  });

  // Window minimize/restore — used by Trade Signal Scanner to hide Nova before capture
  ipcMain.handle('window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.handle('window-restore', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.restore();
      mainWindow.focus();
    }
  });




  ipcMain.handle('get-screen-sources', async () => {
    try {
      // CRITICAL FIX: types: ['screen'] ONLY — never include 'window'.
      // Window-type sources capture a specific app's content independently
      // of the compositor. If a browser window is in the list and gets
      // selected, the stream shows that browser even when it's behind Nova.
      // Screen-type sources capture the TRUE composited display output.
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 320, height: 180 }
      });
      console.log('[Electron] Screen sources available:', sources.map(s => `${s.id} | ${s.name}`));
      return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        // Include thumbnail dimensions so renderer can pick the largest (primary) screen
        width: source.thumbnail.getSize().width,
        height: source.thumbnail.getSize().height,
        display_id: source.display_id || ''
      }));
    } catch (e) {
      console.error('[Electron] get-screen-sources error:', e.message);
      return { error: e.message };
    }
  });

  ipcMain.handle('send-notification', async (event, { title, body, icon }) => {
    try {
      const notification = new Notification({
        title: title || 'Nova AI',
        body: body || '',
        icon: icon || undefined
      });
      notification.show();
      return { success: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('http-fetch', async (event, { url, method, headers, body }) => {
    try {
      const response = await axios({
        url,
        method: method || 'GET',
        headers: headers || {},
        data: body || undefined,
        timeout: 30000
      });
      return {
        success: true,
        status: response.status,
        data: response.data,
        headers: response.headers
      };
    } catch (e) {
      return {
        error: e.message,
        status: e.response?.status,
        data: e.response?.data
      };
    }
  });

  let lastCpuStats = os.cpus();
  ipcMain.handle('get-realtime-system-metrics', async () => {
    try {
      const currentCpuStats = os.cpus();
      let idleDiff = 0, totalDiff = 0;
      for (let i = 0; i < currentCpuStats.length && i < lastCpuStats.length; i++) {
        const prev = lastCpuStats[i].times;
        const curr = currentCpuStats[i].times;
        const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
        const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
        totalDiff += (currTotal - prevTotal);
        idleDiff += (curr.idle - prev.idle);
      }
      lastCpuStats = currentCpuStats;

      const cpuPercent = totalDiff > 0 ? Math.min(100, Math.max(2, Math.round(((totalDiff - idleDiff) / totalDiff) * 100))) : 8;
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memPercent = Math.min(100, Math.max(5, Math.round(((totalMem - freeMem) / (totalMem || 1)) * 100)));
      const gpuPercent = Math.min(100, Math.max(3, Math.round(cpuPercent * 0.45 + 8)));
      const temperature = +(38.5 + (cpuPercent * 0.31)).toFixed(1);

      return {
        cpu: cpuPercent,
        mem: memPercent,
        gpu: gpuPercent,
        temperature: temperature,
        online: true
      };
    } catch (e) {
      return { error: e.message, cpu: 12, mem: 45, gpu: 10, temperature: 42.0, online: true };
    }
  });

  ipcMain.handle('get-detailed-system-info', async () => {
    try {
      const [cpu, mem, graphics, os, network, battery] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.graphics(),
        si.osInfo(),
        si.networkInterfaces(),
        si.battery()
      ]);
      return { cpu, mem, graphics, os, network, battery };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('window-control', async (event, { action }) => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return { error: 'No focused window' };

      switch (action) {
        case 'minimize': win.minimize(); break;
        case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
        case 'close': win.close(); break;
        case 'fullscreen': win.setFullScreen(!win.isFullScreen()); break;
      }
      return { success: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('get-processes', async () => {
    try {
      const processes = await si.processes();
      const sorted = processes.list
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 20)
        .map(p => ({ name: p.name, pid: p.pid, cpu: p.cpu, mem: p.mem }));
      return sorted;
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('kill-process', async (event, { pid }) => {
    try {
      process.kill(pid);
      return { success: true };
    } catch (e) { return { error: e.message }; }
  });


  ipcMain.handle('whatsapp-init', async () => {
    try {
      if (!whatsappManager) {
        whatsappManager = new WhatsAppManager(mainWindow, app);
      } else {
        whatsappManager.updateMainWindow(mainWindow);
      }
      await whatsappManager.initialize();
      return { success: true, state: whatsappManager.getState() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('whatsapp-get-state', async () => {
    try {
      if (!whatsappManager) {
        return {
          status: 'disconnected',
          reason: null,
          isReady: false,
          isInitializing: false,
          qrCode: null,
          reconnectAttempts: 0
        };
      }
      return whatsappManager.getState();
    } catch (_e) {
      return {
        status: 'disconnected',
        reason: 'state-read-failed',
        isReady: false,
        isInitializing: false,
        qrCode: null,
        reconnectAttempts: 0
      };
    }
  });

  ipcMain.handle('get-whatsapp-settings', async () => {
    try {
      const p = getWhatsAppSettingsPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return { autoConnect: false };
    } catch (e) { return { autoConnect: false }; }
  });

  ipcMain.handle('save-whatsapp-settings', async (event, settings) => {
    try {
      const settingsPath = getWhatsAppSettingsPath();
      const currentSettings = fs.existsSync(settingsPath)
        ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        : {};
      const mergedSettings = { ...currentSettings, ...(settings || {}) };
      fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
      return true;
    } catch (e) { return false; }
  });


  ipcMain.handle('whatsapp-logout', async () => {
    try {
      if (whatsappManager) {
        await whatsappManager.logout();
      }
      return { success: true, state: whatsappManager ? whatsappManager.getState() : null };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('whatsapp-send-reply', async (event, { chatId, message, isMimicry = false, removeSignature = false }) => {
    try {
      if (whatsappManager) {
        let sent = false;
        if (isMimicry) {
            sent = await whatsappManager.sendReplyWithMimicry(chatId, message, !removeSignature);
        } else {
            sent = await whatsappManager.sendReply(chatId, message, removeSignature);
        }
        if (sent) return { success: true };
        return { success: false, error: 'WhatsApp client is not ready or message failed to send.' };
      }
      return { success: false, error: 'WhatsApp Manager not initialized' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });


  const getTelegramSettingsPath = () => path.join(app.getPath('userData'), 'telegram_settings.json');

  ipcMain.handle('telegram-init', async (event, args) => {
    try {
      if (!telegramManager) {
        telegramManager = new TelegramManager(mainWindow, app);
      } else {
        telegramManager.updateMainWindow(mainWindow);
      }
      if (args && args.apiId && args.apiHash) {
        const result = await telegramManager.initialize({
          apiId: args.apiId,
          apiHash: args.apiHash,
          sessionString: args.sessionString || ''
        });
        return result;
      }
      await telegramManager.autoConnect();
      return { success: true, state: telegramManager.getState() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('telegram-get-state', async () => {
    try {
      if (!telegramManager) {
        return {
          status: 'disconnected',
          reason: null,
          isReady: false,
          isInitializing: false
        };
      }
      return telegramManager.getState();
    } catch (_e) {
      return {
        status: 'disconnected',
        reason: 'state-read-failed',
        isReady: false,
        isInitializing: false
      };
    }
  });

  ipcMain.handle('get-telegram-settings', async () => {
    try {
      const p = getTelegramSettingsPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return { autoConnect: false };
    } catch (e) { return { autoConnect: false }; }
  });

  ipcMain.handle('save-telegram-settings', async (event, settings) => {
    try {
      const settingsPath = getTelegramSettingsPath();
      const currentSettings = fs.existsSync(settingsPath)
        ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        : {};
      const mergedSettings = { ...currentSettings, ...(settings || {}) };
      fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));

      if (telegramManager) {
        telegramManager.loadSettings();
      }
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('telegram-send-otp', async (event, { phone, apiId, apiHash }) => {
    try {
      if (!telegramManager) {
        telegramManager = new TelegramManager(mainWindow, app);
      } else {
        telegramManager.updateMainWindow(mainWindow);
      }
      const result = await telegramManager.sendOtpCode({ phone, apiId, apiHash });
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('telegram-send-qr', async (event, { apiId, apiHash }) => {
    try {
      if (!telegramManager) {
        telegramManager = new TelegramManager(mainWindow, app);
      } else {
        telegramManager.updateMainWindow(mainWindow);
      }
      const result = await telegramManager.sendQrCode({ apiId, apiHash });
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('telegram-submit-code', async (event, { code }) => {
    try {
      if (telegramManager) {
        const result = await telegramManager.submitOtpCode({ code });
        return result;
      }
      return { success: false, error: 'Telegram Manager not initialized' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('telegram-submit-password', async (event, { password }) => {
    try {
      if (telegramManager) {
        const result = await telegramManager.submitPassword({ password });
        return result;
      }
      return { success: false, error: 'Telegram Manager not initialized' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('telegram-logout', async () => {
    try {
      if (telegramManager) {
        await telegramManager.logout();
      }
      return { success: true, state: telegramManager ? telegramManager.getState() : null };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('telegram-send-reply', async (event, { chatId, message, removeSignature = false }) => {
    try {
      if (telegramManager) {
        const sent = await telegramManager.sendReply(chatId, message, removeSignature);
        if (sent) return { success: true };
        return { success: false, error: 'Telegram client is not ready or message failed to send.' };
      }
      return { success: false, error: 'Telegram Manager not initialized' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('remote-access-status', async () => {
    if (remoteAccessService) {
      const status = remoteAccessService.getStatus();
      const activeTokens = Array.from(remoteAccessService.tokens.values()).filter(t => t.active);
      let activeToken = activeTokens.length > 0 ? activeTokens[0].token : null;

      if (!activeToken) {
        const tokenData = remoteAccessService.generateToken('Default Mobile');
        activeToken = tokenData.token;
      }

      const qrResult = await remoteAccessService.generateQRCode(activeToken);

      return {
        ...status,
        activeToken,
        qrCode: qrResult.success ? qrResult.qrCode : null,
        directUrl: qrResult.success ? qrResult.directUrl : null
      };
    }
    return { isRunning: false };
  });

  ipcMain.handle('remote-access-regenerate', async () => {
    if (remoteAccessService) {
      remoteAccessService.tokens.clear();
      const tokenData = remoteAccessService.generateToken('Default Mobile');
      const status = remoteAccessService.getStatus();
      const qrResult = await remoteAccessService.generateQRCode(tokenData.token);

      return {
        success: true,
        activeToken: tokenData.token,
        qrCode: qrResult.success ? qrResult.qrCode : null,
        directUrl: qrResult.success ? qrResult.directUrl : null,
        ...status
      };
    }
    return { success: false, error: 'Remote Access Service not running' };
  });

  ipcMain.handle('remote-access-restart-tunnel', async () => {
    if (remoteAccessService) {
      try {
        console.log('[RemoteAccess] Restarting tunnel via IPC...');
        remoteAccessService.publicUrl = null;
        await remoteAccessService.startCloudflaredTunnel();

        let attempts = 0;
        while (!remoteAccessService.publicUrl && attempts < 20) {
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
        }

        const status = remoteAccessService.getStatus();
        const activeTokens = Array.from(remoteAccessService.tokens.values()).filter(t => t.active);
        const activeToken = activeTokens.length > 0 ? activeTokens[0].token : null;
        const qrResult = activeToken ? await remoteAccessService.generateQRCode(activeToken) : { success: false };

        return {
          success: true,
          activeToken,
          qrCode: qrResult.success ? qrResult.qrCode : null,
          directUrl: qrResult.success ? qrResult.directUrl : null,
          ...status
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'Remote Access Service not running' };
  });

  ipcMain.handle('remote-access-broadcast-response', async (event, { message, timestamp }) => {
    if (remoteAccessService) {
      remoteAccessService.broadcastToMobile('ai-response', { message, timestamp });
    }
  });

  ipcMain.handle('remote-access-broadcast-thinking', async () => {
    if (remoteAccessService) {
      remoteAccessService.broadcastToMobile('ai-thinking');
    }
  });

  ipcMain.handle('open-external-url', async (event, url) => {
    try {
      const { shell } = require('electron');
      await shell.openExternal(url);
      return { success: true };
    } catch (e) {
      console.error('[Main] Failed to open external URL:', e);
      return { success: false, error: e.message };
    }
  });


  ipcMain.handle('send-whatsapp-keyboard', async (event, args) => {
    try {
      const name = String(args?.name || '');
      const message = String(args?.message || '');

      if (!name || !message) {
        console.error('[WhatsApp Robot] Missing name or message:', { name, message });
        return { success: false, error: 'Contact name and message are required' };
      }

      console.log(`\n========== WHATSAPP AUTOMATION START ==========`);
      console.log(`[WhatsApp Robot] Contact: ${name}`);
      console.log(`[WhatsApp Robot] Message: ${message}`);
      console.log(`[WhatsApp Robot] Time: ${new Date().toLocaleTimeString()}`);
      console.log(`[WhatsApp Robot] Method: RobotJS (Native Node.js)`);

      // Import robotjs dynamically (to handle build issues gracefully)
      let robot;
      try {
        robot = require('@jitsi/robotjs');
        console.log(`[WhatsApp Robot] RobotJS loaded successfully`);
      } catch (err) {
        console.error(`[WhatsApp Robot] RobotJS not available:`, err.message);
        return {
          success: false,
          error: 'RobotJS module not installed. Run: npm install robotjs'
        };
      }

      const typeText = (text, delayMs = 50) => {
        for (let i = 0; i < text.length; i++) {
          robot.typeString(text[i]);
          robot.keyTap('backspace');
          robot.typeString(text[i]);
          if (delayMs > 0) {
            const start = Date.now();
            while (Date.now() - start < delayMs);
          }
        }
      };

      const sleep = (ms) => {
        const start = Date.now();
        while (Date.now() - start < ms);
      };

      console.log(`[WhatsApp Robot] Step 1: Opening WhatsApp Desktop...`);
      exec(process.platform === 'darwin' ? 'open -a WhatsApp' : 'start whatsapp:', (err) => {
        if (err) console.warn('[WhatsApp Robot] Could not open via protocol, trying direct exe...');
      });

      console.log(`[WhatsApp Robot] Waiting 4 seconds for WhatsApp to load...`);
      sleep(4000);
      console.log(`[WhatsApp Robot] Step 1 Complete`);

      console.log(`[WhatsApp Robot] Step 2: Pressing Ctrl+N to open new chat...`);
      robot.keyTap('n', process.platform === 'darwin' ? 'command' : 'control');
      sleep(1500);
      console.log(`[WhatsApp Robot] Step 2 Complete`);

      console.log(`[WhatsApp Robot] Step 3: Typing contact name: ${name}`);
      robot.typeString(name);
      sleep(1500);
      console.log(`[WhatsApp Robot] Step 3 Complete`);

      console.log(`[WhatsApp Robot] Step 4: Pressing Enter to select contact...`);
      robot.keyTap('enter');
      sleep(1000);
      console.log(`[WhatsApp Robot] Step 4 Complete`);

      console.log(`[WhatsApp Robot] Step 5: Typing message (${message.length} characters)...`);
      robot.typeString(message);
      sleep(800);
      console.log(`[WhatsApp Robot] Step 5 Complete`);

      console.log(`[WhatsApp Robot] Step 6: Pressing Enter to send message...`);
      robot.keyTap('enter');
      console.log(`[WhatsApp Robot] Step 6 Complete`);

      console.log(`\n✅✅✅ WHATSAPP AUTOMATION SUCCESS ✅✅✅\n`);
      return {
        success: true,
        output: 'Message sent successfully using RobotJS',
        method: 'robotjs_native'
      };

    } catch (error) {
      console.error(`\n========== CRITICAL ERROR ==========`);
      console.error(error);
      console.error(`========== ERROR END ==========\n`);

      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('keyboard-press', async (event, { key }) => {
    if (process.platform === 'darwin') { try { return await macNative.pressKey(key); } catch(e) { return {success:false,error:e.message}; } }
    try {
      const keyMap = {
        'enter': '{ENTER}',
        'tab': '{TAB}',
        'escape': '{ESC}',
        'backspace': '{BACKSPACE}',
        'delete': '{DELETE}',
        'up': '{UP}',
        'down': '{DOWN}',
        'left': '{LEFT}',
        'right': '{RIGHT}',
        'home': '{HOME}',
        'end': '{END}',
        'pageup': '{PGUP}',
        'pagedown': '{PGDN}',
        'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}',
        'f5': '{F5}', 'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}',
        'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}',
        'ctrl+a': '^a', 'ctrl+c': '^c', 'ctrl+v': '^v', 'ctrl+x': '^x',
        'ctrl+z': '^z', 'ctrl+s': '^s', 'ctrl+enter': '^{ENTER}',
        'alt+f4': '%{F4}', 'alt+tab': '%{TAB}'
      };

      const lowerKey = key.toLowerCase();
      const sendKey = keyMap[lowerKey] || key;

      // Built-in delay: If it's Enter, ALWAYS wait 8 seconds.
      const isEnter = lowerKey === 'enter';

      const psCommand = isEnter
        ? `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Seconds 8; [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')`
        : `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')`;

      return new Promise((resolve) => {
        exec(`powershell -Command "${psCommand}"`, { timeout: 30000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ error: error.message });
          } else {
            resolve({ success: true, key: sendKey, delayed: isEnter });
          }
        });
      });
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('keyboard-type', async (event, { text, pressEnter }) => {
    if (process.platform === 'darwin') { try { return await macNative.typeText(text, pressEnter); } catch(e) { return {success:false,error:e.message}; } }
    try {
      const escapedText = text
        .replace(/\+/g, '{+}')
        .replace(/\^/g, '{^}')
        .replace(/%/g, '{%}')
        .replace(/~/g, '{~}')
        .replace(/\(/g, '{(}')
        .replace(/\)/g, '{)}')
        .replace(/\[/g, '{[}')
        .replace(/\]/g, '{]}')
        .replace(/\{/g, '{{}')
        .replace(/\}/g, '{}}');

      let psCommand;
      if (pressEnter) {
        // If pressing enter, type text, WAIT 2 SECONDS, then press Enter
        psCommand = `
          Add-Type -AssemblyName System.Windows.Forms;
          [System.Windows.Forms.SendKeys]::SendWait('${escapedText}');
          Start-Sleep -Seconds 5;
          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
        `;
      } else {
        psCommand = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapedText}')`;
      }

      return new Promise((resolve) => {
        exec(`powershell -Command "${psCommand}"`, { timeout: 20000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ error: error.message });
          } else {
            resolve({ success: true, typed: text, enterPressed: pressEnter });
          }
        });
      });
    } catch (e) { return { error: e.message }; }
  });


  ipcMain.handle('check-for-update', async () => {
    if (process.platform === 'darwin') return {success:false,message:'Este port local para macOS não tem feed de atualização.'};
    if (!app.isPackaged) {
      return { success: false, message: 'Bypassed in dev mode' };
    }
    if (!hasUpdateConfig()) return { success: false, message: 'Esta instalação não tem feed de atualização.' };
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, version: result?.updateInfo?.version };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('download-update', async () => {
    if (process.platform === 'darwin') return {success:false,message:'Este port local para macOS não tem feed de atualização.'};
    if (!hasUpdateConfig()) return { success: false, message: 'Esta instalação não tem feed de atualização.' };
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('install-update', async () => {
    if (!hasUpdateConfig()) return { success: false, message: 'Esta instalação não tem feed de atualização.' };
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  });

  ipcMain.handle('get-app-version', async () => {
    return app.getVersion();
  });

  try {
    const { registerBrowserHandlers, browserService } = require('./services/browser-manager');
    registerBrowserHandlers();

    const { startCdpShim } = require('./services/cdp-shim');
    startCdpShim().catch(err => {
      console.error('[Main] Failed to start CDP shim:', err.message);
    });
  } catch (e) {
    console.error('Failed to register browser handlers:', e);
  }

  ipcMain.handle('sync-configuration-backup', async (event, { action }) => {
    if (action === 'export') return syncConfigurationBackup();
    if (action === 'import') return restoreConfigurationBackup();
    return { success: false, error: 'Invalid action' };
  });

  let geminiBrowserEngine = null;
  try {
    geminiBrowserEngine = require('./services/gemini-browser-engine');
  } catch (e) {
    console.warn('[Main] GeminiBrowserEngine not available:', e.message);
  }

  ipcMain.handle('gemini-account:status', async () => {
    if (!geminiBrowserEngine) return { isLoggedIn: false, email: null, models: [], selectedModel: null };
    return {
      ...geminiBrowserEngine.getAuthStatus(),
      models:        geminiBrowserEngine.AVAILABLE_MODELS,
      selectedModel: geminiBrowserEngine.getSelectedModel(),
    };
  });

  ipcMain.handle('gemini-account:login', async () => {
    if (!geminiBrowserEngine) return { success: false, error: 'Engine not available' };
    try {
      const result = await geminiBrowserEngine.openGoogleLoginWindow(mainWindow);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('gemini-account:status-changed', {
          ...geminiBrowserEngine.getAuthStatus(),
          models:        geminiBrowserEngine.AVAILABLE_MODELS,
          selectedModel: geminiBrowserEngine.getSelectedModel(),
        });
      }
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('gemini-account:logout', async () => {
    if (!geminiBrowserEngine) return { success: false, error: 'Engine not available' };
    const result = await geminiBrowserEngine.logoutSession();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gemini-account:status-changed', {
        isLoggedIn: false, email: null,
        models: geminiBrowserEngine.AVAILABLE_MODELS,
        selectedModel: geminiBrowserEngine.getSelectedModel(),
      });
    }
    return result;
  });

  ipcMain.handle('gemini-account:set-model', async (event, model) => {
    if (!geminiBrowserEngine) return false;
    geminiBrowserEngine.setSelectedModel(model);
    return true;
  });

  ipcMain.handle('gemini-account:send-message', async (event, payload) => {
    if (!geminiBrowserEngine) return { success: false, error: 'Engine not available' };
    try {
      const response = await geminiBrowserEngine.sendMessage(payload);
      return response;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });


  browserFarmService.registerIPC();

}



function startWakeWordDetector(mainWindow) {
  if (wakeWordProcess || isShuttingDown() || process.env.NOVA_SMOKE_TEST === '1') return;

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  const scriptPath = isDev
    ? path.join(__dirname, '../wake_word_bg.py')
    : path.join(process.resourcesPath, 'wake_word_bg.py');

  console.log(`Starting Wake Word Detector (Python) from: ${scriptPath}`);
  wakeWordProcess = spawn(process.platform === 'darwin' ? (macNative.python()) : 'python', [scriptPath]);
  wakeWordProcess.on('error', error => { console.error('[WakeWord]',error.message); wakeWordProcess = null; });

  wakeWordProcess.stdout.on('data', (data) => {
    try {
      const output = data.toString().trim();
      const lines = output.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const result = JSON.parse(line);
        mainWindow.webContents.send('wake-word-detected', result);
      }
    } catch (e) {
      console.error('Error parsing wake word output:', e);
    }
  });

  wakeWordProcess.stderr.on('data', (data) => {
    console.error(`Wake Word Error: ${data}`);
  });

  wakeWordProcess.on('close', (code) => {
    console.log(`Wake word process exited with code ${code}`);
    wakeWordProcess = null;
  });
}

function stopWindowServices() {
  const pending = [];
  if (productionServer) {
    productionServer.close();
    productionServer = null;
  }

  if (remoteAccessService) {
    pending.push(remoteAccessService.stop());
    remoteAccessService = null;
  }

  if (wakeWordProcess) {
    wakeWordProcess.kill();
    wakeWordProcess = null;
  }

  if (whatsappManager) {
    pending.push(whatsappManager.shutdown());
    whatsappManager = null;
  }

  return Promise.allSettled(pending).then(results => {
    for (const result of results) {
      if (result.status === 'rejected') console.error('[Shutdown]', result.reason);
    }
  });
}

const { menuTemplate, extraShutdownTasks, runShutdownTasks, guardBeforeQuit } = require('./services/nova-desktop-parity');
const shutdownExtras = () => extraShutdownTasks({
  app,
  getIosBridge: () => require('./services/ios-bridge'),
  rtmp: RtmpServerService,
  getTelegram: () => telegramManager,
});

let isShuttingDown = () => false;
if (process.platform === 'darwin') {
  const { createProcessCleanup, registerShutdown } = require('./services/nova-shutdown');
  const helpersPath = path.join(process.resourcesPath, '..', 'Frameworks') + path.sep;
  const processCleanup = createProcessCleanup(helpersPath);
  isShuttingDown = registerShutdown(app, async () => {
    await runShutdownTasks([stopWindowServices, ...shutdownExtras()]);
  }, processCleanup);
  process.on('SIGTERM', () => app.quit());
  process.on('SIGINT', () => app.quit());
}

if (process.platform !== 'darwin') {
  guardBeforeQuit(app, () => runShutdownTasks([stopWindowServices, ...shutdownExtras()]));
}

app.on('window-all-closed', () => {
  if (!isShuttingDown()) app.quit();
});

// Test instance: isolated userData + port so a second copy can run alongside.
if (process.env.NOVA_TEST_INSTANCE === '1') {
  try {
    app.setPath('userData', path.join(require('os').tmpdir(), 'nova-test-instance'));
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
  } catch (err) { console.error('[TestInstance]', err.message); }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const { session } = require('electron');
    setupPermissions(session);

    try {
      if (process.env.NOVA_SMOKE_TEST !== '1') RtmpServerService.startRtmpServer();
    } catch (err) {
      console.error('[RTMP] Failed to start node-media-server:', err);
    }

    try {
      require('./services/ios-bridge').start();
    } catch (err) {
      console.error('[iOSBridge] Failed to start:', err.message);
    }

    // Initialize Web Adblocker with local cache (Technique 2) - Disabled due to compatibility issues with Electron 34 causing Network Service crashes

    // ===== CRITICAL: Configure CSP to allow YouTube embeds in production =====
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
            "connect-src * ws: wss: data: blob:; " +
            "media-src * data: blob:; " +
            "frame-src *; " +
            "img-src * data: blob:; " +
            "script-src * 'unsafe-inline' 'unsafe-eval'; " +
            "style-src * 'unsafe-inline'; " +
            "font-src * data:;"
          ]
        }
      });
    });

    // PRODUCTION: Remove CSP completely for local file protocol
    session.defaultSession.webRequest.onHeadersReceived({ urls: ['file://*'] }, (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      delete responseHeaders['Content-Security-Policy'];
      delete responseHeaders['content-security-policy'];
      callback({ responseHeaders });
    });

    try {
      const { inventoryManager } = require('./services/inventory-manager');
      inventoryManager.init(() => whatsappManager);
    } catch (err) {
      console.error('[Inventory] Failed to initialize inventoryManager:', err);
    }

    try {
      const RemoteAccessService = require('./services/remote-access');
      remoteAccessService = new RemoteAccessService(app);
      remoteAccessService.setDesktopCallback((event, data) => {
        if (mainWindow) {
          mainWindow.webContents.send('remote-mobile-event', { event, data });
        }
      });
      remoteAccessService.start().then(() => {
        console.log('[RemoteAccess] Remote Access Service started successfully.');
      }).catch(err => {
        console.error('[RemoteAccess] Failed to start Remote Access Service:', err);
      });
    } catch (err) {
      console.error('[RemoteAccess] Failed to load Remote Access Service:', err);
    }

    registerHandlers();

    const createdWindow = createWindow();

    // Identidade simulada: tem de vir DEPOIS do createWindow, que é quem cria o
    // app.physicalMobileService — registrado antes, o módulo lança 'service obrigatório'.
    try { require('./services/identidade-ipc').register(app, ipcMain); } catch (e) { console.error('[identidade] IPC nao registrado:', e && e.message); }

    autoUpdater.on('checking-for-update', () => {
      console.log('🔍 [NOVA UPDATE] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('🎉 [NOVA UPDATE] Update available:', info.version);
      console.log('   Release Date:', info.releaseDate);
      console.log('   Current Version:', app.getVersion());
      if (createdWindow) {
        createdWindow.webContents.send('update-available', {
          version: info.version,
          releaseDate: info.releaseDate
        });
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('✓ [NOVA UPDATE] No updates available. Current version is latest:', app.getVersion());
    });

    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent);
      console.log(`📥 [NOVA UPDATE] Download progress: ${percent}% (${(progress.transferred / 1024 / 1024).toFixed(1)}MB / ${(progress.total / 1024 / 1024).toFixed(1)}MB)`);
      if (createdWindow) {
        createdWindow.webContents.send('update-download-progress', {
          percent: percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total
        });
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('✅ [NOVA UPDATE] Update downloaded successfully:', info?.version);
      if (createdWindow) {
        createdWindow.webContents.send('update-downloaded', { version: info?.version });
      }
    });

    autoUpdater.on('error', (err) => {
      console.error('❌ [NOVA UPDATE ERROR]:', err.message);
      console.error('Full error details:', err);

      if (createdWindow) {
        createdWindow.webContents.send('update-error', {
          message: err.message,
          code: err.code,
          stack: err.stack
        });
      }
    });

    if (app.isPackaged) {
      setTimeout(() => {
        if (process.platform !== 'darwin' && hasUpdateConfig()) autoUpdater.checkForUpdates().catch(err => {
          console.log('[AutoUpdater] Production check failed:', err.message);
        });
      }, 5000);
    } else {
      console.log('✓ [Dev Mode] Auto-Updater strictly bypassed to prevent Code 2 errors.');
    }

    if (createdWindow) startWakeWordDetector(createdWindow);

    app.on('activate', () => {
      if (isShuttingDown()) return;
      if (BrowserWindow.getAllWindows().length === 0) {
        const win = createWindow();
        if (whatsappManager) {
          whatsappManager.updateMainWindow(win);
        }
        if (telegramManager) {
          telegramManager.updateMainWindow(win);
        }
        startWakeWordDetector(win);
      }
    });
  });
}
