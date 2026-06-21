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
exports.SessionExplorerProvider = exports.SessionExplorerSessionItem = exports.SessionExplorerWorkspaceItem = void 0;
exports.listSessionExplorerGroups = listSessionExplorerGroups;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const sessionStore_1 = require("./sessionStore");
const sessionStore = (0, sessionStore_1.createSessionStore)();
class SessionExplorerWorkspaceItem extends vscode.TreeItem {
    group;
    constructor(group) {
        super(group.workspaceFolder.name, vscode.TreeItemCollapsibleState.Expanded);
        this.group = group;
        this.description = `${group.sessions.length} session${group.sessions.length === 1 ? '' : 's'}`;
        this.tooltip = group.workspaceFolder.uri.fsPath;
        this.contextValue = 'session-control.workspace';
        this.iconPath = vscode.ThemeIcon.Folder;
    }
}
exports.SessionExplorerWorkspaceItem = SessionExplorerWorkspaceItem;
class SessionExplorerSessionItem extends vscode.TreeItem {
    session;
    fileName;
    storageDirectory;
    workspaceFolder;
    constructor(group, session) {
        super(session.title, vscode.TreeItemCollapsibleState.None);
        this.session = session;
        this.fileName = session.fileName;
        this.storageDirectory = group.storageDirectory;
        this.workspaceFolder = group.workspaceFolder;
        this.resourceUri = vscode.Uri.file(path.join(group.storageDirectory, session.fileName));
        this.description = `${session.turnCount} turns`;
        this.tooltip = `${session.savedAt}\n${session.fileName}`;
        this.contextValue = 'session-control.session';
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        this.command = {
            command: 'session-control.openSessionFromExplorer',
            title: 'Open Saved Session',
            arguments: [this],
        };
    }
}
exports.SessionExplorerSessionItem = SessionExplorerSessionItem;
function getStoragePath(workspaceFolder) {
    const configured = vscode.workspace
        .getConfiguration('session-control', workspaceFolder.uri)
        .get('storagePath', '.chat');
    if (!configured.trim()) {
        throw new Error('session-control.storagePath must not be empty.');
    }
    if (path.isAbsolute(configured)) {
        throw new Error('session-control.storagePath must be relative to the workspace folder.');
    }
    const resolved = path.resolve(workspaceFolder.uri.fsPath, configured);
    const relative = path.relative(workspaceFolder.uri.fsPath, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('session-control.storagePath must stay within the workspace folder.');
    }
    return resolved;
}
function createDefaultDeps() {
    return {
        getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
        getStoragePath,
        listSessions: (storageDirectory) => sessionStore.listSessions(storageDirectory),
    };
}
async function listSessionExplorerGroups(depsOverrides = {}) {
    const deps = {
        ...createDefaultDeps(),
        ...depsOverrides,
    };
    const workspaceFolders = deps.getWorkspaceFolders();
    if (!workspaceFolders?.length) {
        return [];
    }
    const groups = await Promise.all(workspaceFolders.map(async (workspaceFolder) => {
        const storageDirectory = deps.getStoragePath(workspaceFolder);
        const sessions = await deps.listSessions(storageDirectory);
        return {
            workspaceFolder,
            storageDirectory,
            sessions,
        };
    }));
    return groups.filter((group) => group.sessions.length > 0);
}
class SessionExplorerProvider {
    depsOverrides;
    onDidChangeTreeDataEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    constructor(depsOverrides = {}) {
        this.depsOverrides = depsOverrides;
    }
    refresh() {
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            const groups = await listSessionExplorerGroups(this.depsOverrides);
            return groups.map((group) => new SessionExplorerWorkspaceItem(group));
        }
        if (element instanceof SessionExplorerWorkspaceItem) {
            return element.group.sessions.map((session) => new SessionExplorerSessionItem(element.group, session));
        }
        return [];
    }
}
exports.SessionExplorerProvider = SessionExplorerProvider;
//# sourceMappingURL=sessionExplorer.js.map