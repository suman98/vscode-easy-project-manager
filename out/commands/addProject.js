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
exports.pickOrganization = pickOrganization;
exports.addCurrentWorkspace = addCurrentWorkspace;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
async function pickOrganization(projectService, current) {
    const orgs = await projectService.getAllOrganizations();
    const items = [
        { label: '$(circle-slash) No Organization', _none: true },
        ...orgs.map(o => ({ label: o, description: o === current ? 'current' : undefined })),
        { label: '$(add) New organization…', _new: true }
    ];
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select or create an organization',
        ignoreFocusOut: true
    });
    if (!pick) {
        return undefined;
    }
    if (pick._none) {
        return '';
    }
    if (pick._new) {
        const name = await vscode.window.showInputBox({
            prompt: 'Organization name',
            validateInput: v => v.trim() ? null : 'Name cannot be empty',
            ignoreFocusOut: true
        });
        return name === undefined ? undefined : name.trim();
    }
    return pick.label;
}
async function addCurrentWorkspace(projectService, provider) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder is open.');
        return;
    }
    const rootPath = folders[0].uri.fsPath;
    const defaultName = path.basename(rootPath);
    const name = await vscode.window.showInputBox({
        prompt: 'Project name',
        value: defaultName,
        validateInput: v => v.trim() ? null : 'Name cannot be empty',
        ignoreFocusOut: true
    });
    if (!name) {
        return;
    }
    const organization = await pickOrganization(projectService);
    if (organization === undefined) {
        return;
    }
    const added = await projectService.addProject({
        name: name.trim(),
        rootPath,
        paths: [],
        organization,
        enabled: true,
        profile: ''
    });
    if (added) {
        vscode.window.showInformationMessage(`Project "${name}" added.`);
        provider.refresh();
    }
    else {
        vscode.window.showWarningMessage(`Project at "${rootPath}" already exists.`);
    }
}
//# sourceMappingURL=addProject.js.map