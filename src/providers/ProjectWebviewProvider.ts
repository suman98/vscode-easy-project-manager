import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { Project } from '../models/Project';
import { ProjectService } from '../services/ProjectService';
import { ConfigService } from '../services/ConfigService';
import { pickOrganization } from '../commands/addProject';
import { resolvePath } from '../utils/FileUtils';

type WebviewMessage =
    | { type: 'openProject'; path: string }
    | { type: 'openNew'; path: string }
    | { type: 'rename'; path: string }
    | { type: 'moveToOrg'; path: string }
    | { type: 'setOrg'; path: string; org: string }
    | { type: 'remove'; path: string }
    | { type: 'reveal'; path: string }
    | { type: 'copyPath'; path: string }
    | { type: 'reorder'; paths: string[] }
    | { type: 'openTerminal'; path: string }
    | { type: 'openExternalTerminal'; path: string }
    | { type: 'openSecondaryEditor'; path: string }
    | { type: 'saveSettings'; path: string; color: string; label: string; secondaryEditor: string }
    | { type: 'renameOrg'; org: string }
    | { type: 'deleteOrg'; org: string }
    | { type: 'reorderOrgs'; orgs: string[] };

async function pathExists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
}

interface TerminalDef {
    name: string;
    id: string;
}

const MAC_TERMINALS: Array<{ name: string; id: string; appPath: string; openArg?: string[] }> = [
    { name: 'Terminal',   id: 'Terminal',   appPath: '/System/Applications/Utilities/Terminal.app' },
    { name: 'iTerm2',     id: 'iTerm',      appPath: '/Applications/iTerm.app' },
    { name: 'Warp',       id: 'Warp',       appPath: '/Applications/Warp.app' },
    { name: 'Ghostty',    id: 'Ghostty',    appPath: '/Applications/Ghostty.app' },
    { name: 'Alacritty',  id: 'Alacritty',  appPath: '/Applications/Alacritty.app' },
    { name: 'WezTerm',    id: 'WezTerm',    appPath: '/Applications/WezTerm.app' },
    { name: 'Hyper',      id: 'Hyper',      appPath: '/Applications/Hyper.app' },
    { name: 'kitty',      id: 'kitty',      appPath: '/Applications/kitty.app' },
];

const WIN_TERMINALS: Array<{ name: string; id: string; cmd: string }> = [
    { name: 'Windows Terminal', id: 'wt',          cmd: 'wt' },
    { name: 'PowerShell',       id: 'powershell',  cmd: 'powershell' },
    { name: 'Command Prompt',   id: 'cmd',         cmd: 'cmd' },
    { name: 'Git Bash',         id: 'bash',        cmd: 'bash' },
];

const LINUX_TERMINALS: Array<{ name: string; id: string; cwdFlag: string[] }> = [
    { name: 'GNOME Terminal', id: 'gnome-terminal',   cwdFlag: ['--working-directory'] },
    { name: 'Konsole',        id: 'konsole',           cwdFlag: ['--workdir'] },
    { name: 'Tilix',          id: 'tilix',             cwdFlag: ['--working-directory'] },
    { name: 'xfce4-terminal', id: 'xfce4-terminal',   cwdFlag: ['--working-directory'] },
    { name: 'xterm',          id: 'xterm',             cwdFlag: [] },
];

