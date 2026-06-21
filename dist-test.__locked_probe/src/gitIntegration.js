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
exports.createGitIntegration = createGitIntegration;
exports.getGitContext = getGitContext;
const vscode = __importStar(require("vscode"));
const MISSING_GIT_MESSAGE = 'Git extension not available. Sessions will be saved without git metadata.';
function normalizeUri(value) {
    return value.replace(/\/+$/g, '').toLowerCase();
}
function computeDirtyState(state) {
    return ((state.workingTreeChanges?.length ?? 0) > 0
        || (state.indexChanges?.length ?? 0) > 0
        || (state.mergeChanges?.length ?? 0) > 0);
}
function pickRepository(workspaceFolder, repositories) {
    const target = normalizeUri(workspaceFolder.toString());
    const sorted = [...repositories].sort((a, b) => normalizeUri(b.rootUri.toString()).length - normalizeUri(a.rootUri.toString()).length);
    return sorted.find((repository) => {
        const root = normalizeUri(repository.rootUri.toString());
        return target === root || target.startsWith(`${root}/`) || target.startsWith(`${root}\\`);
    });
}
function createDefaultDeps() {
    return {
        getGitExtension: () => vscode.extensions.getExtension('vscode.git'),
        showInformationMessage: (message) => vscode.window.showInformationMessage(message),
    };
}
function createGitIntegration(overrides = {}) {
    const deps = {
        ...createDefaultDeps(),
        ...overrides,
    };
    let didWarnMissingGit = false;
    async function notifyMissingGitOnce() {
        if (didWarnMissingGit) {
            return;
        }
        didWarnMissingGit = true;
        await deps.showInformationMessage(MISSING_GIT_MESSAGE);
    }
    return {
        async getGitContext(workspaceFolder) {
            const extension = deps.getGitExtension();
            if (!extension) {
                await notifyMissingGitOnce();
                return null;
            }
            const gitExports = extension.isActive ? extension.exports : await extension.activate();
            if (!gitExports || typeof gitExports.getAPI !== 'function') {
                await notifyMissingGitOnce();
                return null;
            }
            const gitApi = gitExports.getAPI(1);
            if (!gitApi.repositories.length) {
                return null;
            }
            const repository = pickRepository(workspaceFolder, gitApi.repositories);
            if (!repository) {
                return null;
            }
            const branch = repository.state.HEAD?.name ?? 'detached';
            const commit = repository.state.HEAD?.commit ?? '';
            const dirty = computeDirtyState(repository.state);
            if (!commit) {
                return null;
            }
            return { branch, commit, dirty };
        },
    };
}
const defaultGitIntegration = createGitIntegration();
async function getGitContext(workspaceFolder) {
    return defaultGitIntegration.getGitContext(workspaceFolder);
}
//# sourceMappingURL=gitIntegration.js.map