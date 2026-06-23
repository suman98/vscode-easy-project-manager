import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { Project } from '../models/Project';
import { ProjectService } from '../services/ProjectService';
import { ConfigService } from '../services/ConfigService';

async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function doOpen(project: Project, forceNewWindow: boolean): Promise<void> {
    if (!(await pathExists(project.rootPath))) {
        vscode.window.showErrorMessage(`Path not found: ${project.rootPath}`);
        return;
    }
    const uri = vscode.Uri.file(project.rootPath);
    await vscode.commands.executeCommand('vscode.openFolder', uri, forceNewWindow);
}

export async function openProject(
    project: Project,
    configService: ConfigService
): Promise<void> {
    const newWindow = configService.isOpenInNewWindow();
    await doOpen(project, newWindow);
}

export async function openProjectInNewWindow(project: Project): Promise<void> {
    await doOpen(project, true);
}

export async function openProjectFromQuickPick(
    projectService: ProjectService,
    configService: ConfigService
): Promise<void> {
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
