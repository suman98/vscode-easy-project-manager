import * as vscode from 'vscode';
import { resolvePath } from '../utils/FileUtils';

export class ConfigService {
    private get config(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('projectManager');
    }

    getProjectsFilePath(): string {
        const raw = this.config.get<string>('file', '~/.vscode-project-manager/projects.json');
        return resolvePath(raw);
    }

    isOpenInNewWindow(): boolean {
        return this.config.get<boolean>('openInNewWindow', true);
    }
}
