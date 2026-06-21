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
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const analysisStore_1 = require("../../src/analysisStore");
const sessionAnalysis_1 = require("../../src/sessionAnalysis");
function createSession(id, savedAt, title, response) {
    return {
        version: 1,
        id,
        title,
        savedAt,
        git: { branch: 'main', commit: 'abcdef123456', dirty: false },
        vscodeVersion: '1.115.0',
        totalTurns: 2,
        part: null,
        totalParts: null,
        previousPartFile: null,
        nextPartFile: null,
        turns: [
            {
                type: 'request',
                participant: 'copilot',
                prompt: 'Investigate the issue',
                references: [],
                timestamp: '2026-05-17T10:00:00.000Z',
            },
            {
                type: 'response',
                participant: 'copilot',
                content: response,
                toolCalls: [
                    {
                        name: 'read_file',
                        summary: 'Read the implementation file',
                        arguments: 'src/file.ts',
                    },
                ],
                timestamp: '2026-05-17T10:01:00.000Z',
            },
        ],
        markdownSummary: `# Chat: ${title}`,
    };
}
suite('analysisStore', () => {
    test('writeReport persists a markdown report under analysis/reports', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-analysis-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, analysisStore_1.createAnalysisStore)();
        try {
            const persisted = await store.writeReport(storageDirectory, {
                selection: (0, sessionAnalysis_1.createNeedsAnalysisSelection)(),
                promptVersion: '1',
                contributingWorkspaces: ['workspace'],
                analyzedFingerprints: ['fingerprint-a'],
                status: 'complete',
                content: '## Findings\n\nA useful finding.',
                createdAt: '2026-05-17T12:00:00.000Z',
            });
            const reportContent = await fs.readFile(persisted.reportFilePath, 'utf8');
            assert.equal(persisted.report.reportPath.startsWith('analysis/reports/'), true);
            assert.equal(reportContent.includes('# Chat Analysis Report'), true);
            assert.equal(reportContent.includes('Needs Analysis'), true);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('recordAnalysis persists analyzed fingerprints and supports lookup', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-analysis-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, analysisStore_1.createAnalysisStore)();
        try {
            const persisted = await store.writeReport(storageDirectory, {
                selection: (0, sessionAnalysis_1.createNeedsAnalysisSelection)(),
                promptVersion: '1',
                contributingWorkspaces: ['workspace'],
                analyzedFingerprints: ['fingerprint-a'],
                status: 'complete',
                content: '## Findings\n\nA useful finding.',
                createdAt: '2026-05-17T12:00:00.000Z',
            });
            await store.recordAnalysis(storageDirectory, persisted.report, [
                {
                    fingerprint: 'fingerprint-a',
                    sessionId: 'session-a',
                    title: 'Session A',
                    savedAt: '2026-05-17T10:00:00.000Z',
                },
            ]);
            const index = await store.readIndex(storageDirectory);
            assert.equal(index.reports.length, 1);
            assert.equal(index.analyzedSessions.length, 1);
            assert.equal(await store.hasAnalyzedFingerprint(storageDirectory, 'fingerprint-a'), true);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('readReport returns the persisted markdown report content', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'session-control-analysis-store-'));
        const storageDirectory = path.join(tempRoot, '.chat');
        const store = (0, analysisStore_1.createAnalysisStore)();
        try {
            const persisted = await store.writeReport(storageDirectory, {
                selection: (0, sessionAnalysis_1.createNeedsAnalysisSelection)(),
                promptVersion: '1',
                contributingWorkspaces: ['workspace'],
                analyzedFingerprints: ['fingerprint-a'],
                status: 'complete',
                content: '## Findings\n\nA useful finding.',
                createdAt: '2026-05-17T12:00:00.000Z',
            });
            const reportContent = await store.readReport(storageDirectory, persisted.report.reportPath);
            assert.equal(reportContent.includes('A useful finding.'), true);
        }
        finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
    test('createSessionAnalysisFingerprint ignores non-content metadata but changes when content changes', () => {
        const first = createSession('session-a', '2026-05-17T10:00:00.000Z', 'Title', 'Initial response');
        const sameContentDifferentSave = createSession('session-a', '2026-05-18T10:00:00.000Z', 'Title', 'Initial response');
        const sameContentDifferentMetadata = {
            ...sameContentDifferentSave,
            provider: 'cursor',
            git: { branch: 'feature/test', commit: '1234567890abcdef', dirty: true },
            vscodeVersion: '1.116.0',
            markdownSummary: '# Different summary',
        };
        const changed = createSession('session-a', '2026-05-18T10:00:00.000Z', 'Title', 'Changed response');
        const firstFingerprint = (0, analysisStore_1.createSessionAnalysisFingerprint)(first);
        const sameFingerprint = (0, analysisStore_1.createSessionAnalysisFingerprint)(sameContentDifferentSave);
        const sameMetadataFingerprint = (0, analysisStore_1.createSessionAnalysisFingerprint)(sameContentDifferentMetadata);
        const changedFingerprint = (0, analysisStore_1.createSessionAnalysisFingerprint)(changed);
        assert.equal(firstFingerprint, sameFingerprint);
        assert.equal(firstFingerprint, sameMetadataFingerprint);
        assert.notEqual(firstFingerprint, changedFingerprint);
    });
    test('buildAnalysisPersistenceContract documents the report, index, and fingerprint contract', () => {
        const contract = (0, analysisStore_1.buildAnalysisPersistenceContract)(sessionAnalysis_1.ANALYSIS_PROMPT_VERSION);
        assert.equal(contract.includes(`# Chat Analysis Report`), true);
        assert.equal(contract.includes(`Use report prompt version \`${sessionAnalysis_1.ANALYSIS_PROMPT_VERSION}\``), true);
        assert.equal(contract.includes('"reports": ['), true);
        assert.equal(contract.includes('"analyzedSessions": ['), true);
        assert.equal(contract.includes('"id": "session-example"'), true);
        assert.equal(contract.includes('SHA-256 over the UTF-8 bytes of `JSON.stringify(normalizedSession)`'), true);
        assert.equal(contract.includes('Ignore `savedAt`, `provider`, `git`, `vscodeVersion`, `markdownSummary`, `part`, `totalParts`, `previousPartFile`, and `nextPartFile`'), true);
        assert.equal(contract.includes('A `savedAt` change by itself must not change the fingerprint.'), true);
    });
});
//# sourceMappingURL=analysisStore.test.js.map