export class ProjectWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'projectManagerView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly projectService: ProjectService,
        private readonly configService: ConfigService,
        private readonly context: vscode.ExtensionContext
    ) {}

    private async getAvailableTerminals(): Promise<TerminalDef[]> {
        if (process.platform === 'darwin') {
            const results: TerminalDef[] = [];
            for (const t of MAC_TERMINALS) {
                if (await pathExists(t.appPath)) { results.push({ name: t.name, id: t.id }); }
            }
            return results;
        }
        if (process.platform === 'win32') {
            const always = WIN_TERMINALS.filter(t => t.id === 'cmd' || t.id === 'powershell');
            const optional = WIN_TERMINALS.filter(t => t.id !== 'cmd' && t.id !== 'powershell');
            const detected: TerminalDef[] = [...always.map(t => ({ name: t.name, id: t.id }))];
            for (const t of optional) {
                try {
                    await new Promise<void>((res, rej) => {
                        const p = spawn('where', [t.cmd], { stdio: 'pipe', shell: true });
                        p.on('close', c => c === 0 ? res() : rej());
                    });
                    detected.push({ name: t.name, id: t.id });
                } catch { /* not found */ }
            }
            return detected;
        }
        // Linux
        const results: TerminalDef[] = [];
        for (const t of LINUX_TERMINALS) {
            try {
                await new Promise<void>((res, rej) => {
                    const p = spawn('which', [t.id], { stdio: 'pipe' });
                    p.on('close', c => c === 0 ? res() : rej());
                });
                results.push({ name: t.name, id: t.id });
            } catch { /* not found */ }
        }
        return results;
    }

    private launchTerminal(id: string, cwd: string): void {
        if (process.platform === 'darwin') {
            spawn('open', ['-a', id, cwd], { detached: true, stdio: 'ignore' }).unref();
            return;
        }
        if (process.platform === 'win32') {
            if (id === 'wt') {
                spawn('wt', ['-d', cwd], { detached: true, stdio: 'ignore', shell: true }).unref();
            } else if (id === 'powershell') {
                spawn('powershell', ['-NoExit', '-Command', `Set-Location "${cwd}"`], { detached: true, stdio: 'ignore', shell: true }).unref();
            } else if (id === 'bash') {
                spawn('bash', ['--login', '-i'], { cwd, detached: true, stdio: 'ignore', shell: true }).unref();
            } else {
                spawn('cmd.exe', ['/k', `cd /d "${cwd}"`], { detached: true, stdio: 'ignore', shell: true }).unref();
            }
            return;
        }
        // Linux
        const def = LINUX_TERMINALS.find(t => t.id === id);
        const args = def?.cwdFlag.length ? [...def.cwdFlag, cwd] : [];
        spawn(id, args, { cwd: def?.cwdFlag.length ? undefined : cwd, detached: true, stdio: 'ignore' }).unref();
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.buildHtml(webviewView.webview);
        webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.handleMessage(msg));
        this.sendProjects();
    }

    refresh(): void {
        this.projectService.invalidateCache();
        this.sendProjects();
    }

    async sendProjects(): Promise<void> {
        if (!this._view) { return; }
        const [projects, allOrganizations] = await Promise.all([
            this.projectService.getProjects(),
            this.projectService.getAllOrganizations()
        ]);
        const activeRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const alreadyAdded = activeRootPath ? projects.some(p => p.rootPath === activeRootPath) : false;
        await vscode.commands.executeCommand('setContext', 'projectManager.currentWorkspaceAdded', alreadyAdded);
        this._view.webview.postMessage({ type: 'update', projects, allOrganizations, activeRootPath });
    }

    /**
     * Input box where the user can paste/type a path, or use the folder button
     * to browse the file explorer. Resolves to the entered path, or undefined if cancelled.
     */
    private promptWorkspacePath(): Promise<string | undefined> {
        return new Promise(resolve => {
            const ib = vscode.window.createInputBox();
            ib.title = 'Open Workspace Path';
            ib.placeholder = '/path/to/workspace';
            ib.prompt = 'Paste a path, or use the folder icon to browse';
            ib.ignoreFocusOut = true;
            ib.buttons = [{ iconPath: new vscode.ThemeIcon('folder-opened'), tooltip: 'Browse…' }];

            let done = false;
            const finish = (val: string | undefined) => {
                if (done) { return; }
                done = true;
                ib.hide();
                resolve(val);
            };

            ib.onDidTriggerButton(async () => {
                const lastBrowsed = this.context.globalState.get<string>('projectManager.lastBrowsedWorkspace');
                const picked = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    openLabel: 'Select Workspace',
                    defaultUri: lastBrowsed ? vscode.Uri.file(path.dirname(lastBrowsed)) : undefined
                });
                if (picked?.[0]) {
                    // Selecting in the dialog opens immediately.
                    const fsPath = picked[0].fsPath;
                    void this.context.globalState.update('projectManager.lastBrowsedWorkspace', fsPath);
                    finish(fsPath);
                }
            });
            ib.onDidAccept(() => {
                const v = ib.value.trim();
                if (!v) { return; } // keep open until a path is entered or cancelled
                finish(v);
            });
            ib.onDidHide(() => finish(undefined));
            ib.show();
        });
    }

    /** Prompt for a workspace path (paste or browse) and open it if it exists. */
    async openWorkspacePath(): Promise<void> {
        const input = await this.promptWorkspacePath();
        if (!input) { return; }
        const folderPath = resolvePath(input.trim());

        if (!(await pathExists(folderPath))) {
            vscode.window.showErrorMessage(`Path not found: ${folderPath}`);
            return;
        }
        await vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(folderPath),
            this.configService.isOpenInNewWindow()
        );
    }

    private async handleMessage(msg: WebviewMessage): Promise<void> {
        const findProject = async (p: string) => {
            const list = await this.projectService.getProjects();
            return list.find(x => x.rootPath === p);
        };

        switch (msg.type) {
            case 'openProject':
            case 'openNew': {
                const project = await findProject(msg.path);
                if (!project) { return; }
                if (!(await pathExists(project.rootPath))) {
                    vscode.window.showErrorMessage(`Path not found: ${project.rootPath}`);
                    return;
                }
                const newWindow = msg.type === 'openNew' || this.configService.isOpenInNewWindow();
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(project.rootPath), newWindow);
                break;
            }
            case 'rename': {
                const project = await findProject(msg.path);
                if (!project) { return; }
                const newName = await vscode.window.showInputBox({
                    prompt: 'New project name',
                    value: project.name,
                    validateInput: v => v.trim() ? null : 'Name cannot be empty',
                    ignoreFocusOut: true
                });
                if (!newName || newName.trim() === project.name) { return; }
                await this.projectService.renameProject(msg.path, newName.trim());
                this.refresh();
                break;
            }
            case 'moveToOrg': {
                const project = await findProject(msg.path);
                if (!project) { return; }
                const org = await pickOrganization(this.projectService, project.organization);
                if (org === undefined) { return; }
                await this.projectService.updateOrganization(msg.path, org);
                this.refresh();
                break;
            }
            case 'setOrg':
                await this.projectService.updateOrganization(msg.path, msg.org);
                this.refresh();
                break;
            case 'remove': {
                const project = await findProject(msg.path);
                if (!project) { return; }
                const confirm = await vscode.window.showWarningMessage(
                    `Remove "${project.name}" from Project Manager?`,
                    { modal: true }, 'Remove'
                );
                if (confirm !== 'Remove') { return; }
                await this.projectService.removeProject(msg.path);
                this.refresh();
                break;
            }
            case 'reveal':
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
                break;
            case 'copyPath':
                await vscode.env.clipboard.writeText(msg.path);
                vscode.window.showInformationMessage(`Copied: ${msg.path}`);
                break;
            case 'reorder':
                await this.projectService.reorderProjects(msg.paths);
                break;
            case 'reorderOrgs':
                await this.projectService.reorderOrganizations(msg.orgs);
                break;
            case 'openTerminal': {
                const project = await findProject(msg.path);
                if (!project) { return; }
                const terminal = vscode.window.createTerminal({
                    name: project.name,
                    cwd: project.rootPath
                });
                terminal.show();
                break;
            }
            case 'openExternalTerminal': {
                const project = await findProject(msg.path);
                if (!project) { return; }
                if (!(await pathExists(project.rootPath))) {
                    vscode.window.showErrorMessage(`Path not found: ${project.rootPath}`);
                    return;
                }
                const available = await this.getAvailableTerminals();
                if (available.length === 0) {
                    vscode.window.showErrorMessage('No supported terminals found.');
                    return;
                }
                const lastId = this.context.globalState.get<string>('projectManager.preferredTerminal');
                const lastAvailable = lastId && available.find(t => t.id === lastId);

                let chosenId: string;
                if (lastAvailable) {
                    chosenId = lastAvailable.id;
                } else if (available.length === 1) {
                    chosenId = available[0].id;
                } else {
                    const picked = await vscode.window.showQuickPick(
                        available.map(t => ({ label: t.name, id: t.id })),
                        { placeHolder: 'Pick a terminal', title: 'Open in Terminal' }
                    );
                    if (!picked) { return; }
                    chosenId = picked.id;
                }
                await this.context.globalState.update('projectManager.preferredTerminal', chosenId);
                try {
                    this.launchTerminal(chosenId, project.rootPath);
                } catch {
                    vscode.window.showErrorMessage(`Failed to open ${chosenId}.`);
                }
                break;
            }
            case 'openSecondaryEditor': {
                const project = await findProject(msg.path);
                if (!project?.secondaryEditor) { return; }
                if (!(await pathExists(project.rootPath))) {
                    vscode.window.showErrorMessage(`Path not found: ${project.rootPath}`);
                    return;
                }
                try {
                    // Use the user's login shell with -i so .zshrc/.bashrc is sourced,
                    // making shell functions (e.g. `vscode`) available.
                    const escapedPath = project.rootPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    const cmd = `${project.secondaryEditor} "${escapedPath}"`;
                    if (process.platform === 'win32') {
                        spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore' }).unref();
                    } else {
                        const shell = process.env.SHELL || '/bin/zsh';
                        spawn(shell, ['-i', '-c', cmd], { detached: true, stdio: 'ignore' }).unref();
                    }
                } catch {
                    vscode.window.showErrorMessage(`Failed to launch "${project.secondaryEditor}". Check Settings.`);
                }
                break;
            }
            case 'saveSettings':
                await this.projectService.updateProjectSettings(msg.path, {
                    color: msg.color,
                    label: msg.label,
                    secondaryEditor: msg.secondaryEditor
                });
                this.refresh();
                break;
            case 'renameOrg': {
                const newName = await vscode.window.showInputBox({
                    prompt: 'Rename organization',
                    value: msg.org,
                    validateInput: v => v.trim() ? null : 'Name cannot be empty',
                    ignoreFocusOut: true
                });
                if (!newName || newName.trim() === msg.org) { return; }
                await this.projectService.renameOrganization(msg.org, newName.trim());
                this.refresh();
                break;
            }
            case 'deleteOrg': {
                const confirm = await vscode.window.showWarningMessage(
                    `Delete organization "${msg.org}"? Projects inside will be moved to No Organization.`,
                    { modal: true }, 'Delete'
                );
                if (confirm !== 'Delete') { return; }
                await this.projectService.deleteOrganization(msg.org);
                this.refresh();
                break;
            }
        }
    }

    private buildHtml(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:transparent;overflow-x:hidden}

