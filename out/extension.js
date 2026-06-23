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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ConfigService_1 = require("./services/ConfigService");
const ProjectService_1 = require("./services/ProjectService");
const ProjectWebviewProvider_1 = require("./providers/ProjectWebviewProvider");
const addProject_1 = require("./commands/addProject");
const openProject_1 = require("./commands/openProject");
function activate(context) {
    const configService = new ConfigService_1.ConfigService();
    const projectService = new ProjectService_1.ProjectService(configService);
    const provider = new ProjectWebviewProvider_1.ProjectWebviewProvider(context.extensionUri, projectService, configService);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(ProjectWebviewProvider_1.ProjectWebviewProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true } }));
    // Watch the projects JSON file for external edits
    let fileWatcher = null;
    function setupFileWatcher() {
        fileWatcher?.close();
        fileWatcher = null;
        const filePath = configService.getProjectsFilePath();
        const dir = path.dirname(filePath);
        try {
            // Watch the directory so we catch file creation too
            fileWatcher = fs.watch(dir, (event, filename) => {
                if (!filename || filename === path.basename(filePath)) {
                    provider.refresh();
                }
            });
        }
        catch {
            // Directory may not exist yet; will be created on first save
        }
    }
    setupFileWatcher();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('projectManager')) {
            setupFileWatcher();
            provider.refresh();
        }
    }), vscode.commands.registerCommand('projectManager.addCurrentWorkspace', () => (0, addProject_1.addCurrentWorkspace)(projectService, provider)), vscode.commands.registerCommand('projectManager.refresh', () => provider.refresh()), vscode.commands.registerCommand('projectManager.openProject', () => (0, openProject_1.openProjectFromQuickPick)(projectService, configService)));
    context.subscriptions.push({
        dispose: () => { fileWatcher?.close(); }
    });
}
function deactivate() { }
//# sourceMappingURL=extension.js.map