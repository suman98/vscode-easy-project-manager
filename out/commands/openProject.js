"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.openProject = openProject;
exports.openProjectInNewWindow = openProjectInNewWindow;
exports.openProjectFromQuickPick = openProjectFromQuickPick;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs/promises"));
async function pathExists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function doOpen(project, forceNewWindow) {
    if (!(await pathExists(project.rootPath))) {
        vscode.window.showErrorMessage(`Path not found: ${project.rootPath}`);
        return;
    }
    const uri = vscode.Uri.file(project.rootPath);
    await vscode.commands.executeCommand('vscode.openFolder', uri, forceNewWindow);
}
async function openProject(project, configService) {
    const newWindow = configService.isOpenInNewWindow();
    await doOpen(project, newWindow);
}
async function openProjectInNewWindow(project) {
    await doOpen(project, true);
}
async function openProjectFromQuickPick(projectService, configService) {
    const projects = await projectService.getProjects();
    if (projects.length === 0) {
        vscode.window.showInformationMessage('No projects saved yet. Add one with "Project Manager: Add Current Workspace".');
        return;
    }
    const items = projects.map(p => ({
        label: p.name,
        description: p.organization,
        detail: p.rootPath,
        project: p
    }));
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a project to open',
        matchOnDescription: true,
        matchOnDetail: true
    });
    if (selected) {
        await openProject(selected.project, configService);
    }
}
//# sourceMappingURL=openProject.js.map