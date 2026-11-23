const { exec, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { clipboard } = require('electron');

// The PS1 automation script path (bundled with app or in temp)
const PS_SCRIPT_CONTENT = `
param([int]$SendEnter = 1)
Add-Type -AssemblyName System.Windows.Forms
$sigCode = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace AutoHelper {
    public class Win32 {
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
        [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
        [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
        public static IntPtr FindMainWindow(int processId) {
            IntPtr found = IntPtr.Zero;
            EnumWindows(delegate(IntPtr hwnd, IntPtr param) {
                uint wpid = 0;
                GetWindowThreadProcessId(hwnd, out wpid);
                if ((int)wpid == processId) {
                    var sb = new StringBuilder(512);
                    GetWindowText(hwnd, sb, 512);
                    string title = sb.ToString();
                    if (title.Length > 0 && title != "Default IME" && title != "MSCTFIME UI" && !title.Contains("Chrome Legacy Window")) { found = hwnd; return false; }
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }
    }
}
"@
Add-Type -TypeDefinition $sigCode -Language CSharp -ErrorAction Stop
$procs = Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue | Sort-Object -Property CPU -Descending
$targetHwnd = [IntPtr]::Zero
foreach ($proc in $procs) {
    $hwnd = [AutoHelper.Win32]::FindMainWindow($proc.Id)
    if ($hwnd -ne [IntPtr]::Zero) { $targetHwnd = $hwnd; Write-Output "FOUND:PID=$($proc.Id)|HWND=$hwnd"; break }
}
if ($targetHwnd -eq [IntPtr]::Zero) { Write-Output "ERROR:No Antigravity main window found"; exit 1 }
[AutoHelper.Win32]::ShowWindowAsync($targetHwnd, 9) | Out-Null
Start-Sleep -Milliseconds 300
[AutoHelper.Win32]::ShowWindowAsync($targetHwnd, 3) | Out-Null
Start-Sleep -Milliseconds 300
[AutoHelper.Win32]::keybd_event(0x12, 0, 0, 0)
[AutoHelper.Win32]::keybd_event(0x12, 0, 2, 0)
[AutoHelper.Win32]::BringWindowToTop($targetHwnd) | Out-Null
[AutoHelper.Win32]::SetForegroundWindow($targetHwnd) | Out-Null
[AutoHelper.Win32]::SwitchToThisWindow($targetHwnd, $true)
Start-Sleep -Milliseconds 800
[System.Windows.Forms.SendKeys]::SendWait("^l")
Start-Sleep -Milliseconds 600
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 500
if ($SendEnter -eq 1) { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}"); Write-Output "SUCCESS:Prompt pasted and Enter sent." } else { Write-Output "SUCCESS:Focused and pasted only." }
`;

const SO_FOCAR = '__JUST_FOCUS__';
const COMANDO_ANTIGRAVITY_RODANDO = comandoPowerShell("Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue");

function comandoPowerShell(script) {
    return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script.replace(/\n/g, ' ')}"`;
}

function saidaDoPowerShell(comando) {
    return new Promise((resolve) => {
        exec(comando, (err, stdout) => resolve(String(stdout || '').trim()));
    });
}

