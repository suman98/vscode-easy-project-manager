import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './services/ConfigService';
import { ProjectService } from './services/ProjectService';
import { ProjectWebviewProvider } from './providers/ProjectWebviewProvider';
import { addCurrentWorkspace } from './commands/addProject';
import { openProjectFromQuickPick } from './commands/openProject';

export function activate(context: vscode.ExtensionContext): void {
    const configService = new ConfigService();
    const projectService = new ProjectService(configService);
    const provider = new ProjectWebviewProvider(context.extensionUri, projectService, configService);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ProjectWebviewProvider.viewType,
            provider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Watch the projects JSON file for external edits
    let fileWatcher: fs.FSWatcher | null = null;

    function setupFileWatcher(): void {
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
        } catch {
            // Directory may not exist yet; will be created on first save
        }
    }

    setupFileWatcher();

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('projectManager')) {
                setupFileWatcher();
                provider.refresh();
            }
        }),

        vscode.workspace.onDidChangeWorkspaceFolders(() => provider.sendProjects()),

        vscode.commands.registerCommand('projectManager.addCurrentWorkspace', () =>
            addCurrentWorkspace(projectService, provider)
        ),

        vscode.commands.registerCommand('projectManager.refresh', () =>
            provider.refresh()
        ),

        vscode.commands.registerCommand('projectManager.openProject', () =>
            openProjectFromQuickPick(projectService, configService)
        ),

        vscode.commands.registerCommand('projectManager.currentWorkspaceAdded', () => {
            vscode.window.showInformationMessage('This workspace is already added to Project Manager.');
        }),

        vscode.commands.registerCommand('projectManager.editJson', async () => {
            const filePath = configService.getProjectsFilePath();
            try {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch {
                vscode.window.showErrorMessage(`Could not open ${filePath}`);
            }
        })
    );

    context.subscriptions.push({
        dispose: () => { fileWatcher?.close(); }
    });
}

export function deactivate(): void {}
