/**
 * ═══════════════════════════════════════════════════════════════════
 *   NOVA STUDIO — Gemini Browser Engine v1.0
 *   electron/services/gemini-browser-engine.js
 *
 *   PURPOSE:
 *   Instead of using API keys (which have strict per-day quotas),
 *   this engine opens a Puppeteer-controlled browser session logged
 *   into the user's own Google Account, then sends requests directly
 *   to the Gemini web API endpoint that the browser client uses.
 *   Session cookies are persisted to disk so the user only logs in once.
 *
 *   SUPPORTED MODELS (web-tier names):
 *     gemini-pro          → "Gemini 1.5 Pro"
 *     gemini-flash        → "Gemini 1.5 Flash"
 *     gemini-advanced     → "Gemini Advanced (Ultra 1.0)"
 *     gemini-3.7-flash    → "Gemini 3.7 Flash"
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

const { BrowserWindow, session, app } = require('electron');
const path  = require('path');
const fs    = require('fs');
const axios = require('axios');


const SESSION_PARTITION = 'persist:nova_pro';
const SESSION_PATH      = path.join(app.getPath('userData'), 'NovaHardSession');
const GEMINI_ORIGIN     = 'https://gemini.google.com';
const GOOGLE_LOGIN_URL  = 'https://accounts.google.com/signin/v2/identifier?continue=https://gemini.google.com/&hl=en';
const GEMINI_API_HOST   = 'https://gemini.google.com';

const getAuthStatePath  = () => path.join(app.getPath('userData'), 'gemini_account_auth.json');
const getModelPrefPath  = () => path.join(app.getPath('userData'), 'gemini_browser_model.json');


let loginWindow    = null;
let isLoggedIn     = false;
let loggedInEmail  = null;
let selectedModel  = 'gemini-3.8-flash';


function loadAuthState() {
    try {
        const p = getAuthStatePath();
        if (fs.existsSync(p)) {
            const d = JSON.parse(fs.readFileSync(p, 'utf8'));
            isLoggedIn   = !!d.loggedIn;
            loggedInEmail = d.email || null;
        }
    } catch (e) { }
}

function saveAuthState(loggedIn, email) {
    try {
        fs.writeFileSync(getAuthStatePath(), JSON.stringify({ loggedIn, email, updatedAt: Date.now() }, null, 2));
    } catch (e) { }
}

function loadModelPref() {
    try {
        const p = getModelPrefPath();
        if (fs.existsSync(p)) {
            const d = JSON.parse(fs.readFileSync(p, 'utf8'));
            selectedModel = d.model || 'gemini-3.8-flash';
        }
    } catch (e) { }
}

function saveModelPref(model) {
    try {
        fs.writeFileSync(getModelPrefPath(), JSON.stringify({ model, updatedAt: Date.now() }, null, 2));
    } catch (e) { }
}


/**
 * Opens a dedicated login window using the persistent Electron session.
 * The window navigates to Google Sign-In, and we watch for the redirect
 * back to gemini.google.com to confirm login success.
 *
 * @param {BrowserWindow} parentWindow  Main Nova window (for positioning)
 * @returns {Promise<{success:boolean, email:string|null}>}
 */
