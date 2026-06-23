import * as fs from 'fs/promises';
import * as path from 'path';
import { Project } from '../models/Project';
import { ConfigService } from './ConfigService';

export class ProjectService {
    private configService: ConfigService;
    private cache: Project[] | null = null;

    constructor(configService: ConfigService) {
        this.configService = configService;
    }

    async getProjects(): Promise<Project[]> {
        if (this.cache !== null) { return this.cache; }
        return this.loadProjects();
    }

    async loadProjects(): Promise<Project[]> {
        const filePath = this.configService.getProjectsFilePath();
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const raw = JSON.parse(content);
            this.cache = (raw as any[]).map(p => ({
                name: p.name ?? '',
                rootPath: p.rootPath ?? '',
                paths: p.paths ?? [],
                organization: typeof p.organization === 'string'
                    ? p.organization
                    : (Array.isArray(p.tags) && p.tags[0] ? String(p.tags[0]) : ''),
                enabled: p.enabled ?? true,
                profile: p.profile ?? '',
                color: p.color ?? '',
                label: p.label ?? '',
                secondaryEditor: p.secondaryEditor ?? ''
            })) as Project[];
            return this.cache;
        } catch {
            this.cache = [];
            return this.cache;
        }
    }

    invalidateCache(): void {
        this.cache = null;
    }

    async saveProjects(projects: Project[]): Promise<void> {
        const filePath = this.configService.getProjectsFilePath();
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(projects, null, 4), 'utf-8');
        this.cache = projects;
    }

    async addProject(project: Project): Promise<boolean> {
        const projects = await this.getProjects();
        if (projects.some(p => p.rootPath === project.rootPath)) { return false; }
        projects.push(project);
        await this.saveProjects(projects);
        return true;
    }

    async removeProject(rootPath: string): Promise<void> {
        const projects = await this.getProjects();
        await this.saveProjects(projects.filter(p => p.rootPath !== rootPath));
    }

    async renameProject(rootPath: string, newName: string): Promise<void> {
        const projects = await this.getProjects();
        const p = projects.find(p => p.rootPath === rootPath);
        if (p) { p.name = newName; await this.saveProjects(projects); }
    }

    async deleteOrganization(name: string): Promise<void> {
        const projects = await this.getProjects();
        let changed = false;
        for (const p of projects) {
            if (p.organization === name) { p.organization = ''; changed = true; }
        }
        if (changed) { await this.saveProjects(projects); }
    }

    async renameOrganization(oldName: string, newName: string): Promise<void> {
        const projects = await this.getProjects();
        let changed = false;
        for (const p of projects) {
            if (p.organization === oldName) { p.organization = newName; changed = true; }
        }
        if (changed) { await this.saveProjects(projects); }
    }

    async updateOrganization(rootPath: string, organization: string): Promise<void> {
        const projects = await this.getProjects();
        const p = projects.find(p => p.rootPath === rootPath);
        if (p) { p.organization = organization; await this.saveProjects(projects); }
    }

    async updateProjectSettings(
        rootPath: string,
        settings: Pick<Project, 'color' | 'label' | 'secondaryEditor'>
    ): Promise<void> {
        const projects = await this.getProjects();
        const p = projects.find(p => p.rootPath === rootPath);
        if (p) {
            p.color = settings.color;
            p.label = settings.label;
            p.secondaryEditor = settings.secondaryEditor;
            await this.saveProjects(projects);
        }
    }

    async getAllOrganizations(): Promise<string[]> {
        const projects = await this.getProjects();
        const set = new Set<string>();
        for (const p of projects) {
            if (p.organization) { set.add(p.organization); }
        }
        return [...set].sort();
    }

    async reorderProjects(rootPaths: string[]): Promise<void> {
        const projects = await this.getProjects();
        const map = new Map(projects.map(p => [p.rootPath, p]));
        const reordered = rootPaths.map(r => map.get(r)).filter((p): p is Project => !!p);
        const extra = projects.filter(p => !rootPaths.includes(p.rootPath));
        await this.saveProjects([...reordered, ...extra]);
    }

    async searchProjects(query: string): Promise<Project[]> {
        const projects = await this.getProjects();
        if (!query.trim()) { return projects; }
        const lower = query.toLowerCase();
        return projects.filter(p =>
            p.name.toLowerCase().includes(lower) ||
            p.rootPath.toLowerCase().includes(lower) ||
            p.organization.toLowerCase().includes(lower) ||
            p.label.toLowerCase().includes(lower)
        );
    }
}
