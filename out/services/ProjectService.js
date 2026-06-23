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
exports.ProjectService = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class ProjectService {
    constructor(configService) {
        this.cache = null;
        this.configService = configService;
    }
    async getProjects() {
        if (this.cache !== null) {
            return this.cache;
        }
        return this.loadProjects();
    }
    async loadProjects() {
        const filePath = this.configService.getProjectsFilePath();
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const raw = JSON.parse(content);
            // Migrate legacy format: convert tags[] → organization string
            this.cache = raw.map(p => ({
                name: p.name ?? '',
                rootPath: p.rootPath ?? '',
                paths: p.paths ?? [],
                organization: typeof p.organization === 'string'
                    ? p.organization
                    : (Array.isArray(p.tags) && p.tags[0] ? String(p.tags[0]) : ''),
                enabled: p.enabled ?? true,
                profile: p.profile ?? ''
            }));
            return this.cache;
        }
        catch {
            this.cache = [];
            return this.cache;
        }
    }
    invalidateCache() {
        this.cache = null;
    }
    async saveProjects(projects) {
        const filePath = this.configService.getProjectsFilePath();
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(projects, null, 4), 'utf-8');
        this.cache = projects;
    }
    async addProject(project) {
        const projects = await this.getProjects();
        if (projects.some(p => p.rootPath === project.rootPath)) {
            return false;
        }
        projects.push(project);
        await this.saveProjects(projects);
        return true;
    }
    async removeProject(rootPath) {
        const projects = await this.getProjects();
        await this.saveProjects(projects.filter(p => p.rootPath !== rootPath));
    }
    async renameProject(rootPath, newName) {
        const projects = await this.getProjects();
        const p = projects.find(p => p.rootPath === rootPath);
        if (p) {
            p.name = newName;
            await this.saveProjects(projects);
        }
    }
    async updateOrganization(rootPath, organization) {
        const projects = await this.getProjects();
        const p = projects.find(p => p.rootPath === rootPath);
        if (p) {
            p.organization = organization;
            await this.saveProjects(projects);
        }
    }
    async getAllOrganizations() {
        const projects = await this.getProjects();
        const set = new Set();
        for (const p of projects) {
            if (p.organization) {
                set.add(p.organization);
            }
        }
        return [...set].sort();
    }
    async reorderProjects(rootPaths) {
        const projects = await this.getProjects();
        const map = new Map(projects.map(p => [p.rootPath, p]));
        const reordered = rootPaths.map(r => map.get(r)).filter((p) => !!p);
        const extra = projects.filter(p => !rootPaths.includes(p.rootPath));
        await this.saveProjects([...reordered, ...extra]);
    }
    async searchProjects(query) {
        const projects = await this.getProjects();
        if (!query.trim()) {
            return projects;
        }
        const lower = query.toLowerCase();
        return projects.filter(p => p.name.toLowerCase().includes(lower) ||
            p.rootPath.toLowerCase().includes(lower) ||
            p.organization.toLowerCase().includes(lower));
    }
}
exports.ProjectService = ProjectService;
//# sourceMappingURL=ProjectService.js.map