function openGoogleLoginWindow(parentWindow) {
    return new Promise(async (resolve) => {
        if (loginWindow) {
            return resolve({ success: false, email: null });
        }
        loginWindow = true;

        try {
            const { browserService } = require('./browser-manager');
            const { chromium } = require('playwright');
            const geminiSession = session.fromPartition(SESSION_PARTITION);

            if (!browserService.isInitialized) {
                console.log('[NOVA] Playwright not running, launching...');
                await browserService.launch();
            }

            const context = browserService.context;
            if (!context) {
                throw new Error('Playwright context not available');
            }

            const loginPage = await context.newPage();
            let resolved = false;

            const finish = async (success) => {
                if (resolved) return;
                resolved = true;
                loginWindow = null;

                if (success) {
                    try {
                        const cookies = await context.cookies();
                        for (const c of cookies) {
                            const domain = c.domain.startsWith('.') ? c.domain : c.domain;
                            try {
                                await geminiSession.cookies.set({
                                    url: `https://${domain.replace(/^\./, '')}`,
                                    name: c.name,
                                    value: c.value,
                                    domain: domain,
                                    path: c.path || '/',
                                    secure: c.secure || false,
                                    httpOnly: c.httpOnly || false,
                                    expirationDate: c.expires && c.expires > 0 ? c.expires : undefined
                                });
                            } catch (_) {}
                        }
                        console.log('[NOVA] ✅ Google Login SUCCESS — cookies transferred!');
                        isLoggedIn = true;
                        loggedInEmail = 'active_session';
                        saveAuthState(true, loggedInEmail);
                        resolve({ success: true, email: loggedInEmail, coreLinked: true });
                        checkAutoLogin().then(() => startHeartbeat());
                    } catch (err) {
                        console.error('[NOVA] Cookie transfer error:', err);
                        resolve({ success: false, email: null });
                    }
                } else {
                    resolve({ success: false, email: null });
                }

                try { await loginPage.close(); } catch (_) {}
            };

            loginPage.on('framenavigated', async (frame) => {
                if (frame !== loginPage.mainFrame()) return;
                const url = frame.url();
                if (url.startsWith('https://gemini.google.com')) {
                    await finish(true);
                }
            });

            loginPage.on('close', () => finish(false));

            await loginPage.goto(GOOGLE_LOGIN_URL, { waitUntil: 'domcontentloaded' });

        } catch (err) {
            console.error('[NOVA] openGoogleLoginWindow error:', err);
            loginWindow = null;
            resolve({ success: false, email: null });
        }
    });
}



/**
 * Extracts cookies from our persistent session and returns them
 * as a "Cookie: ..." header string for axios requests.
 */
async function getSessionCookieHeader() {
    const geminiSession = session.fromPartition(SESSION_PARTITION);
    const cookies = await geminiSession.cookies.get({ url: GEMINI_ORIGIN });
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}


/**
 * Maps our internal model IDs to the Gemini web API model parameter.
 */
const MODEL_ID_MAP = {
    'gemini-pro':      'gemini-3.8-flash',
    'gemini-flash':    'gemini-3.8-flash',
    'gemini-advanced': 'gemini-advanced',
    'gemini-3.8-flash':'gemini-3.8-flash',
    'gemini-4-argon':  'gemini-4-argon',
    
};

/**
 * Sends a multimodal chat message through the user's browser session.
 */
async function sendMessage({ prompt, imageBase64 = null, model = null, history = [], apiKey = null }) {
    if (!isLoggedIn) {
        return { success: false, error: 'NOT_LOGGED_IN: Please connect your Google Account first.' };
    }

    const modelKey = model || selectedModel;
    // For images, we want to prioritize the model that supports Imagen 3
    const modelsToTry = [modelKey, 'gemini-3.8-flash', 'gemini-4-argon'];
    const apiVersions = ['v1beta', 'v1'];
    let lastError = null;

    const parts = [];
    if (history && history.length > 0) {
        const histCtx = history.slice(-10).map(h => `${h.role === 'user' ? 'User' : 'Nova'}: ${h.text}`).join('\n');
        parts.push({ text: `[Conversation Context]\n${histCtx}\n\n[Current Request]` });
    }
    parts.push({ text: prompt });
    if (imageBase64) {
        const mimeType = imageBase64.match(/^data:([a-z/]+);base64,/)?.[1] || 'image/png';
        const rawB64   = imageBase64.replace(/^data:[a-z/]+;base64,/, '');
        parts.push({ inlineData: { mimeType, data: rawB64 } });
    }

    for (const currentModel of modelsToTry) {
        const apiModelId = MODEL_ID_MAP[currentModel] || currentModel;
        for (const apiVer of apiVersions) {
            try {
                console.log(`[GeminiBrowserEngine] Attempting fetch: ${apiModelId} (${apiVer}) with key: ${apiKey ? 'PRESENT' : 'MISSING'}`);
                const response = await performBrowserFetch(apiModelId, apiVer, parts, apiKey);
                const parsed = JSON.parse(response);

                if (parsed.error) {
                    throw new Error(parsed.error?.message || JSON.stringify(parsed.error));
                }

                const responseParts = parsed?.candidates?.[0]?.content?.parts || [];
                const text = responseParts.map(p => p.text || '').join('') || '';
                const images = responseParts.filter(p => p.inlineData).map(p => ({
                    mimeType: p.inlineData.mimeType,
                    data: p.inlineData.data
                }));

                if (text || images.length > 0) {
                    return { success: true, text, images, model: apiModelId };
                }
            } catch (err) {
                lastError = err;
                console.warn(`[GeminiBrowserEngine] ${apiModelId} (${apiVer}) failed: ${err.message}`);
            }
        }
    }

    return { success: false, error: lastError?.message || 'All fallback models failed.' };
}

