const { exec, spawn } = require('child_process');
const path = require('path');
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
            const tmpDir = require('os').tmpdir();
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
            try {
                const mac=require('./mac-native');
                if (!await this.launchAntigravity()) return {success:false,error:'Antigravity not installed.'};
                await new Promise(r=>setTimeout(r,700));
                await mac.pressKey('cmd+l');
                await mac.typeText(promptText,sendEnter);
                return {success:true,output:'Prompt sent through macOS Accessibility.'};
            } catch(e) {return {success:false,error:e.message};}
        }
        // Step 1: Set clipboard from Electron (this always works)
        clipboard.writeText(promptText);
        this.log('Clipboard set. Launching PowerShell STA automation...');

        // Step 2: Ensure script exists
        if (!this.scriptPath || !fs.existsSync(this.scriptPath)) {
            this._initScript();
        }

        const enterFlag = sendEnter ? '1' : '0';
        const cmd = `powershell -STA -NoProfile -ExecutionPolicy Bypass -File "${this.scriptPath}" -SendEnter ${enterFlag}`;

        return new Promise((resolve) => {
            exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
                const output = String(stdout || '').trim();
                this.log(`PS automation result: ${output}`);
                if (output.includes('SUCCESS')) {
                    resolve({ success: true, output });
                } else if (output.includes('ERROR')) {
                    this.log(`PS automation error: ${output}`);
                    resolve({ success: false, error: output });
                } else {
                    this.log(`PS automation unexpected: ${output} | stderr: ${stderr}`);
                    resolve({ success: false, error: output || stderr });
                }
            });
        });
    }

    /**
     * Checks if Antigravity is running, and if not, launches it.
     */
    async ensureAntigravityRunning() {
        if (process.platform === "darwin") {
            return await this.launchAntigravity();
        }
        return new Promise((resolve) => {
            this.log('Checking if Antigravity is running...');
            exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue"`, async (err, stdout) => {
                const isRunning = String(stdout || '').trim().length > 0;
                if (isRunning) {
                    this.log('Antigravity is already running.');
                    resolve(true);
                } else {
                    this.log('Antigravity is not running. Attempting to launch...');
                    const launched = await this.launchAntigravity();
                    if (launched) {
                        this.log('Antigravity launched. Waiting for window...');
                        for (let i = 0; i < 16; i++) {
                            await new Promise(r => setTimeout(r, 500));
                            const stats = await this.getProcessStats();
                            if (stats && stats.title) {
                                this.log(`Antigravity window detected: "${stats.title}"`);
                                break;
                            }
                        }
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                }
            });
        });
    }

    /**
     * Spawns the Antigravity application from its standard path.
     */
    async launchAntigravity() {
        if (process.platform === "darwin") {
            try { await require('./mac-native').run('/usr/bin/open',['-a','Antigravity']);return true; } catch(e) {this.log(e.message);return false;}
        }
        return new Promise((resolve) => {
            const userProfile = process.env.USERPROFILE || os.homedir();
            const possiblePaths = [
                path.join(userProfile, 'AppData\\Local\\Programs\\Antigravity\\Antigravity.exe'),
                path.join(process.env.LOCALAPPDATA || '', 'Programs\\Antigravity\\Antigravity.exe'),
                'C:\\Program Files\\Antigravity\\Antigravity.exe'
            ];
            
            let exePath = null;
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) { exePath = p; break; }
            }
            
            if (!exePath) {
                this.log('Error: Antigravity.exe not found in standard paths.');
                resolve(false);
                return;
            }
            
            this.log(`Spawning Antigravity: "${exePath}"`);
            try {
                const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
                child.unref();
                this.log('Spawn completed.');
                resolve(true);
            } catch (e) {
                this.log(`Spawn error: ${e.message}`);
                resolve(false);
            }
        });
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
        return new Promise((resolve) => {
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

            exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${psCommand.replace(/\n/g, ' ')}"`, (err, stdout) => {
                const output = String(stdout || '').trim();
                if (output === 'NOT_RUNNING' || !output.includes('PID:')) { resolve(null); return; }
                try {
                    const parts = output.split('|');
                    const stats = {};
                    parts.forEach(p => {
                        const idx = p.indexOf(':');
                        if (idx !== -1) { stats[p.substring(0, idx).toLowerCase()] = p.substring(idx + 1); }
                    });
                    resolve({ pid: parseInt(stats.pid || '0'), cpu: parseInt(stats.cpu || '0'), memory: parseInt(stats.mem || '0'), responding: stats.resp === 'True', title: stats.title || '' });
                } catch (e) { resolve(null); }
            });
        });
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
            if (promptText==='__JUST_FOCUS__') return {success:await this.focusEditor()};
            const result=await this.runPowerShellAutomation(promptText,true);
            if(result.success)this.startMonitoring();
            return result;
        }
        this.pendingPrompt = promptText;
        this.log(`Preparing prompt: "${promptText.substring(0, 60)}"`);

        // Just focus/open, no paste
        if (promptText === '__JUST_FOCUS__') {
            this.log('Focus-only request.');
            const running = await this.ensureAntigravityRunning();
            if (!running) { this.pendingPrompt = null; return { success: false }; }

            // PowerShell to just focus
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

            return new Promise((resolve) => {
                exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${psCmd.replace(/\n/g, ' ')}"`, (err, stdout) => {
                    const out = String(stdout || '').trim();
                    this.pendingPrompt = null;
                    this.log(`Focus-only result: ${out}`);
                    resolve({ success: out.includes('SUCCESS') });
                });
            });
        }

        // Ensure running
        const running = await this.ensureAntigravityRunning();
        if (!running) {
            this.log('Antigravity could not be started.');
            return { success: false, error: 'Could not start Antigravity' };
        }
        await new Promise(r => setTimeout(r, 500));

        // Run full automation: focus + Ctrl+L + Ctrl+V + Enter (all in ONE PowerShell STA session)
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
