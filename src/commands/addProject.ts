import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectService } from '../services/ProjectService';

export async function pickOrganization(
    projectService: ProjectService,
    current?: string
): Promise<string | undefined> {
    const orgs = await projectService.getAllOrganizations();

    type Item = vscode.QuickPickItem & { _none?: boolean; _new?: boolean };
    const items: Item[] = [
        { label: '$(circle-slash) No Organization', _none: true },
        ...orgs.map(o => ({ label: o, description: o === current ? 'current' : undefined })),
        { label: '$(add) New organization…', _new: true }
    ];

    const pick = await vscode.window.showQuickPick<Item>(items, {
        placeHolder: 'Select or create an organization',
        ignoreFocusOut: true
    });

    if (!pick) { return undefined; }
    if (pick._none) { return ''; }
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

export async function addCurrentWorkspace(
    projectService: ProjectService,
    provider: { refresh(): void }
): Promise<void> {
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
    if (!name) { return; }

    const organization = await pickOrganization(projectService);
    if (organization === undefined) { return; }

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
    } else {
        vscode.window.showWarningMessage(`Project at "${rootPath}" already exists.`);
    }
}
