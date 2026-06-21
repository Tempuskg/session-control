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
const assert = __importStar(require("node:assert"));
const vscode = __importStar(require("vscode"));
const sessionExplorer_1 = require("../../src/sessionExplorer");
function createWorkspaceFolder(rootPath, name, index) {
    return {
        uri: vscode.Uri.file(rootPath),
        name,
        index,
    };
}
function createSession(title, fileName, savedAt) {
    return {
        id: `${title}-${savedAt}`,
        title,
        savedAt,
        fileName,
        turnCount: 4,
        git: null,
    };
}
suite('session explorer', () => {
    test('listSessionExplorerGroups returns only workspaces with sessions', async () => {
        const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
        const beta = createWorkspaceFolder('C:/beta', 'beta', 1);
        const groups = await (0, sessionExplorer_1.listSessionExplorerGroups)({
            getWorkspaceFolders: () => [alpha, beta],
            getStoragePath: (workspaceFolder) => `${workspaceFolder.uri.fsPath}/.chat`,
            listSessions: async (storageDirectory) => storageDirectory.includes('alpha')
                ? [createSession('Alpha Session', 'alpha.json', '2026-04-12T10:00:00.000Z')]
                : [],
        });
        assert.equal(groups.length, 1);
        assert.equal(groups[0]?.workspaceFolder.name, 'alpha');
        assert.equal(groups[0]?.sessions[0]?.title, 'Alpha Session');
    });
    test('SessionExplorerProvider returns workspace nodes and session leaf nodes', async () => {
        const alpha = createWorkspaceFolder('C:/alpha', 'alpha', 0);
        const provider = new sessionExplorer_1.SessionExplorerProvider({
            getWorkspaceFolders: () => [alpha],
            getStoragePath: () => 'C:/alpha/.chat',
            listSessions: async () => [
                createSession('Alpha Session', 'alpha.json', '2026-04-12T10:00:00.000Z'),
            ],
        });
        const rootNodes = await provider.getChildren();
        assert.equal(rootNodes.length, 1);
        assert.equal(rootNodes[0] instanceof sessionExplorer_1.SessionExplorerWorkspaceItem, true);
        const workspaceNode = rootNodes[0];
        const childNodes = await provider.getChildren(workspaceNode);
        assert.equal(childNodes.length, 1);
        assert.equal(childNodes[0] instanceof sessionExplorer_1.SessionExplorerSessionItem, true);
        assert.equal(childNodes[0]?.label, 'Alpha Session');
    });
});
//# sourceMappingURL=sessionExplorer.test.js.map