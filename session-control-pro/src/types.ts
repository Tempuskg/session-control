export interface Disposable {
	dispose(): void;
}

export interface ProFeatureRegistrationContext {
	hasProLicense: () => Promise<boolean>;
	showUpgradePrompt: () => Promise<void>;
	log: (message: string) => void;
	registerDisposable: (disposable: Disposable) => void;
}

export type ProFeatureRegistrationResult =
	| Disposable
	| readonly Disposable[]
	| undefined
	| Promise<Disposable | readonly Disposable[] | undefined>;

export type ProFeatureRegistrar = (
	context: ProFeatureRegistrationContext,
) => ProFeatureRegistrationResult;
