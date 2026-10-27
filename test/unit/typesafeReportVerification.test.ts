import * as assert from 'node:assert';

import { buildImplementationHandoffPrompt } from '../../src/sessionAnalysis';
import { createFakeJudgmentService } from '../../src/typesafe/judgmentService';
import {
	DEMOTED_RECOMMENDATIONS_HEADING,
	REPORT_TARGET_KIND_CRITERIA,
	REPORT_VERIFICATION_MARKER,
	REPORT_VERIFICATION_QUESTIONS,
	applyReportVerificationPolicy,
	extractReportRecommendations,
	extractVerifiedRecommendations,
	summarizeReportVerification,
	verifyReportRecommendations,
	type ReportVerificationAnswers,
	type VerifiedReportRecommendation,
} from '../../src/typesafe/reportVerification';

const REPORT = [
	'# Session Analysis',
	'',
	'## 1. Repository-Specific Findings',
	'- The agent re-ran `npm test` five times.',
	'',
	'## 5. Workflow Optimizations',
	'',
	'- Add a validation-order rule to AGENTS.md.',
	'  - Cite the compile-tests step first.',
	'  Continued explanation line.',
	'',
	'1. Add a release checklist to copilot-instructions.md.',
	'',
	'Closing prose that is not a recommendation.',
	'',
	'## 6. Recommended AI Skills to Create',
	'',
	'### SKILL.md',
	'* Create a `vsix-reinstall` skill:',
	'  ```sh',
	'  - not a new item inside the fence',
	'  ```',
	'',
	'**7. Coding Agent Preload Insights**',
	'- Read package.json only for release work.',
	'',
	'## Notes',
	'- Not a recommendation.',
].join('\n');

function verificationAnswers(supported: number, kind: string, confidence = 0.9): ReportVerificationAnswers {
	return {
		supported: { type: 'noul', noul: supported },
		targetKind: { type: 'choice', choice: kind, confidence },
	} as unknown as ReportVerificationAnswers;
}