/* ── search ── */
.search-wrap{position:sticky;top:0;z-index:10;padding:6px 8px;background:var(--vscode-sideBar-background,var(--vscode-editor-background));border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,transparent)}
.search-row{position:relative;display:flex;align-items:center}
.search-icon{position:absolute;left:8px;opacity:.5;font-size:13px;pointer-events:none}
.search-input{width:100%;padding:4px 24px 4px 28px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:2px;outline:none;font-size:inherit;font-family:inherit}
.search-input:focus{border-color:var(--vscode-focusBorder)}
.search-input::placeholder{color:var(--vscode-input-placeholderForeground)}
.clear-btn{position:absolute;right:6px;background:none;border:none;cursor:pointer;color:var(--vscode-input-foreground);opacity:.5;font-size:14px;line-height:1;padding:0 2px;display:none}
.clear-btn:hover{opacity:1}

/* ── groups ── */
.group{margin-top:2px}
.group.org-dragging{opacity:.4;pointer-events:none}
.group.org-drop-before{border-top:2px solid var(--vscode-focusBorder)}
.group.org-drop-after{border-bottom:2px solid var(--vscode-focusBorder)}
.org-drag-handle{pointer-events:auto!important;cursor:grab;margin-right:4px;opacity:0;font-size:11px;user-select:none}
.group-header:hover .org-drag-handle{opacity:.5}
.org-drag-handle:hover{opacity:1!important}
.group-header{display:flex;align-items:center;padding:4px 8px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-foreground));cursor:pointer;user-select:none;opacity:.7;border-radius:2px;transition:background .1s,opacity .1s}
.group-header:hover{opacity:1}
.group-header.org-drop-target{background:var(--vscode-list-dropBackground,rgba(0,120,215,.15));outline:1px dashed var(--vscode-focusBorder);opacity:1}
.chevron{margin-right:4px;font-size:9px;display:inline-block;transition:transform .1s;flex-shrink:0}
.group-header.collapsed .chevron{transform:rotate(-90deg)}
.group-body.collapsed{display:none}
.group-count{opacity:.4;font-weight:400;margin-left:4px;font-size:10px}
.group-header>*{pointer-events:none}
.org-action-btn{pointer-events:auto!important;background:none;border:none;color:inherit;cursor:pointer;padding:0 4px;font-size:12px;opacity:0;transition:opacity .1s;line-height:1}
.org-action-btn:first-of-type{margin-left:auto}
.group-header:hover .org-action-btn{opacity:.6}
.org-action-btn:hover{opacity:1!important}
.delete-org-btn:hover{color:var(--vscode-errorForeground)!important;opacity:1!important}