/**
 * Internal helper to perform Image Generation via Gemini Web UI Automation.
 * This is the 'True Pro Core' mode.
 */
async function performBrowserFetch(apiModelId, apiVer, parts, apiKey) {
    const promptPart = parts.find(p => p.text)?.text || '';
    
    const geminiSess = session.fromPartition(SESSION_PARTITION);
    return new Promise((resolve, reject) => {
        const automationWin = new BrowserWindow({
            show: false,
            width: 1280, height: 800,
            webPreferences: {
                session: geminiSess,
                nodeIntegration: false,
                contextIsolation: false,
                offscreen: true
            },
        });

        automationWin.webContents.setAudioMuted(true);

        const timeout = setTimeout(() => {
            if (!automationWin.isDestroyed()) automationWin.close();
            reject(new Error('Gemini Web Automation Timed Out (120s)'));
        }, 120000);

        automationWin.loadURL('https://gemini.google.com/app');
        
        automationWin.webContents.once('did-finish-load', async () => {
            try {
                const result = await automationWin.webContents.executeJavaScript(`
                    (async () => {
                        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                        
                        try {
                            // 1. Find the input field
                            const inputArea = document.querySelector('.ql-editor[contenteditable="true"]') || 
                                             document.querySelector('textarea') || 
                                             document.querySelector('[role="textbox"]');
                            
                            if (!inputArea) throw new Error('Could not find Gemini input area');
                            
                            // 2. Type the prompt
                            inputArea.focus();
                            document.execCommand('insertText', false, ${JSON.stringify(promptPart)});
                            
                            // Dispatch input/change/keyup events to update page state
                            const evs = ['input', 'change', 'keyup'];
                            evs.forEach(t => inputArea.dispatchEvent(new Event(t, { bubbles: true })));
                            await sleep(500);
                            
                            // 3. Find and click the Send button using robust selectors
                            const selectors = [
                                'button[aria-label*="Send"]',
                                'button[aria-label*="send"]',
                                'button[aria-label*="Submit"]',
                                'button[aria-label*="submit"]',
                                '.send-button',
                                'button.send-button',
                                '[data-test-id="send-button"]',
                                'button:has(mat-icon[fonticon="send"])',
                                'button:has(svg)',
                                'text-input-send-button button'
                            ];

                            let actualSendBtn = null;
                            for (const sel of selectors) {
                                try {
                                    const btn = document.querySelector(sel);
                                    if (btn && !btn.disabled) {
                                        actualSendBtn = btn;
                                        break;
                                    }
                                } catch(e) {}
                            }

                            if (!actualSendBtn) {
                                const allButtons = Array.from(document.querySelectorAll('button'));
                                actualSendBtn = allButtons.find(b => {
                                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                                    const title = (b.getAttribute('title') || '').toLowerCase();
                                    const text = (b.innerText || '').toLowerCase();
                                    return (aria.includes('send') || title.includes('send') || text.includes('send') || aria.includes('submit')) && !b.disabled;
                                });
                            }

                            if (!actualSendBtn) throw new Error('Could not find Send button');
                            actualSendBtn.click();
                            
                            // 4. Wait for the response and look for images
                            let imageFound = null;
                            for (let i = 0; i < 60; i++) { // Wait up to 60 seconds for Imagen
                                await sleep(1000);
                                
                                // Specific selector for generated images (they are usually in a response container)
                                // We ignore small images (avatars are typically 32-48px)
                                const images = Array.from(document.querySelectorAll('img')).filter(img => {
                                    const rect = img.getBoundingClientRect();
                                    return rect.width > 200 && rect.height > 200 && 
                                           (img.src.includes('googleusercontent.com') || img.src.includes('blob:'));
                                });

                                if (images.length > 0) {
                                    const latestImg = images[images.length - 1];
                                    if (latestImg.complete && latestImg.naturalWidth > 200) {
                                        imageFound = latestImg.src;
                                        break;
                                    }
                                }
                                
                                // Check for error messages
                                if (document.body.innerText.includes('cannot generate') || 
                                    document.body.innerText.includes('I am an AI') || 
                                    document.body.innerText.includes('policy')) {
                                    throw new Error('Gemini refused or could not generate this image.');
                                }
                            }
                            
                            if (!imageFound) throw new Error('Image generation timed out or no image found.');
                            
                            const toBase64 = async (url) => {
                                const blob = await fetch(url).then(r => r.blob());
                                return new Promise((resolve) => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                                    reader.readAsDataURL(blob);
                                });
                            };

                            const base64Data = await toBase64(imageFound);
                            
                            return JSON.stringify({ 
                                candidates: [{ 
                                    content: { 
                                        parts: [{ 
                                            text: "Image generated successfully via Pro Core.",
                                            inlineData: { 
                                                mimeType: 'image/png', 
                                                data: base64Data
                                            } 
                                        }] 
                                    } 
                                }] 
                            });

                        } catch(e) {
                            return JSON.stringify({ error: { message: e.message } });
                        }
                    })()
                `);
                
                clearTimeout(timeout);
                if (!automationWin.isDestroyed()) automationWin.close();
                resolve(result);
            } catch (e) {
                clearTimeout(timeout);
                if (!automationWin.isDestroyed()) automationWin.close();
                reject(e);
            }
        });
    });
}


