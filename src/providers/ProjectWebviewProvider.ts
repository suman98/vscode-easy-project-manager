import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { Project } from '../models/Project';
import { ProjectService } from '../services/ProjectService';
import { ConfigService } from '../services/ConfigService';
import { pickOrganization } from '../commands/addProject';

type WebviewMessage =
    | { type: 'openProject'; path: string }
    | { type: 'openNew'; path: string }
    | { type: 'rename'; path: string }
    | { type: 'moveToOrg'; path: string }
    | { type: 'setOrg'; path: string; org: string }
    | { type: 'remove'; path: string }
    | { type: 'reveal'; path: string }
    | { type: 'copyPath'; path: string }
    | { type: 'reorder'; paths: string[] };

async function pathExists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
}

export class ProjectWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'projectManagerView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly projectService: ProjectService,
        private readonly configService: ConfigService
    ) {}

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
        this._view.webview.postMessage({ type: 'update', projects, allOrganizations });
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

.search-wrap{position:sticky;top:0;z-index:10;padding:6px 8px;background:var(--vscode-sideBar-background,var(--vscode-editor-background));border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,transparent)}
.search-row{position:relative;display:flex;align-items:center}
.search-icon{position:absolute;left:8px;opacity:.5;font-size:13px;pointer-events:none}
.search-input{width:100%;padding:4px 24px 4px 28px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:2px;outline:none;font-size:inherit;font-family:inherit}
.search-input:focus{border-color:var(--vscode-focusBorder)}
.search-input::placeholder{color:var(--vscode-input-placeholderForeground)}
.clear-btn{position:absolute;right:6px;background:none;border:none;cursor:pointer;color:var(--vscode-input-foreground);opacity:.5;font-size:14px;line-height:1;padding:0 2px;display:none}
.clear-btn:hover{opacity:1}

.group{margin-top:2px}
.group-header{display:flex;align-items:center;padding:4px 8px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-foreground));cursor:pointer;user-select:none;opacity:.7;border-radius:2px;transition:background .1s,opacity .1s}
.group-header:hover{opacity:1}
.group-header.org-drop-target{background:var(--vscode-list-dropBackground,rgba(0,120,215,.15));outline:1px dashed var(--vscode-focusBorder);opacity:1}
.chevron{margin-right:4px;font-size:9px;display:inline-block;transition:transform .1s;flex-shrink:0}
.group-header.collapsed .chevron{transform:rotate(-90deg)}
.group-body.collapsed{display:none}
.group-count{opacity:.4;font-weight:400;margin-left:4px;font-size:10px}
.group-header>*{pointer-events:none}

.project-item{display:flex;align-items:center;padding:3px 8px 3px 12px;cursor:pointer;position:relative;min-height:30px;border:1px solid transparent}
.project-item:hover{background:var(--vscode-list-hoverBackground)}
.drag-handle{opacity:0;cursor:grab;padding-right:6px;flex-shrink:0;font-size:13px;color:var(--vscode-foreground);line-height:1}
.project-item:hover .drag-handle{opacity:.35}
.drag-handle:hover{opacity:.8!important}
.drag-handle:active{cursor:grabbing}
.folder-icon{margin-right:5px;flex-shrink:0;font-size:14px}
.info{flex:1;min-width:0;overflow:hidden}
.proj-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.proj-org{font-size:11px;opacity:.45;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.proj-path{font-size:11px;opacity:.45;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hl{background:var(--vscode-editor-findMatchHighlightBackground,rgba(255,200,0,.3));border-radius:2px}

.project-item.dragging{opacity:.3}
.project-item.drop-before{border-top:2px solid var(--vscode-focusBorder)!important}
.project-item.drop-after{border-bottom:2px solid var(--vscode-focusBorder)!important}

.empty{padding:24px 16px;opacity:.55;font-size:12px;text-align:center;line-height:1.6}

.ctx{position:fixed;background:var(--vscode-menu-background,var(--vscode-editorWidget-background));border:1px solid var(--vscode-menu-border,var(--vscode-widget-border));box-shadow:0 4px 14px rgba(0,0,0,.35);border-radius:4px;padding:4px 0;z-index:1000;min-width:180px;display:none}
.ctx.open{display:block}
.ctx-item{padding:5px 14px;cursor:pointer;font-size:var(--vscode-font-size);color:var(--vscode-menu-foreground,var(--vscode-foreground));white-space:nowrap}
.ctx-item:hover{background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground));color:var(--vscode-menu-selectionForeground,var(--vscode-foreground))}
.ctx-sep{height:1px;background:var(--vscode-menu-separatorBackground,var(--vscode-widget-border));margin:3px 0}
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

<div class="ctx" id="ctx">
  <div class="ctx-item" data-action="openProject">Open</div>
  <div class="ctx-item" data-action="openNew">Open in New Window</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" data-action="reveal">Reveal in Finder / Explorer</div>
  <div class="ctx-item" data-action="copyPath">Copy Path</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" data-action="moveToOrg">Move to Organization…</div>
  <div class="ctx-item" data-action="rename">Rename</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" data-action="remove">Remove</div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