/* ── project items ── */
.project-item{display:flex;align-items:center;padding:3px 6px 3px 12px;cursor:pointer;position:relative;min-height:30px;border:1px solid transparent}
.project-item:hover{background:var(--vscode-list-hoverBackground)}
.drag-handle{opacity:0;cursor:grab;padding-right:6px;flex-shrink:0;font-size:13px;color:var(--vscode-foreground);line-height:1}
.project-item:hover .drag-handle{opacity:.35}
.drag-handle:hover{opacity:.8!important}
.drag-handle:active{cursor:grabbing}
.folder-icon{margin-right:5px;flex-shrink:0;display:flex;align-items:center;line-height:1}
.info{flex:1;min-width:0;overflow:hidden}
.proj-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px}
.proj-name-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.proj-label{display:inline-block;font-size:10px;font-weight:400;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);padding:1px 5px;border-radius:8px;flex-shrink:0;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.proj-sub{font-size:11px;opacity:.5;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;empty-cells:hide}
.proj-sub:empty{display:none}
.hl{background:var(--vscode-editor-findMatchHighlightBackground,rgba(255,200,0,.3));border-radius:2px}

/* ── action buttons ── */
.proj-actions{display:flex;gap:1px;margin-left:4px;align-items:center;flex-shrink:0;opacity:0;transition:opacity .1s}
.project-item:hover .proj-actions{opacity:1}
.act-btn{background:none;border:none;cursor:pointer;color:var(--vscode-foreground);opacity:.55;padding:3px 5px;border-radius:3px;line-height:1;font-size:12px;font-family:monospace}
.act-btn:hover{opacity:1;background:var(--vscode-toolbar-hoverBackground,rgba(127,127,127,.15))}

/* ── drag ── */
.project-item.active-project{background:var(--vscode-list-inactiveSelectionBackground,rgba(255,255,255,.06))}
.project-item.active-project .proj-name-text{font-weight:600}
.project-item.dragging{opacity:.3}
.project-item.drop-before{border-top:2px solid var(--vscode-focusBorder)!important}
.project-item.drop-after{border-bottom:2px solid var(--vscode-focusBorder)!important}
.empty{padding:24px 16px;opacity:.55;font-size:12px;text-align:center;line-height:1.6}

/* ── context menu ── */
.ctx{position:fixed;background:var(--vscode-menu-background,var(--vscode-editorWidget-background));border:1px solid var(--vscode-menu-border,var(--vscode-widget-border));box-shadow:0 4px 14px rgba(0,0,0,.35);border-radius:4px;padding:4px 0;z-index:1000;min-width:180px;display:none}
.ctx.open{display:block}
.ctx-item{padding:5px 14px;cursor:pointer;font-size:var(--vscode-font-size);color:var(--vscode-menu-foreground,var(--vscode-foreground));white-space:nowrap}
.ctx-item:hover{background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground));color:var(--vscode-menu-selectionForeground,var(--vscode-foreground))}
.ctx-sep{height:1px;background:var(--vscode-menu-separatorBackground,var(--vscode-widget-border));margin:3px 0}