async function logoutSession() {
    try {
        const geminiSess = session.fromPartition(SESSION_PARTITION);
        await geminiSess.clearStorageData({ storages: ['cookies', 'localstorage', 'sessionstorage'] });
        isLoggedIn    = false;
        loggedInEmail = null;
        saveAuthState(false, null);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}


loadAuthState();
loadModelPref();

/**
 * AUTO-RECONNECT: Check if session already has valid Gemini cookies
 */
async function checkAutoLogin() {
    try {
        const geminiSession = session.fromPartition(SESSION_PARTITION);
        const cookies = await geminiSession.cookies.get({ url: GEMINI_ORIGIN });
        
        // Look for SID or __Secure-1PSID which indicates a logged-in session
        const hasSession = cookies.some(c => c.name === 'SID' || c.name === '__Secure-1PSID' || c.name === 'OSID');
        
        if (hasSession) {
            isLoggedIn = true;
            if (!loggedInEmail) {
                console.log('[GeminiBrowserEngine] Auto-Reconnect: Session found via cookies.');
            }
            return { success: true, loggedIn: true };
        }
        return { success: false, loggedIn: false };
    } catch (e) {
        console.error('[GeminiBrowserEngine] Auto-login check failed:', e);
        return { success: false, loggedIn: false };
    }
}

function setupSessionBypass() {
    const geminiSession = session.fromPartition(SESSION_PARTITION);
    const spoofUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    
    // Override the user agent for all requests in this session to bypass Google's "secure browser" check
    geminiSession.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = spoofUserAgent;
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });
}

if (app.isReady()) {
    setupSessionBypass();
    checkAutoLogin().then(() => startHeartbeat());
} else {
    app.whenReady().then(() => {
        setupSessionBypass();
        checkAutoLogin().then(() => startHeartbeat());
    });
}

/**
 * HEARTBEAT: Periodically check if the session is still alive
 */
function startHeartbeat() {
    setInterval(async () => {
        if (isLoggedIn) {
            const status = await checkAutoLogin();
            if (!status.loggedIn) {
                console.warn('[GeminiBrowserEngine] Heartbeat: Session lost!');
                isLoggedIn = false;
                checkAutoLogin();
            }
        }
    }, 5 * 60 * 1000);
}

module.exports = {
    /** Open the Google Sign-In popup */
    openGoogleLoginWindow,

    /** Send a message using the logged-in session */
    sendMessage,

    /** Logout and clear all cookies */
    logoutSession,

    /** Get current auth status */
    getAuthStatus: () => ({ isLoggedIn, email: loggedInEmail }),

    /** Perform manual auto-login check */
    checkAutoLogin,

    /** Get/set selected model */
    getSelectedModel: () => selectedModel,
    setSelectedModel: (model) => {
        selectedModel = model;
        saveModelPref(model);
    },

    /** List available models */
    AVAILABLE_MODELS: [
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash',         badge: 'BEST'    },
        { id: 'gemini-4-argon',   label: 'Gemini 4 Argon',           badge: 'FRONTIER' },
    ],
};
