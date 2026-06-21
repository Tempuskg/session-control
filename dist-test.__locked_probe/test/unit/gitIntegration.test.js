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
const gitIntegration_1 = require("../../src/gitIntegration");
function createRepo(root, branch, commit, dirty) {
    return {
        rootUri: { toString: () => root },
        state: {
            HEAD: { name: branch, commit },
            workingTreeChanges: dirty ? [{}] : [],
            indexChanges: [],
            mergeChanges: [],
        },
    };
}
suite('gitIntegration', () => {
    test('returns null and warns once when git extension is missing', async () => {
        const messages = [];
        const integration = (0, gitIntegration_1.createGitIntegration)({
            getGitExtension: () => undefined,
            showInformationMessage: async (message) => {
                messages.push(message);
            },
        });
        const workspace = { toString: () => 'file:///workspace' };
        const first = await integration.getGitContext(workspace);
        const second = await integration.getGitContext(workspace);
        assert.equal(first, null);
        assert.equal(second, null);
        assert.equal(messages.length, 1);
    });
    test('returns null when no repository matches workspace folder', async () => {
        const integration = (0, gitIntegration_1.createGitIntegration)({
            getGitExtension: () => ({
                isActive: true,
                exports: {
                    getAPI: () => ({
                        repositories: [createRepo('file:///other', 'main', 'abc123', false)],
                    }),
                },
                activate: async () => ({
                    getAPI: () => ({
                        repositories: [createRepo('file:///other', 'main', 'abc123', false)],
                    }),
                }),
            }),
            showInformationMessage: async () => undefined,
        });
        const result = await integration.getGitContext({ toString: () => 'file:///workspace' });
        assert.equal(result, null);
    });
    test('selects the best matching repository and returns git context', async () => {
        const repositories = [
            createRepo('file:///workspace', 'main', 'aaa111', false),
            createRepo('file:///workspace/packages/app', 'feature/auth', 'bbb222', true),
        ];
        const integration = (0, gitIntegration_1.createGitIntegration)({
            getGitExtension: () => ({
                isActive: true,
                exports: {
                    getAPI: () => ({ repositories }),
                },
                activate: async () => ({
                    getAPI: () => ({ repositories }),
                }),
            }),
            showInformationMessage: async () => undefined,
        });
        const result = await integration.getGitContext({
            toString: () => 'file:///workspace/packages/app/src',
        });
        assert.ok(result);
        assert.equal(result?.branch, 'feature/auth');
        assert.equal(result?.commit, 'bbb222');
        assert.equal(result?.dirty, true);
    });
    test('returns null when repository has no commit yet', async () => {
        const repositories = [
            {
                rootUri: { toString: () => 'file:///workspace' },
                state: {
                    HEAD: { name: 'main', commit: '' },
                    workingTreeChanges: [],
                    indexChanges: [],
                    mergeChanges: [],
                },
            },
        ];
        const integration = (0, gitIntegration_1.createGitIntegration)({
            getGitExtension: () => ({
                isActive: true,
                exports: {
                    getAPI: () => ({ repositories }),
                },
                activate: async () => ({
                    getAPI: () => ({ repositories }),
                }),
            }),
            showInformationMessage: async () => undefined,
        });
        const result = await integration.getGitContext({ toString: () => 'file:///workspace' });
        assert.equal(result, null);
    });
});
//# sourceMappingURL=gitIntegration.test.js.map