function esperar(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function caminhosDoAntigravity() {
    const userProfile = process.env.USERPROFILE || os.homedir();
    return [
        path.join(userProfile, 'AppData\\Local\\Programs\\Antigravity\\Antigravity.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs\\Antigravity\\Antigravity.exe'),
        'C:\\Program Files\\Antigravity\\Antigravity.exe'
    ];
}

function estatisticasDaSaida(output) {
    if (output === 'NOT_RUNNING' || !output.includes('PID:')) {
        return null;
    }
    const stats = camposDaSaida(output);
    return { pid: inteiroOuZero(stats.pid), cpu: inteiroOuZero(stats.cpu), memory: inteiroOuZero(stats.mem), responding: stats.resp === 'True', title: stats.title || '' };
}

function camposDaSaida(output) {
    const stats = {};
    output.split('|').forEach(p => {
        const idx = p.indexOf(':');
        if (idx !== -1) { stats[p.substring(0, idx).toLowerCase()] = p.substring(idx + 1); }
    });
    return stats;
}

function inteiroOuZero(valor) {
    return parseInt(valor || '0');
}

class AntigravityController {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;
        this.pendingPrompt = null;
        this.monitorInterval = null;
        this.scriptPath = null;
        this._initScript();
    }

    /** Write PS1 script to a temp file once at startup */
    _initScript() {
        try {
            const tmpDir = os.tmpdir();
            this.scriptPath = path.join(tmpDir, 'nova_ag_automate.ps1');
            fs.writeFileSync(this.scriptPath, PS_SCRIPT_CONTENT, 'utf8');
        } catch (e) {
            this.log(`Warning: Could not write PS1 script: ${e.message}`);
        }
    }

    log(text) {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        const ts = new Date().toLocaleTimeString([], { hour12: false });
        this.mainWindow.webContents.send('swarm:log', { 
            agent: 'antigravity-controller', 
            text: `[${ts}] [ANTIGRAVITY-CTRL] → ${text}` 
        });
    }

    /**
     * Core automation: set clipboard then run PowerShell STA script to focus + paste + enter
     * sendEnter=true also presses Enter to submit
     */
    async runPowerShellAutomation(promptText, sendEnter = true) {
        if (process.platform === "darwin") {
            return this._colarNoMac(promptText, sendEnter);
        }
        clipboard.writeText(promptText);
        this.log('Clipboard set. Launching PowerShell STA automation...');
        this._garantirScript();
        const { output, stderr } = await this._rodarAutomacao(sendEnter);
        return this._resultadoDaAutomacao(output, stderr);
    }

    async _colarNoMac(promptText, sendEnter) {
        try {
            const mac=require('./mac-native');
            if (!await this.launchAntigravity()) return {success:false,error:'Antigravity not installed.'};
            await esperar(700);
            await mac.pressKey('cmd+l');
            await mac.typeText(promptText,sendEnter);
            return {success:true,output:'Prompt sent through macOS Accessibility.'};
        } catch(e) {return {success:false,error:e.message};}
    }

    _garantirScript() {
        if (!this.scriptPath || !fs.existsSync(this.scriptPath)) {
            this._initScript();
        }
    }

    _rodarAutomacao(sendEnter) {
        const enterFlag = sendEnter ? '1' : '0';
        const cmd = `powershell -STA -NoProfile -ExecutionPolicy Bypass -File "${this.scriptPath}" -SendEnter ${enterFlag}`;
        return new Promise((resolve) => {
            exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
                resolve({ output: String(stdout || '').trim(), stderr });
            });
        });
    }

    _resultadoDaAutomacao(output, stderr) {
        this.log(`PS automation result: ${output}`);
        if (output.includes('SUCCESS')) {
            return { success: true, output };
        }
        if (output.includes('ERROR')) {
            this.log(`PS automation error: ${output}`);
            return { success: false, error: output };
        }
        this.log(`PS automation unexpected: ${output} | stderr: ${stderr}`);
        return { success: false, error: output || stderr };
    }

    /**
     * Checks if Antigravity is running, and if not, launches it.
     */
    async ensureAntigravityRunning() {
        if (process.platform === "darwin") {
            return await this.launchAntigravity();
        }
        this.log('Checking if Antigravity is running...');
        const isRunning = (await saidaDoPowerShell(COMANDO_ANTIGRAVITY_RODANDO)).length > 0;
        if (isRunning) {
            this.log('Antigravity is already running.');
            return true;
        }
        this.log('Antigravity is not running. Attempting to launch...');
        if (!await this.launchAntigravity()) {
            return false;
        }
        this.log('Antigravity launched. Waiting for window...');
        await this._esperarJanela();
        return true;
    }

    async _esperarJanela() {
        for (let i = 0; i < 16; i++) {
            await esperar(500);
            const stats = await this.getProcessStats();
            if (stats && stats.title) {
                this.log(`Antigravity window detected: "${stats.title}"`);
                return;
            }
        }
    }

    /**
     * Spawns the Antigravity application from its standard path.
     */
    async launchAntigravity() {
        if (process.platform === "darwin") {
            try { await require('./mac-native').run('/usr/bin/open',['-a','Antigravity']);return true; } catch(e) {this.log(e.message);return false;}
        }
        const exePath = caminhosDoAntigravity().find(p => fs.existsSync(p));
        if (!exePath) {
            this.log('Error: Antigravity.exe not found in standard paths.');
            return false;
        }
        this.log(`Spawning Antigravity: "${exePath}"`);
        return this._abrirExecutavel(exePath);
    }

    _abrirExecutavel(exePath) {
        try {
            const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
            child.unref();
            this.log('Spawn completed.');
            return true;
        } catch (e) {
            this.log(`Spawn error: ${e.message}`);
            return false;
        }
    }

    /**
     * Focuses the editor window using PowerShell STA automation
     */
    async focusEditor() {
        if (process.platform === "darwin") {
            return await this.launchAntigravity();
        }
        const running = await this.ensureAntigravityRunning();
        if (!running) {
            this.log('Warning: Could not guarantee Antigravity is running.');
        }
        // Use the PS automation script with no paste (just focus)
        // We pass a dummy space so Ctrl+L just focuses, then no Enter
        clipboard.writeText(' ');
        const result = await this.runPowerShellAutomation(' ', false);
        return result.success;
    }

    /**
     * Queries process stats from Antigravity
     */
    async getProcessStats() {
        if (process.platform === "darwin") {
            try {
                return await require('./paridade-utils').macAntigravityStats(require('./mac-native'));
            } catch {return null;}
        }
        const psCommand = `
                $ErrorActionPreference = 'SilentlyContinue';
                $procs = Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue;
                $proc = $null;
                if ($procs) {
                    $proc = $procs | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -ne "" } | Select-Object -First 1;
                    if (-not $proc) { $proc = $procs | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1; }
                    if (-not $proc) { $proc = $procs | Select-Object -First 1; }
                }
                if ($proc) {
                    $id = $proc.Id; $responding = $proc.Responding; $title = $proc.MainWindowTitle;
                    $mem = [Math]::Round($proc.WorkingSet64 / 1MB);
                    Write-Output "PID:$id|CPU:0|MEM:$mem|RESP:$responding|TITLE:$title";
                } else { Write-Output "NOT_RUNNING"; };
            `.trim();

        return estatisticasDaSaida(await saidaDoPowerShell(comandoPowerShell(psCommand)));
    }

    /**
     * Starts the periodic monitoring loop
     */
    startMonitoring() {
        if (this.monitorInterval) clearInterval(this.monitorInterval);
        this.log('Starting background monitoring loop...');
        let counter = 0;
        this.monitorInterval = setInterval(async () => {
            counter++;
            if (counter > 30) {
                this.log('Monitoring timed out.');
                this.stopMonitoring();
                return;
            }
            try {
                const stats = await this.getProcessStats();
                if (stats) {
                    this.log(`Monitor [PID:${stats.pid}] RAM:${stats.memory}MB Resp:${stats.responding} Title:"${String(stats.title).substring(0, 40)}"`);
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('antigravity:status-update', {
                            active: true, pid: stats.pid, cpu: stats.cpu,
                            memory: stats.memory, responding: stats.responding,
                            title: stats.title, screenshotPath: null, timestamp: Date.now()
                        });
                    }
                } else {
                    this.log('Antigravity not running or closed.');
                    this.stopMonitoring();
                }
            } catch (e) { this.log(`Monitor error: ${e.message}`); }
        }, 4000);
    }

    /**
     * Stops the monitoring loop
     */
    stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
            this.log('Monitoring stopped.');
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('antigravity:status-update', { active: false });
        }
    }

    /**
     * Restores Nova window to normal
     */
    restoreWindow() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        try {
            this.mainWindow.setAlwaysOnTop(false);
            this.mainWindow.focus();
        } catch (e) {}
    }

    /**
     * Prepares and executes the prompt in Antigravity
     * This is the MAIN entry point called by IPC handlers
     */
    async preparePrompt(promptText) {
        if (process.platform === "darwin") {
            return this._prepararNoMac(promptText);
        }
        this.pendingPrompt = promptText;
        this.log(`Preparing prompt: "${promptText.substring(0, 60)}"`);
        if (promptText === SO_FOCAR) {
            return this._soFocar();
        }
        return this._colarPedido(promptText);
    }

    async _prepararNoMac(promptText) {
        if (promptText===SO_FOCAR) return {success:await this.focusEditor()};
        const result=await this.runPowerShellAutomation(promptText,true);
        if(result.success)this.startMonitoring();
        return result;
    }

    async _soFocar() {
        this.log('Focus-only request.');
        const running = await this.ensureAntigravityRunning();
        if (!running) {
            this.pendingPrompt = null;
            return { success: false };
        }
        const psCmd = `
                $ErrorActionPreference = 'SilentlyContinue';
                Add-Type -AssemblyName System.Windows.Forms;
                $sig = '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);';
                $type = Add-Type -MemberDefinition $sig -Name 'Win32FocusOnly' -Namespace 'FH' -PassThru;
                $procs = Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue;
                $proc = $procs | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -ne "" } | Select-Object -First 1;
                if (-not $proc) { $proc = $procs | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1; }
                if ($proc) {
                    $hwnd = $proc.MainWindowHandle;
                    $type::ShowWindowAsync($hwnd, 9) | Out-Null;
                    Start-Sleep -Milliseconds 200;
                    $type::ShowWindowAsync($hwnd, 3) | Out-Null;
                    Start-Sleep -Milliseconds 200;
                    $type::keybd_event(0x12, 0, 0, 0); $type::keybd_event(0x12, 0, 2, 0);
                    $type::SetForegroundWindow($hwnd) | Out-Null;
                    Write-Output "SUCCESS";
                } else { Write-Output "NOT_FOUND"; }
            `.trim();
        const out = await saidaDoPowerShell(comandoPowerShell(psCmd));
        this.pendingPrompt = null;
        this.log(`Focus-only result: ${out}`);
        return { success: out.includes('SUCCESS') };
    }

    async _colarPedido(promptText) {
        const running = await this.ensureAntigravityRunning();
        if (!running) {
            this.log('Antigravity could not be started.');
            return { success: false, error: 'Could not start Antigravity' };
        }
        await esperar(500);
        this.log('Running PowerShell STA automation (focus + paste + Enter in one shot)...');
        const result = await this.runPowerShellAutomation(promptText, true);
        if (result.success) {
            this.log('Automation complete. Prompt pasted and Enter sent to Antigravity.');
            this.startMonitoring();
        } else {
            this.log(`Automation failed: ${result.error}`);
        }
        this.pendingPrompt = null;
        return { success: result.success };
    }

    /**
     * Presses Enter in Antigravity to execute the pasted prompt
     */
    async confirmAndExecute() {
        this.log('Confirm received - automation already completed (paste+Enter done in preparePrompt).');

        if (this.pendingPrompt === '__JUST_FOCUS__') {
            this.pendingPrompt = null;
            return true;
        }

        // Automation was already done in preparePrompt with sendEnter=true
        // Just ensure monitoring is running
        if (!this.monitorInterval) {
            this.startMonitoring();
        }
        this.pendingPrompt = null;
        return true;
    }

    /**
     * Minimizes the Antigravity editor window
     */
    async minimizeEditor() {
        if (process.platform === "darwin") {
            try {await require('./mac-native').apple('tell application "System Events" to tell process "Antigravity" to set value of attribute "AXMinimized" of front window to true');return true;}catch{return false;}
        }
        return new Promise((resolve) => {
            this.log('Minimizing Antigravity window...');
            const psCommand = `
                $ErrorActionPreference = 'SilentlyContinue';
                $sig = '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);';
                $type = Add-Type -MemberDefinition $sig -Name 'Win32MinA' -Namespace 'FHA' -PassThru;
                $procs = Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue;
                $proc = $procs | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -ne "" } | Select-Object -First 1;
                if (-not $proc) { $proc = $procs | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1; }
                if ($proc) { $type::ShowWindowAsync($proc.MainWindowHandle, 6) | Out-Null; Write-Output "SUCCESS"; } else { Write-Output "NOT_FOUND"; }
            `.trim();
            exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${psCommand.replace(/\n/g, ' ')}"`, () => resolve(true));
        });
    }

    /**
     * Maximize = focusEditor (bring to foreground + maximize)
     */
    async maximizeEditor() {
        this.log('Maximizing Antigravity (via focusEditor)...');
        return await this.focusEditor();
    }

    /**
     * Closes the Antigravity editor completely
     */
    async closeEditor() {
        if (process.platform === "darwin") {
            try {await require('./mac-native').apple('tell application "Antigravity" to quit');this.stopMonitoring();return true;}catch{return false;}
        }
        return new Promise((resolve) => {
            this.log('Closing Antigravity process...');
            exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Stop-Process -Name 'Antigravity' -Force -ErrorAction SilentlyContinue;"`, () => {
                this.stopMonitoring();
                resolve(true);
            });
        });
    }
}

module.exports = AntigravityController;