/* ── settings panel ── */
.settings-panel{position:fixed;bottom:0;left:0;right:0;background:var(--vscode-sideBar-background,var(--vscode-editor-background));border-top:2px solid var(--vscode-focusBorder);padding:12px;z-index:500;display:none;box-shadow:0 -6px 20px rgba(0,0,0,.25)}
.settings-panel.open{display:block}
.sp-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.sp-title{font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:8px}
.sp-close{background:none;border:none;cursor:pointer;color:var(--vscode-foreground);opacity:.6;font-size:15px;padding:0;line-height:1;flex-shrink:0}
.sp-close:hover{opacity:1}
.sp-field{margin-bottom:10px}
.sp-field-label{font-size:11px;opacity:.65;margin-bottom:4px}
.sp-input{width:100%;padding:4px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:2px;outline:none;font-family:inherit;font-size:inherit}
.sp-input:focus{border-color:var(--vscode-focusBorder)}
.sp-input::placeholder{color:var(--vscode-input-placeholderForeground)}
.sp-hint{font-size:10px;opacity:.45;margin-top:3px}
.color-swatches{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
.swatch{width:20px;height:20px;border-radius:50%;cursor:pointer;border:2px solid transparent;flex-shrink:0;position:relative;transition:transform .1s}
.swatch:hover{transform:scale(1.15)}
.swatch.selected{border-color:var(--vscode-focusBorder);transform:scale(1.15)}
.swatch-none{background:transparent;border:1.5px dashed var(--vscode-input-border,#666)}
.swatch-none::after{content:'×';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:11px;opacity:.5;line-height:1}
.sp-color-custom-row{display:flex;align-items:center;gap:8px;margin-top:8px}
#sp-color-picker{width:28px;height:22px;padding:1px;border:1px solid var(--vscode-input-border,transparent);border-radius:3px;background:var(--vscode-input-background);cursor:pointer;flex-shrink:0}
.sp-color-picker-val{font-size:11px;opacity:.55;font-family:monospace;letter-spacing:.02em}
.sp-footer{display:flex;gap:6px;margin-top:10px}
.btn-primary{flex:1;padding:5px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:2px;cursor:pointer;font-family:inherit;font-size:inherit}
.btn-primary:hover{background:var(--vscode-button-hoverBackground)}
.btn-secondary{padding:5px 12px;background:var(--vscode-button-secondaryBackground,var(--vscode-input-background));color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));border:none;border-radius:2px;cursor:pointer;font-family:inherit;font-size:inherit}
.btn-secondary:hover{opacity:.85}
.loading-overlay{position:fixed;inset:0;background:var(--vscode-sideBar-background,var(--vscode-editor-background));display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;opacity:0;pointer-events:none;transition:opacity .15s}
.loading-overlay.visible{opacity:1;pointer-events:all}
.loading-spinner{width:18px;height:18px;border:2px solid var(--vscode-foreground);border-top-color:transparent;border-radius:50%;animation:spin .65s linear infinite;opacity:.7}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-label{margin-top:10px;font-size:11px;opacity:.5}
</style>
</head>
<body>

<div class="search-wrap">
  <div class="search-row">
    <span class="search-icon">⌕</span>
    <input class="search-input" id="search" placeholder="Search projects…" autocomplete="off" spellcheck="false"/>
    <button class="clear-btn" id="clear-btn" title="Clear">✕</button>
  </div>
</div>

<div id="list"></div>

<!-- loading overlay -->
<div class="loading-overlay" id="loading-overlay">
  <div class="loading-spinner"></div>
  <div class="loading-label">Opening project…</div>
</div>

<!-- context menu -->
<div class="ctx" id="ctx">
  <div class="ctx-item" data-action="openProject">Open</div>
  <div class="ctx-item" data-action="openNew">Open in New Window</div>
  <div class="ctx-item" data-action="openExternalTerminal">Open in Terminal</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" data-action="reveal">Reveal in Finder / Explorer</div>
  <div class="ctx-item" data-action="copyPath">Copy Path</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" data-action="moveToOrg">Move to Organization…</div>
  <div class="ctx-item" data-action="rename">Rename</div>
  <div class="ctx-item" data-action="openProjectSettings">Settings…</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" data-action="remove">Remove</div>
</div>

<!-- settings panel -->
<div class="settings-panel" id="settings-panel">
  <div class="sp-header">
    <div class="sp-title" id="sp-title">Project Settings</div>
    <button class="sp-close" id="sp-close">✕</button>
  </div>

  <div class="sp-field">
    <div class="sp-field-label">Color</div>
    <div class="color-swatches" id="color-swatches"></div>
    <div class="sp-color-custom-row">
      <span class="sp-field-label">Custom</span>
      <input type="color" id="sp-color-picker" value="#000000"/>
      <span class="sp-color-picker-val" id="sp-color-picker-val"></span>
    </div>
  </div>

  <div class="sp-field">
    <div class="sp-field-label">Label</div>
    <input class="sp-input" id="sp-label" placeholder="Optional short label…" autocomplete="off"/>
  </div>

  <div class="sp-field">
    <div class="sp-field-label">Secondary Editor</div>
    <input class="sp-input" id="sp-editor" placeholder="e.g. cursor, code-insiders, subl" autocomplete="off"/>
    <div class="sp-hint">Command used to open this project in a second editor. An icon will appear in the project row.</div>
  </div>

  <div class="sp-footer">
    <button class="btn-primary" id="sp-save">Save</button>
    <button class="btn-secondary" id="sp-cancel">Cancel</button>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

const PRESET_COLORS = [
    '',        // none
    '#ef4444', // red
    '#f97316', // orange
    '#eab308', // yellow
    '#22c55e', // green
    '#14b8a6', // teal
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#94a3b8'  // slate
];

let allProjects      = [];
let allOrganizations = [];
let activeRootPath   = '';
let dragSrcPath      = null;
let dragSrcOrg       = null;
let ctxProject       = null;
let spProject        = null;
let spColor          = '';

const listEl      = document.getElementById('list');
const searchEl    = document.getElementById('search');
const clearBtn    = document.getElementById('clear-btn');
const ctxEl       = document.getElementById('ctx');
const settingsEl  = document.getElementById('settings-panel');
const spTitleEl   = document.getElementById('sp-title');
const spLabelEl   = document.getElementById('sp-label');
const spEditorEl  = document.getElementById('sp-editor');
const swatchesEl     = document.getElementById('color-swatches');
const colorPickerEl  = document.getElementById('sp-color-picker');
const colorPickerVal = document.getElementById('sp-color-picker-val');

function selectSwatch(color) {
    swatchesEl.querySelectorAll('.swatch').forEach(x => x.classList.remove('selected'));
    const match = swatchesEl.querySelector('[data-color="' + color + '"]');
    if (match) { match.classList.add('selected'); }
}

function setPickerColor(color) {
    colorPickerEl.value = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#000000';
    colorPickerVal.textContent = color || '';
}

// ── build color swatches (once) ───────────────────────────────────────────────
PRESET_COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className = 'swatch' + (c === '' ? ' swatch-none' : '');
    if (c) { s.style.background = c; }
    s.dataset.color = c;
    s.addEventListener('click', () => {
        spColor = c;
        selectSwatch(c);
        setPickerColor(c);
    });
    swatchesEl.appendChild(s);
});