suite('typesafe report verification', () => {
	test('extracts top-level list items from recommendation sections only', () => {
		const recommendations = extractReportRecommendations(REPORT);
		assert.deepStrictEqual(
			recommendations.map((recommendation) => [recommendation.index, recommendation.section, recommendation.text.split('\n')[0]]),
			[
				[0, 'Workflow Optimizations', 'Add a validation-order rule to AGENTS.md.'],
				[1, 'Workflow Optimizations', 'Add a release checklist to copilot-instructions.md.'],
				[2, 'Recommended AI Skills to Create', 'Create a `vsix-reinstall` skill:'],
				[3, 'Coding Agent Preload Insights', 'Read package.json only for release work.'],
			],
		);
	});

	test('keeps nested bullets, continuation lines, and fenced code inside one recommendation', () => {
		const [first, , skill] = extractReportRecommendations(REPORT);
		assert.strictEqual(
			first?.text,
			'Add a validation-order rule to AGENTS.md.\n- Cite the compile-tests step first.\nContinued explanation line.',
		);
		assert.deepStrictEqual([first?.startLine, first?.endLine], [7, 9]);
		assert.ok(skill?.text.includes('not a new item inside the fence'));
	});

	test('extraction is deterministic and handles CRLF and empty reports', () => {
		assert.deepStrictEqual(extractReportRecommendations(REPORT), extractReportRecommendations(REPORT));
		assert.deepStrictEqual(
			extractReportRecommendations(REPORT.replace(/\n/g, '\r\n')).map((recommendation) => recommendation.text),
			extractReportRecommendations(REPORT).map((recommendation) => recommendation.text),
		);
		assert.deepStrictEqual(extractReportRecommendations(''), []);
		assert.deepStrictEqual(extractReportRecommendations('## Findings\n- nothing to recommend here'), []);
	});

	test('asks supported (Noul) and targetKind (Choice) with the five target kinds', () => {
		assert.strictEqual(REPORT_VERIFICATION_QUESTIONS.supported.type, 'noul');
		assert.strictEqual(REPORT_VERIFICATION_QUESTIONS.targetKind.type, 'choice');
		assert.deepStrictEqual(Object.keys(REPORT_TARGET_KIND_CRITERIA), ['aiControlFile', 'sourceCode', 'docs', 'build', 'other']);
	});

	test('sends one judgment per recommendation with its text and the evidence', async () => {
		const judgment = createFakeJudgmentService({
			handler: async (state) => {
				const text = (state as { recommendation: string }).recommendation;
				return (text.startsWith('Create a') ? verificationAnswers(0.2, 'sourceCode') : verificationAnswers(0.8, 'aiControlFile')) as never;
			},
		});
		const results = await verifyReportRecommendations(REPORT, 'session evidence', { judgment });

		assert.strictEqual(judgment.calls.length, 4);
		for (const call of judgment.calls) {
			assert.strictEqual(call.options, 'reportVerification');
			assert.strictEqual((call.state as { evidence: string }).evidence, 'session evidence');
		}
		assert.deepStrictEqual(
			results.map((result) => [result.recommendation.index, result.supported, result.targetKind?.kind]),
			[
				[0, 0.8, 'aiControlFile'],
				[1, 0.8, 'aiControlFile'],
				[2, 0.2, 'sourceCode'],
				[3, 0.8, 'aiControlFile'],
			],
		);
		assert.strictEqual(results[0]?.targetKind?.confidence, 0.9);
	});

	test('drops malformed answers without failing the other recommendations', async () => {
		let call = 0;
		const judgment = createFakeJudgmentService({
			handler: async () => {
				call += 1;
				if (call === 1) {
					throw new Error('boom');
				}
				return (call === 2 ? verificationAnswers(Number.NaN, 'unknownKind') : verificationAnswers(0.6, 'docs')) as never;
			},
		});
		const logs: string[] = [];
		const results = await verifyReportRecommendations(REPORT, 'evidence', { judgment, log: (message) => logs.push(message) });

		assert.strictEqual(results.length, 4);
		const judged = results.filter((result) => result.supported !== undefined);
		assert.strictEqual(judged.length, 2);
		assert.ok(judged.every((result) => result.targetKind?.kind === 'docs'));
		assert.ok(results.some((result) => result.supported === undefined && result.targetKind === undefined));
		assert.ok(logs.some((message) => message.includes('boom')));
	});

	test('disabled reportVerification sends nothing but still returns the recommendations', async () => {
		const judgment = createFakeJudgmentService({ features: { reportVerification: false }, answers: verificationAnswers(1, 'aiControlFile') });
		const results = await verifyReportRecommendations(REPORT, 'evidence', { judgment });
		assert.strictEqual(judgment.calls.length, 0);
		assert.strictEqual(results.length, 4);
		assert.ok(results.every((result) => result.supported === undefined && result.targetKind === undefined));
	});

	suite('verification policy', () => {
		function judge(...verdicts: (readonly [number, string] | undefined)[]): VerifiedReportRecommendation[] {
			return extractReportRecommendations(REPORT).map((recommendation, index) => {
				const verdict = verdicts[index];
				return verdict
					? { recommendation, supported: verdict[0], targetKind: { kind: verdict[1] as 'aiControlFile', confidence: 0.9 } }
					: { recommendation };
			});
		}

		test('flags unsupported recommendations with a ⚠️ note in place', () => {
			const results = judge([0.9, 'aiControlFile'], [0.1, 'aiControlFile'], [0.9, 'aiControlFile'], [0.9, 'aiControlFile']);
			const report = applyReportVerificationPolicy(REPORT, results);
			const lines = report.split('\n');
			const itemLine = lines.indexOf('1. Add a release checklist to copilot-instructions.md.');
			assert.ok(itemLine > 0);
			assert.match(lines[itemLine + 1] ?? '', /^ {2}> ⚠️ Unsupported: .*\(10% support\)/);
			assert.strictEqual(report.split('⚠️').length - 1, 1, 'supported items carry no note');
			assert.ok(report.trimEnd().endsWith(REPORT_VERIFICATION_MARKER));
		});

		test('demotes recommendations that do not target an AI control file', () => {
			const results = judge([0.9, 'aiControlFile'], [0.9, 'aiControlFile'], [0.9, 'sourceCode'], [0.2, 'docs']);
			const report = applyReportVerificationPolicy(REPORT, results);
			const demotedAt = report.indexOf(`## ${DEMOTED_RECOMMENDATIONS_HEADING}`);
			assert.ok(demotedAt > report.indexOf('## Notes'), 'demoted section follows the original report');
			const [kept, demoted] = [report.slice(0, demotedAt), report.slice(demotedAt)];
			assert.ok(!kept.includes('Create a `vsix-reinstall` skill'));
			assert.ok(!kept.includes('Read package.json only for release work.'));
			assert.ok(demoted.includes('Create a `vsix-reinstall` skill:\n  ```sh'), 'demoted items keep their nested lines');
			assert.match(demoted, /> ⚠️ Demoted: this targets sourceCode rather than an AI control file \(AGENTS\.md rule 13\)/);
			assert.match(demoted, /> ⚠️ Unsupported: .*\n {2}> ⚠️ Demoted: this targets docs/);
			assert.deepStrictEqual(
				extractReportRecommendations(report).map((recommendation) => recommendation.text.split('\n')[0]),
				['Add a validation-order rule to AGENTS.md.', 'Add a release checklist to copilot-instructions.md.'],
				'the demoted section is not itself a recommendation section',
			);
			assert.deepStrictEqual(summarizeReportVerification(results), { total: 4, verified: 2, unsupported: 1, demoted: 2 });
		});

		test('leaves the report unchanged when nothing was judged', () => {
			assert.strictEqual(applyReportVerificationPolicy(REPORT, judge()), REPORT);
			assert.strictEqual(extractVerifiedRecommendations(REPORT), undefined);
		});

		test('verified recommendations exclude flagged, unjudged, and demoted items', () => {
			const results = judge([0.9, 'aiControlFile'], [0.1, 'aiControlFile'], [0.9, 'build'], undefined);
			const report = applyReportVerificationPolicy(REPORT, results);
			assert.match(report, /> ⚠️ Not verified: no verification judgment/);
			const verified = extractVerifiedRecommendations(report);
			assert.deepStrictEqual(verified?.map((text) => text.split('\n')[0]), ['Add a validation-order rule to AGENTS.md.']);
			assert.deepStrictEqual(extractVerifiedRecommendations(applyReportVerificationPolicy(report.replace(/\r?\n/g, '\r\n'), [])), verified);
		});

		test('/implement handoff lists only verified recommendations', () => {
			const report = applyReportVerificationPolicy(
				REPORT,
				judge([0.9, 'aiControlFile'], [0.1, 'aiControlFile'], [0.9, 'sourceCode'], [0.8, 'aiControlFile']),
			);
			const prompt = buildImplementationHandoffPrompt('/r/report.md', '', report);
			assert.match(prompt, /Implement only these verified recommendations/);
			assert.match(prompt, /\n1\. Add a validation-order rule to AGENTS\.md\. - Cite the compile-tests step first\. Continued explanation line\.\n/);
			assert.match(prompt, /\n2\. Read package\.json only for release work\.\n/);
			assert.ok(!prompt.includes('release checklist'));
			assert.ok(!prompt.includes('vsix-reinstall'));
			assert.ok(prompt.trimEnd().endsWith('User request: Implement the highest-priority recommendations from the saved analysis report.'));
		});

		test('/implement handoff stops when nothing was verified and is unchanged for unverified reports', () => {
			const report = applyReportVerificationPolicy(REPORT, judge([0.1, 'aiControlFile'], [0.9, 'docs'], [0.9, 'other'], [0.2, 'build']));
			assert.match(buildImplementationHandoffPrompt('/r/report.md', '', report), /Do not implement any recommendation from this report/);
			assert.strictEqual(
				buildImplementationHandoffPrompt('/r/report.md', 'go', REPORT),
				buildImplementationHandoffPrompt('/r/report.md', 'go'),
			);
		});
	});
});
