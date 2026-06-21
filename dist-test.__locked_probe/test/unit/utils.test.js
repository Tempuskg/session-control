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
const utils_1 = require("../../src/utils");
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
suite('utils', () => {
    test('slugify handles punctuation, accents, empty values, and max length', () => {
        assert.equal((0, utils_1.slugify)('Fix Auth Bug!'), 'fix-auth-bug');
        assert.equal((0, utils_1.slugify)('Café résumé'), 'cafe-resume');
        assert.equal((0, utils_1.slugify)('###'), 'session');
        assert.equal((0, utils_1.slugify)('a'.repeat(120)).length <= 80, true);
    });
    test('formatTimestamp uses UTC YYYY-MM-DDTHH-mm', () => {
        const value = new Date('2026-04-12T14:30:55.000Z');
        assert.equal((0, utils_1.formatTimestamp)(value), '2026-04-12T14-30');
    });
    test('parseFileSize supports kb and mb and rejects invalid values', () => {
        assert.equal((0, utils_1.parseFileSize)('500kb'), 500 * 1024);
        assert.equal((0, utils_1.parseFileSize)('1mb'), 1024 * 1024);
        assert.equal((0, utils_1.parseFileSize)('2MB'), 2 * 1024 * 1024);
        assert.throws(() => (0, utils_1.parseFileSize)('42gb'));
        assert.throws(() => (0, utils_1.parseFileSize)('0mb'));
    });
    test('fuzzyMatchSessions applies expected scoring tiers', () => {
        const sessions = [
            createSession('fix-auth-bug', 'fix-auth-bug.json', '2026-04-12T10:00:00.000Z'),
            createSession('feature-xyz', 'feature-xyz.json', '2026-04-10T10:00:00.000Z'),
        ];
        const exact = (0, utils_1.fuzzyMatchSessions)('fix-auth-bug', sessions);
        const prefix = (0, utils_1.fuzzyMatchSessions)('fix', sessions);
        const substring = (0, utils_1.fuzzyMatchSessions)('auth', sessions);
        const wordBoundary = (0, utils_1.fuzzyMatchSessions)('fix bug', sessions);
        const fuzzy = (0, utils_1.fuzzyMatchSessions)('fab', sessions);
        assert.ok(exact[0]);
        assert.ok(prefix[0]);
        assert.ok(substring[0]);
        assert.ok(wordBoundary[0]);
        assert.ok(fuzzy[0]);
        assert.equal(exact[0].score, 100);
        assert.equal(prefix[0].score, 80);
        assert.equal(substring[0].score, 60);
        assert.equal(wordBoundary[0].score, 40);
        assert.equal(fuzzy[0].score, 20);
        assert.equal((0, utils_1.fuzzyMatchSessions)('deploy', sessions).length, 0);
    });
    test('fuzzyMatchSessions sorts equal scores by recency', () => {
        const sessions = [
            createSession('fix-auth-a', 'fix-auth-a.json', '2026-04-11T10:00:00.000Z'),
            createSession('fix-auth-b', 'fix-auth-b.json', '2026-04-12T10:00:00.000Z'),
        ];
        const result = (0, utils_1.fuzzyMatchSessions)('fix', sessions);
        assert.ok(result[0]);
        assert.ok(result[1]);
        assert.equal(result[0].title, 'fix-auth-b');
        assert.equal(result[1].title, 'fix-auth-a');
    });
});
//# sourceMappingURL=utils.test.js.map