colorPickerEl.addEventListener('input', () => {
    spColor = colorPickerEl.value;
    colorPickerVal.textContent = spColor;
    selectSwatch(spColor); // deselects presets if no match
});

// ── messages ──────────────────────────────────────────────────────────────────
const loadingEl = document.getElementById('loading-overlay');
let loadingTimer = null;

function showLoading() {
    loadingEl.classList.add('visible');
    if (loadingTimer) { clearTimeout(loadingTimer); }
    loadingTimer = setTimeout(hideLoading, 5000);
}
function hideLoading() {
    loadingEl.classList.remove('visible');
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
}

window.addEventListener('message', ({ data }) => {
    if (data.type === 'update') {
        hideLoading();
        allProjects      = data.projects;
        allOrganizations = data.allOrganizations || [];
        activeRootPath   = data.activeRootPath   || '';
        render(searchEl.value);
    }
});

// ── search ────────────────────────────────────────────────────────────────────
function doSearch() {
    clearBtn.style.display = searchEl.value ? 'block' : 'none';
    render(searchEl.value);
}
searchEl.addEventListener('keyup',  doSearch);
searchEl.addEventListener('input',  doSearch);
clearBtn.addEventListener('click', () => {
    searchEl.value = '';
    clearBtn.style.display = 'none';
    render('');
    searchEl.focus();
});

// ── render ────────────────────────────────────────────────────────────────────
function render(query) {
    const q = query.trim().toLowerCase();
    listEl.innerHTML = '';

    const filtered = q
        ? allProjects.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.rootPath.toLowerCase().includes(q) ||
            (p.organization || '').toLowerCase().includes(q) ||
            (p.label || '').toLowerCase().includes(q))
        : allProjects;

    if (filtered.length === 0) {
        listEl.innerHTML = q
            ? '<div class="empty">No matches for <strong>' + escHtml(query) + '</strong></div>'
            : '<div class="empty">No projects yet.<br>Click <strong>+</strong> in the toolbar to add one.</div>';
        return;
    }

    if (q) {
        const frag = document.createDocumentFragment();
        for (const p of filtered) { frag.appendChild(makeItem(p, false, q)); }
        listEl.appendChild(frag);
    } else {
        renderGrouped(filtered);
    }
}

function renderGrouped(projects) {
    const orgMap = new Map();
    const noOrg  = [];
    for (const p of projects) {
        if (!p.enabled) { continue; }
        if (!p.organization) { noOrg.push(p); }
        else {
            if (!orgMap.has(p.organization)) { orgMap.set(p.organization, []); }
            orgMap.get(p.organization).push(p);
        }
    }
    const frag = document.createDocumentFragment();
    for (const org of orgMap.keys()) { frag.appendChild(makeGroup(org, orgMap.get(org), false)); }
    if (noOrg.length > 0) { frag.appendChild(makeGroup('No Organization', noOrg, true)); }
    listEl.appendChild(frag);
}

function clearOrgDropIndicators() {
    document.querySelectorAll('.org-drop-before,.org-drop-after').forEach(x =>
        x.classList.remove('org-drop-before', 'org-drop-after'));
}

