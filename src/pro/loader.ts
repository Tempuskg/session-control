import { createRequire } from 'node:module';
import * as vscode from 'vscode';
import {
	createVSCodeHandoffDispatcher,
	type HandoffDispatcher,
} from '../handoffDispatcher';
import {
	isProFeatureRegistrarModule,
	SHARED_HANDOFF_CAPABILITY_VERSION,
	type ProFeatureRegistrar,
	type ProFeatureRegistrationContext,
	type ProFeatureRegistrationResult,
	type SharedHandoffCapabilityV1,
} from './contracts';

export const DEFAULT_PRO_PACKAGE_NAME = '@tempuskg/session-control-pro';

interface LoadProFeatureRegistrarDeps {
	moduleSpecifier: string;
	resolveModule: (specifier: string) => string;
	requireModule: (resolvedPath: string) => unknown;
}

interface ActivateProFeaturesDeps extends LoadProFeatureRegistrarDeps {
	createHandoffDispatcher: () => Pick<HandoffDispatcher, 'dispatchSelection'>;
}

interface AvailableProFeatureLoadResult {
	kind: 'available';
	moduleSpecifier: string;
	resolvedPath: string;
	registrar: ProFeatureRegistrar;
}

interface UnavailableProFeatureLoadResult {
	kind: 'unavailable';
	reason: 'not-found' | 'invalid-module' | 'load-failed' | 'register-failed';
	moduleSpecifier: string;
	detail: string;
}

export type ProFeatureLoadResult = AvailableProFeatureLoadResult | UnavailableProFeatureLoadResult;

const nodeRequire = createRequire(__filename);

function isNodeErrorWithCode(error: unknown, code: string): boolean {
	return error instanceof Error
		&& 'code' in error
		&& (error as { code?: unknown }).code === code;
}

function unwrapRegistrarModule(value: unknown): unknown {
	if (isProFeatureRegistrarModule(value)) {
		return value;
	}

	if (typeof value === 'object' && value !== null && 'default' in value) {
		return (value as { default: unknown }).default;
	}

	return value;
}

function normalizeRegistrationResult(
	result: Awaited<ProFeatureRegistrationResult>,
): readonly vscode.Disposable[] {
	if (result === undefined) {
		return [];
	}

	if (Array.isArray(result)) {
		return result;
	}

	return [result as vscode.Disposable];
}

function createSharedHandoffCapability(
	dispatcher: Pick<HandoffDispatcher, 'dispatchSelection'>,
): SharedHandoffCapabilityV1 {
	return {
		version: SHARED_HANDOFF_CAPABILITY_VERSION,
		dispatch: async (prompt, selectedTarget, options) =>
			dispatcher.dispatchSelection(prompt, selectedTarget, options),
	};
}

export function loadProFeatureRegistrar(
	deps: Partial<LoadProFeatureRegistrarDeps> = {},
): ProFeatureLoadResult {
	const moduleSpecifier = deps.moduleSpecifier ?? DEFAULT_PRO_PACKAGE_NAME;
	const resolveModule = deps.resolveModule ?? ((specifier: string) => nodeRequire.resolve(specifier));
	const requireModule = deps.requireModule ?? ((resolvedPath: string) => nodeRequire(resolvedPath));

	let resolvedPath: string;
	try {
		// Resolve first so "package absent" can be distinguished from a broken
		// dependency inside the private package itself.
		resolvedPath = resolveModule(moduleSpecifier);
	} catch (error) {
		if (isNodeErrorWithCode(error, 'MODULE_NOT_FOUND')) {
			return {
				kind: 'unavailable',
				reason: 'not-found',
				moduleSpecifier,
				detail: `Optional Pro package '${moduleSpecifier}' is not installed; continuing with free features only.`,
			};
		}

		const message = error instanceof Error ? error.message : String(error);
		return {
			kind: 'unavailable',
			reason: 'load-failed',
			moduleSpecifier,
			detail: `Failed to resolve Pro package '${moduleSpecifier}': ${message}`,
		};
	}

	try {
		const loadedModule = unwrapRegistrarModule(requireModule(resolvedPath));
		if (!isProFeatureRegistrarModule(loadedModule)) {
			return {
				kind: 'unavailable',
				reason: 'invalid-module',
				moduleSpecifier,
				detail: `Pro package '${moduleSpecifier}' does not export a registerProFeatures() function.`,
			};
		}

		return {
			kind: 'available',
			moduleSpecifier,
			resolvedPath,
			registrar: loadedModule.registerProFeatures,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			kind: 'unavailable',
			reason: 'load-failed',
			moduleSpecifier,
			detail: `Failed to load Pro package '${moduleSpecifier}': ${message}`,
		};
	}
}

export async function activateProFeatures(
	context: ProFeatureRegistrationContext,
	deps: Partial<ActivateProFeaturesDeps> = {},
): Promise<ProFeatureLoadResult> {
	const loadResult = loadProFeatureRegistrar(deps);
	if (loadResult.kind !== 'available') {
		context.log(loadResult.detail);
		return loadResult;
	}

	try {
		const dispatcher = (deps.createHandoffDispatcher ?? createVSCodeHandoffDispatcher)();
		const registrationContext: ProFeatureRegistrationContext = {
			...context,
			capabilities: {
				...context.capabilities,
				sharedHandoff: createSharedHandoffCapability(dispatcher),
			},
		};
		const registrations = normalizeRegistrationResult(
			await loadResult.registrar(registrationContext),
		);
		for (const disposable of registrations) {
			context.registerDisposable(disposable);
		}

		context.log(`Loaded Pro features from '${loadResult.moduleSpecifier}'.`);
		return loadResult;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const failedResult: UnavailableProFeatureLoadResult = {
			kind: 'unavailable',
			reason: 'register-failed',
			moduleSpecifier: loadResult.moduleSpecifier,
			detail: `Failed to register Pro features from '${loadResult.moduleSpecifier}': ${message}`,
		};
		context.log(failedResult.detail);
		return failedResult;
	}
}