let allProjects = [];
let allOrganizations = [];
let dragSrcPath = null;
let ctxProject = null;

const listEl   = document.getElementById('list');
const searchEl = document.getElementById('search');
const clearBtn = document.getElementById('clear-btn');
const ctxEl    = document.getElementById('ctx');

// ── messages ──────────────────────────────────────────────────────────────────
window.addEventListener('message', ({ data }) => {
    if (data.type === 'update') {
        allProjects      = data.projects;
        allOrganizations = data.allOrganizations || [];
        render(searchEl.value);
    }
});

// ── search ────────────────────────────────────────────────────────────────────
function doSearch() {
    const q = searchEl.value;
    clearBtn.style.display = q ? 'block' : 'none';
    render(q);
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
            (p.organization || '').toLowerCase().includes(q))
        : allProjects;

    if (filtered.length === 0) {
        listEl.innerHTML = q
            ? '<div class="empty">No matches for <strong>' + escHtml(query) + '</strong></div>'
            : '<div class="empty">No projects yet.<br>Click <strong>+</strong> in the toolbar to add one.</div>';
        return;
    }

    if (q) {
        // flat list when searching — show org as subtitle
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
    for (const org of [...orgMap.keys()].sort()) {
        frag.appendChild(makeGroup(org, orgMap.get(org), false));
    }
    if (noOrg.length > 0) { frag.appendChild(makeGroup('No Organization', noOrg, true)); }
    listEl.appendChild(frag);
}

function makeGroup(label, projects, isUncategorized) {
    const group = document.createElement('div');
    group.className = 'group';

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML =
        '<span class="chevron">▾</span>' + escHtml(label) +
        '<span class="group-count">' + projects.length + '</span>';

    const body = document.createElement('div');
    body.className = 'group-body';

    header.addEventListener('click', () => {
        header.classList.toggle('collapsed');
        body.classList.toggle('collapsed');
    });

    // drag-to-org: drop project onto header → moves it to this org
    const getTargetOrg = () => isUncategorized ? '' : label;
    const canDrop = () => {
        if (!dragSrcPath) { return false; }
        const src = allProjects.find(p => p.rootPath === dragSrcPath);
        return !src || src.organization !== getTargetOrg();
    };

    header.addEventListener('dragenter', e => {
        if (!canDrop()) { return; }
        e.preventDefault();
        header.classList.add('org-drop-target');
    });
    header.addEventListener('dragover', e => {
        if (!canDrop()) { return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });
    header.addEventListener('dragleave', e => {
        // only remove indicator when cursor truly leaves the header element
        if (!header.contains(e.relatedTarget)) {
            header.classList.remove('org-drop-target');
        }
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
    el.className = 'project-item';
    el.dataset.path = project.rootPath;

    const name = q ? highlight(project.name, q) : escHtml(project.name);

    el.innerHTML =
        (draggable ? '<span class="drag-handle" title="Drag to reorder · drag to org header to move">⠿</span>' : '') +
        '<span class="folder-icon">📁</span>' +
        '<div class="info">' +
            '<div class="proj-name">' + name + '</div>' +
            (q && project.organization
                ? '<div class="proj-org">' + highlight(project.organization, q) + '</div>'
                : '<div class="proj-path">' + (q ? highlight(project.rootPath, q) : escHtml(project.rootPath)) + '</div>') +
        '</div>';

    el.addEventListener('click', e => {
        if (e.target.closest('.drag-handle')) { return; }
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
        el.classList.add('dragging');
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

    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));

    el.addEventListener('drop', e => {
        if (!dragSrcPath || dragSrcPath === project.rootPath) { return; }
        e.preventDefault();
        const insertBefore = el.classList.contains('drop-before');
        clearDropIndicators();

        const srcIdx = allProjects.findIndex(p => p.rootPath === dragSrcPath);
        const tgtIdx = allProjects.findIndex(p => p.rootPath === project.rootPath);
        if (srcIdx === -1 || tgtIdx === -1) { return; }
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
        const left = Math.max(0, Math.min(x, window.innerWidth  - r.width));
        const top  = Math.max(0, Math.min(y, window.innerHeight - r.height));
        ctxEl.style.left = left + 'px';
        ctxEl.style.top  = top  + 'px';
    });
}

ctxEl.addEventListener('click', e => {
    const item = e.target.closest('[data-action]');
    if (!item || !ctxProject) { return; }
    vscode.postMessage({ type: item.dataset.action, path: ctxProject.rootPath });
    ctxEl.classList.remove('open');
    ctxProject = null;
});

document.addEventListener('click', () => ctxEl.classList.remove('open'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { ctxEl.classList.remove('open'); } });

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