function makeGroup(label, projects, isUncategorized) {
    const group  = document.createElement('div');
    group.className = 'group';
    group.dataset.org = isUncategorized ? '' : label;

    const header = document.createElement('div');
    header.className = 'group-header';

    if (!isUncategorized) {
        const orgHandle = document.createElement('span');
        orgHandle.className = 'org-drag-handle';
        orgHandle.textContent = '⠿';
        orgHandle.title = 'Drag to reorder organizations';
        orgHandle.addEventListener('mousedown', () => group.setAttribute('draggable', 'true'));
        orgHandle.addEventListener('mouseup',   () => group.setAttribute('draggable', 'false'));
        header.appendChild(orgHandle);
    }

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '▾';
    header.appendChild(chevron);

    header.appendChild(document.createTextNode(label));

    const countEl = document.createElement('span');
    countEl.className = 'group-count';
    countEl.textContent = String(projects.length);
    header.appendChild(countEl);

    if (!isUncategorized) {
        const renameBtn = document.createElement('button');
        renameBtn.className = 'org-action-btn';
        renameBtn.title = 'Rename organization';
        renameBtn.textContent = '✎';
        renameBtn.addEventListener('click', e => {
            e.stopPropagation();
            vscode.postMessage({ type: 'renameOrg', org: label });
        });
        header.appendChild(renameBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'org-action-btn delete-org-btn';
        deleteBtn.title = 'Delete organization';
        deleteBtn.textContent = '✕';
        deleteBtn.addEventListener('click', e => {
            e.stopPropagation();
            vscode.postMessage({ type: 'deleteOrg', org: label });
        });
        header.appendChild(deleteBtn);
    }

    const body = document.createElement('div');
    body.className = 'group-body';

    header.addEventListener('click', () => {
        header.classList.toggle('collapsed');
        body.classList.toggle('collapsed');
    });

    // ── org-level drag (reorder organizations) ───────────────────────────────
    if (!isUncategorized) {
        group.addEventListener('dragstart', e => {
            if (e.target !== group) { return; } // bubbled from a project item — ignore
            if (!group.getAttribute('draggable')) { e.preventDefault(); return; }
            dragSrcOrg  = label;
            dragSrcPath = null;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', label);
            group.classList.add('org-dragging');
        });
        group.addEventListener('dragend', () => {
            group.removeAttribute('draggable');
            group.classList.remove('org-dragging');
            clearOrgDropIndicators();
            dragSrcOrg = null;
        });
    }

    group.addEventListener('dragover', e => {
        if (dragSrcOrg && dragSrcOrg !== label && !isUncategorized) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            clearOrgDropIndicators();
            const rect = group.getBoundingClientRect();
            group.classList.add(e.clientY < rect.top + rect.height / 2 ? 'org-drop-before' : 'org-drop-after');
            return;
        }
        // fall through to project-on-header drop (handled below)
    });
    group.addEventListener('dragleave', e => {
        if (!group.contains(e.relatedTarget)) { group.classList.remove('org-drop-before', 'org-drop-after'); }
    });
    group.addEventListener('drop', e => {
        if (dragSrcOrg && dragSrcOrg !== label && !isUncategorized) {
            e.preventDefault();
            e.stopPropagation();
            const insertBefore = group.classList.contains('org-drop-before');
            clearOrgDropIndicators();
            // compute new org order from DOM
            const allOrgEls = [...document.querySelectorAll('.group[data-org]:not([data-org=""])')];
            const orgs = allOrgEls.map(g => g.dataset.org);
            const srcIdx = orgs.indexOf(dragSrcOrg);
            orgs.splice(srcIdx, 1);
            const tgtIdx = orgs.indexOf(label);
            orgs.splice(insertBefore ? tgtIdx : tgtIdx + 1, 0, dragSrcOrg);
            // optimistic reorder of allProjects
            const reordered = [];
            for (const org of orgs) { reordered.push(...allProjects.filter(p => p.organization === org)); }
            reordered.push(...allProjects.filter(p => !p.organization));
            allProjects = reordered;
            vscode.postMessage({ type: 'reorderOrgs', orgs });
            render(searchEl.value);
            return;
        }
    });

    // ── project-on-org-header drop ───────────────────────────────────────────
    const getTargetOrg = () => isUncategorized ? '' : label;
    const canDropProject = () => {
        if (!dragSrcPath) { return false; }
        const src = allProjects.find(p => p.rootPath === dragSrcPath);
        return !src || src.organization !== getTargetOrg();
    };

    header.addEventListener('dragenter', e => {
        if (!canDropProject()) { return; }
        e.preventDefault();
        header.classList.add('org-drop-target');
    });
    header.addEventListener('dragover', e => {
        if (!canDropProject()) { return; }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
    });
    header.addEventListener('dragleave', e => {
        if (!header.contains(e.relatedTarget)) { header.classList.remove('org-drop-target'); }
    });
    header.addEventListener('drop', e => {
        header.classList.remove('org-drop-target');
        if (!dragSrcPath) { return; }
        e.preventDefault();
        e.stopPropagation();
        const src = allProjects.find(p => p.rootPath === dragSrcPath);
        const targetOrg = getTargetOrg();
        if (!src || src.organization === targetOrg) { return; }
        src.organization = targetOrg;
        vscode.postMessage({ type: 'setOrg', path: dragSrcPath, org: targetOrg });
        render(searchEl.value);
    });

    for (const p of projects) { body.appendChild(makeItem(p, true, '')); }
    group.appendChild(header);
    group.appendChild(body);
    return group;
}

function makeItem(project, draggable, q) {
    const el = document.createElement('div');
    el.className = 'project-item' + (project.rootPath === activeRootPath ? ' active-project' : '');
    el.dataset.path = project.rootPath;

    const nameHtml = q ? highlight(project.name, q) : escHtml(project.name);
    const subHtml  = q && project.organization ? highlight(project.organization, q) : '';

    // label badge
    const labelHtml = project.label
        ? '<span class="proj-label">' + escHtml(project.label) + '</span>'
        : '';

    const folderColorStyle = project.color ? ' style="color:' + escHtml(project.color) + '"' : '';

    // static inner HTML
    el.innerHTML =
        (draggable ? '<span class="drag-handle" title="Drag to reorder · drag to org header to move">⠿</span>' : '') +
        '<span class="folder-icon"' + folderColorStyle + '><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1.5 3A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H7.621a1.5 1.5 0 0 1-1.06-.44L5.5 3H1.5z"/></svg></span>' +
        '<div class="info">' +
            '<div class="proj-name"><span class="proj-name-text">' + nameHtml + '</span>' + labelHtml + '</div>' +
            '<div class="proj-sub">' + subHtml + '</div>' +
        '</div>' +
        '<div class="proj-actions"></div>';

    // action buttons (appended via DOM to avoid XSS via secondaryEditor string)
    const actionsEl = el.querySelector('.proj-actions');

    const termBtn = document.createElement('button');
    termBtn.className = 'act-btn';
    termBtn.title = 'Open in terminal';
    termBtn.textContent = '>_';
    termBtn.addEventListener('click', e => {
        e.stopPropagation();
        vscode.postMessage({ type: 'openTerminal', path: project.rootPath });
    });
    actionsEl.appendChild(termBtn);

    if (project.secondaryEditor) {
        const editorBtn = document.createElement('button');
        editorBtn.className = 'act-btn';
        editorBtn.title = 'Open in ' + project.secondaryEditor;
        editorBtn.textContent = '↗';
        editorBtn.addEventListener('click', e => {
            e.stopPropagation();
            vscode.postMessage({ type: 'openSecondaryEditor', path: project.rootPath });
        });
        actionsEl.appendChild(editorBtn);
    }

    el.addEventListener('click', e => {
        if (e.target.closest('.drag-handle') || e.target.closest('.proj-actions')) { return; }
        showLoading();
        vscode.postMessage({ type: 'openProject', path: project.rootPath });
    });

    el.addEventListener('contextmenu', e => {
        e.preventDefault();
        ctxProject = project;
        showCtx(e.clientX, e.clientY);
    });

    if (draggable) { attachDrag(el, project); }
    return el;
}

// ── drag & drop ───────────────────────────────────────────────────────────────
function attachDrag(el, project) {
    const handle = el.querySelector('.drag-handle');
    handle.addEventListener('mousedown', () => el.setAttribute('draggable', 'true'));
    handle.addEventListener('mouseup',   () => el.setAttribute('draggable', 'false'));

    el.addEventListener('dragstart', e => {
        dragSrcPath = project.rootPath;
        dragSrcOrg  = null;
        e.stopPropagation(); // prevent bubbling to org group dragstart (which would cancel the drag)
        requestAnimationFrame(() => el.classList.add('dragging'));
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', project.rootPath);
    });
    el.addEventListener('dragend', () => {
        el.setAttribute('draggable', 'false');
        el.classList.remove('dragging');
        clearDropIndicators();
        dragSrcPath = null;
    });
    el.addEventListener('dragover', e => {
        if (!dragSrcPath || dragSrcPath === project.rootPath) { return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearDropIndicators();
        const rect = el.getBoundingClientRect();
        el.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
    });
    el.addEventListener('dragleave', e => {
        if (!el.contains(e.relatedTarget)) { el.classList.remove('drop-before', 'drop-after'); }
    });
    el.addEventListener('drop', e => {
        if (!dragSrcPath || dragSrcPath === project.rootPath) { return; }
        e.preventDefault();
        const insertBefore = el.classList.contains('drop-before');
        clearDropIndicators();
        const srcIdx = allProjects.findIndex(p => p.rootPath === dragSrcPath);
        const [moved] = allProjects.splice(srcIdx, 1);
        const newTgt  = allProjects.findIndex(p => p.rootPath === project.rootPath);
        allProjects.splice(insertBefore ? newTgt : newTgt + 1, 0, moved);
        vscode.postMessage({ type: 'reorder', paths: allProjects.map(p => p.rootPath) });
        render(searchEl.value);
    });
}

function clearDropIndicators() {
    document.querySelectorAll('.drop-before,.drop-after').forEach(x =>
        x.classList.remove('drop-before', 'drop-after'));
}

// ── context menu ──────────────────────────────────────────────────────────────
function showCtx(x, y) {
    ctxEl.style.left = '-9999px';
    ctxEl.style.top  = '-9999px';
    ctxEl.classList.add('open');
    requestAnimationFrame(() => {
        const r = ctxEl.getBoundingClientRect();
        ctxEl.style.left = Math.max(0, Math.min(x, window.innerWidth  - r.width))  + 'px';
        ctxEl.style.top  = Math.max(0, Math.min(y, window.innerHeight - r.height)) + 'px';
    });
}

ctxEl.addEventListener('click', e => {
    const item = e.target.closest('[data-action]');
    if (!item || !ctxProject) { return; }
    const action = item.dataset.action;
    if (action === 'openProjectSettings') {
        openSettings(ctxProject);
    } else {
        if (action === 'openProject' || action === 'openNew') { showLoading(); }
        vscode.postMessage({ type: action, path: ctxProject.rootPath });
    }
    ctxEl.classList.remove('open');
    ctxProject = null;
});

document.addEventListener('click', () => ctxEl.classList.remove('open'));
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        ctxEl.classList.remove('open');
        closeSettings();
    }
});

// ── settings panel ────────────────────────────────────────────────────────────
function openSettings(project) {
    spProject = project;
    spColor   = project.color || '';
    spTitleEl.textContent = 'Settings — ' + project.name;
    spLabelEl.value  = project.label  || '';
    spEditorEl.value = project.secondaryEditor || '';

    selectSwatch(spColor);
    setPickerColor(spColor);

    settingsEl.classList.add('open');
    spLabelEl.focus();
}

function closeSettings() {
    settingsEl.classList.remove('open');
    spProject = null;
}

document.getElementById('sp-close').addEventListener('click',  closeSettings);
document.getElementById('sp-cancel').addEventListener('click', closeSettings);
document.getElementById('sp-save').addEventListener('click', () => {
    if (!spProject) { return; }
    vscode.postMessage({
        type: 'saveSettings',
        path: spProject.rootPath,
        color: spColor,
        label: spLabelEl.value.trim(),
        secondaryEditor: spEditorEl.value.trim()
    });
    closeSettings();
});

// ── utils ─────────────────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function highlight(text, q) {
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) { return escHtml(text); }
    return escHtml(text.slice(0, idx))
        + '<span class="hl">' + escHtml(text.slice(idx, idx + q.length)) + '</span>'
        + escHtml(text.slice(idx + q.length));
}
</script>
</body>
</html>`;
    }
}
