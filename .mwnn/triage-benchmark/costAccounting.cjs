'use strict';

/**
 * Auditable provider-cost accounting for the workspace-local triage benchmark.
 * Distinguishes tokenizer counts, provider-reported usage, actual billed amounts,
 * and estimates. Missing values are explicit unavailable objects — never zero.
 */

const UNAVAILABLE = (reason) => ({
  status: 'unavailable',
  value: null,
  reason,
});

const measured = (value, meta = {}) => ({
  status: 'measured',
  value,
  ...meta,
});

const estimate = (value, meta = {}) => ({
  status: 'estimate',
  value,
  ...meta,
});

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function costFromTokens(tokens, ratePerMillion) {
  assertFiniteNumber(tokens, 'tokens');
  assertFiniteNumber(ratePerMillion, 'ratePerMillion');
  return (tokens / 1_000_000) * ratePerMillion;
}

function findRate(rates, { provider, modelId, component, asOf }) {
  const day = asOf || '9999-12-31';
  return rates.find((rate) => {
    if (rate.provider !== provider || rate.component !== component) return false;
    if (modelId && Array.isArray(rate.modelIds) && !rate.modelIds.includes(modelId)) return false;
    if (rate.effectiveFrom && rate.effectiveFrom > day) return false;
    if (rate.effectiveTo && rate.effectiveTo < day) return false;
    return true;
  }) || null;
}

function splitArmCalls(arm) {
  const batches = arm.calls.filter((call) => call.kind !== 'synthesis');
  const synthesis = arm.calls.filter((call) => call.kind === 'synthesis');
  const sum = (calls, field) => calls.reduce((total, call) => total + call[field], 0);
  return {
    analysisBatches: {
      inputTokens: sum(batches, 'inputTokens'),
      outputTokens: sum(batches, 'outputTokens'),
      callCount: batches.length,
    },
    synthesis: {
      inputTokens: sum(synthesis, 'inputTokens'),
      outputTokens: sum(synthesis, 'outputTokens'),
      callCount: synthesis.length,
    },
  };
}

function classifyArmUsage(arm, analysis) {
  const split = splitArmCalls(arm);
  return {
    provider: {
      name: analysis.model?.vendor ?? null,
      modelId: analysis.model?.id ?? null,
      modelName: analysis.model?.name ?? null,
      providerVersion: analysis.model?.version ?? null,
    },
    tokenizerCounts: {
      usageSource: 'vscode.LanguageModelChat.countTokens',
      classification: 'tokenizerCount',
      analysisBatches: measured(split.analysisBatches, {
        unit: 'tokens',
        note: 'VS Code tokenizer counts on explicit user messages and returned text.',
      }),
      synthesis: measured(split.synthesis, {
        unit: 'tokens',
        note: 'VS Code tokenizer counts on the synthesis prompt and returned text.',
      }),
      armTotal: measured({
        inputTokens: arm.inputTokens,
        outputTokens: arm.outputTokens,
      }, {
        unit: 'tokens',
        note: analysis.tokenMeasurement,
      }),
    },
    providerReportedUsage: analysis.providerBilledUsage == null
      ? UNAVAILABLE('VS Code LanguageModelChatResponse exposes text/stream only; no provider usage object is returned to extensions.')
      : measured(analysis.providerBilledUsage, {
        usageSource: 'analysis.providerBilledUsage',
        classification: 'providerReported',
      }),
    actualBilledAmount: UNAVAILABLE('No provider invoice, statement line, or account billed amount was attached to this run. Do not treat tokenizer counts as charges.'),
    cacheUsage: UNAVAILABLE('VS Code does not expose provider cache-read or cache-write token counts for LanguageModelChat requests.'),
    retryOrFailedCharges: UNAVAILABLE('The editor helper records completed calls only; retry and failed-call billed usage is not exposed by the VS Code LM API.'),
  };
}

function classifyTypeSafeUsage(triage) {
  const successRecords = triage.records.filter((record) => record.state === 'success');
  const errorRecords = triage.records.filter((record) => record.state === 'error');
  const models = [...new Set(successRecords.map((record) => record.model).filter(Boolean))];
  const usagePresent = triage.usage
    && typeof triage.usage.input_tokens === 'number'
    && typeof triage.usage.output_tokens === 'number';

  return {
    provider: {
      name: 'typesafe',
      modelIds: models,
      requestedModel: triage.requestedModel ?? null,
      cacheTreatment: triage.cache ?? null,
    },
    tokenizerCounts: UNAVAILABLE('TypeSafe System One responses are not measured with VS Code countTokens in this benchmark.'),
    providerReportedUsage: usagePresent
      ? measured({
        inputTokens: triage.usage.input_tokens,
        outputTokens: triage.usage.output_tokens,
        successfulCalls: successRecords.length,
        failedCalls: errorRecords.length,
      }, {
        usageSource: 'typesafe.systemOne.response.usage',
        classification: 'providerReported',
        unit: 'tokens',
        note: 'Provider-reported usage summed from successful records. Failed calls contribute neither tokens nor a verified billed amount.',
      })
      : UNAVAILABLE('TypeSafe provider usage is missing from the triage artifact.'),
    actualBilledAmount: UNAVAILABLE('TypeSafe console invoice/statement for this run was not supplied. Rate × provider-reported usage is an estimate until account evidence confirms the charge.'),
    cacheUsage: measured({
      treatment: triage.cache || 'unspecified',
      billedCacheTokens: null,
    }, {
      usageSource: 'triage.cache',
      classification: 'providerReported',
      note: 'Run recorded cold; no persisted judgment reads. No separate cache token field is present on TypeSafe usage.',
    }),
    retryOrFailedCharges: measured({
      configuredMaxRetries: 0,
      failedCalls: errorRecords.length,
      attributableRetryCharges: null,
      note: errorRecords.length === 0
        ? 'Runner configured maxRetries: 0; no failed calls in the complete run.'
        : 'Failed calls were recorded without billed amounts; attributable retry charges remain unavailable.',
    }, {
      usageSource: 'run.cjs TypeSafeClient retry config + triage.records[].state',
      classification: 'providerReported',
    }),
  };
}

function estimateComponentCost({ inputTokens, outputTokens }, rates, meta) {
  const inputRate = findRate(rates, {
    provider: meta.provider,
    modelId: meta.modelId,
    component: 'input',
    asOf: meta.asOf,
  });
  const outputRate = findRate(rates, {
    provider: meta.provider,
    modelId: meta.modelId,
    component: 'output',
    asOf: meta.asOf,
  });
  if (!inputRate || !outputRate) {
    return UNAVAILABLE(`No recorded ${meta.provider} rates for model ${meta.modelId} covering input and output.`);
  }
  const amount = costFromTokens(inputTokens, inputRate.amount) + costFromTokens(outputTokens, outputRate.amount);
  return estimate(amount, {
    currency: meta.currency || 'USD',
    usageSource: meta.usageSource,
    classification: 'estimate',
    ratesUsed: [inputRate.id, outputRate.id],
    rateSources: [inputRate.authoritativeSource, outputRate.authoritativeSource],
    formula: '(inputTokens/1e6)*inputRate + (outputTokens/1e6)*outputRate',
    note: meta.note,
  });
}

function buildArmCostComponents(armUsage, rates, asOf, currency) {
  const tokenizer = armUsage.tokenizerCounts;
  const modelId = armUsage.provider.modelId;
  const provider = armUsage.provider.name;
  const analysis = estimateComponentCost(tokenizer.analysisBatches.value, rates, {
    provider,
    modelId,
    asOf,
    currency,
    usageSource: 'tokenizerCounts.analysisBatches',
    note: 'Estimate only: applies list rates to VS Code tokenizer counts, which are not provider-billed usage.',
  });
  const synthesis = estimateComponentCost(tokenizer.synthesis.value, rates, {
    provider,
    modelId,
    asOf,
    currency,
    usageSource: 'tokenizerCounts.synthesis',
    note: 'Estimate only: applies list rates to VS Code tokenizer counts for the synthesis call.',
  });
  return {
    analysisBatches: analysis,
    synthesis,
    cache: armUsage.cacheUsage.status === 'unavailable'
      ? UNAVAILABLE(armUsage.cacheUsage.reason)
      : armUsage.cacheUsage,
    retriesOrFailedCalls: armUsage.retryOrFailedCharges.status === 'unavailable'
      ? UNAVAILABLE(armUsage.retryOrFailedCharges.reason)
      : armUsage.retryOrFailedCharges,
    actualBilledAmount: armUsage.actualBilledAmount,
  };
}

function buildTypeSafeCost(typeSafeUsage, rates, asOf, currency) {
  if (typeSafeUsage.providerReportedUsage.status !== 'measured') {
    return {
      typesafe: typeSafeUsage.providerReportedUsage,
      cache: typeSafeUsage.cacheUsage,
      retriesOrFailedCalls: typeSafeUsage.retryOrFailedCharges,
      actualBilledAmount: typeSafeUsage.actualBilledAmount,
    };
  }
  const modelId = typeSafeUsage.provider.modelIds[0] || typeSafeUsage.provider.requestedModel;
  const usage = typeSafeUsage.providerReportedUsage.value;
  const typesafe = estimateComponentCost({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  }, rates, {
    provider: 'typesafe',
    modelId,
    asOf,
    currency,
    usageSource: 'typesafe.systemOne.response.usage',
    note: 'Estimate from provider-reported usage × recorded TypeSafe list rates. Not an invoice-confirmed billed amount.',
  });
  return {
    typesafe,
    cache: typeSafeUsage.cacheUsage.status === 'measured'
      && typeSafeUsage.cacheUsage.value.billedCacheTokens == null
      ? UNAVAILABLE('TypeSafe run recorded cold cache treatment, but no billed cache token field exists to price.')
      : typeSafeUsage.cacheUsage,
    retriesOrFailedCalls: typeSafeUsage.retryOrFailedCharges.value?.attributableRetryCharges == null
      ? UNAVAILABLE(typeSafeUsage.retryOrFailedCharges.value?.note
        || 'Attributable retry/failed-call charges are unavailable.')
      : typeSafeUsage.retryOrFailedCharges,
    actualBilledAmount: typeSafeUsage.actualBilledAmount,
  };
}

function sumAvailableEstimates(parts) {
  const amounts = [];
  const missing = [];
  for (const [name, part] of Object.entries(parts)) {
    if (!part || typeof part !== 'object') continue;
    if (part.status === 'estimate' && typeof part.value === 'number') {
      amounts.push({ name, value: part.value });
    } else if (part.status === 'unavailable') {
      missing.push({ name, reason: part.reason });
    } else if (part.status === 'measured' && part.value === null) {
      missing.push({ name, reason: part.reason || 'measured null' });
    }
  }
  if (missing.length) {
    return {
      total: UNAVAILABLE(`Cannot form a verified attributable total while unavailable: ${missing.map((item) => item.name).join(', ')}.`),
      partialEstimateSum: amounts.length
        ? estimate(amounts.reduce((sum, item) => sum + item.value, 0), {
          currency: 'USD',
          classification: 'estimate',
          included: amounts.map((item) => item.name),
          excludedUnavailable: missing,
          note: 'Partial sum of available estimates only. Not a verified savings figure.',
        })
        : UNAVAILABLE('No priced estimate components are available.'),
      missing,
    };
  }
  return {
    total: estimate(amounts.reduce((sum, item) => sum + item.value, 0), {
      currency: 'USD',
      classification: 'estimate',
      included: amounts.map((item) => item.name),
      note: 'All listed components had estimates; still not invoice-verified.',
    }),
    partialEstimateSum: null,
    missing: [],
  };
}

function evidenceInventory(analysis, triage) {
  return {
    obtainableWithoutCredentials: [
      {
        artifact: 'analysis tokenizer counts',
        source: 'vscode.LanguageModelChat.countTokens via editor helper',
        present: true,
      },
      {
        artifact: 'analysis model identity',
        source: 'vscode.lm.selectChatModels match fields',
        present: Boolean(analysis.model?.id),
      },
      {
        artifact: 'TypeSafe provider-reported usage',
        source: 'systemOne response.usage on successful records',
        present: Boolean(triage.usage),
      },
      {
        artifact: 'TypeSafe returned model ids',
        source: 'systemOne response.model',
        present: triage.records.some((record) => record.model),
      },
      {
        artifact: 'TypeSafe cache treatment note',
        source: 'triage.cache field',
        present: Boolean(triage.cache),
      },
      {
        artifact: 'TypeSafe retry configuration',
        source: 'run.cjs TypeSafeClient({ retry: { maxRetries: 0 } })',
        present: true,
      },
      {
        artifact: 'published list rates with source URLs',
        source: 'cost-rates.json',
        present: true,
      },
    ],
    unavailableFromSupportedApis: [
      {
        artifact: 'VS Code / OpenRouter provider-reported analysis usage',
        reason: 'LanguageModelChatResponse has text/stream only; no usage or billing fields in @types/vscode LanguageModelChat API.',
      },
      {
        artifact: 'actual billed analysis amount',
        reason: 'No extension API exposes invoice or statement charges for LanguageModelChat calls.',
      },
      {
        artifact: 'analysis cache-read/write token counts',
        reason: 'Not exposed by VS Code LM API for this path.',
      },
      {
        artifact: 'analysis retry/failed-call billed usage',
        reason: 'Not exposed by VS Code LM API; helper does not invent failed-call charges.',
      },
    ],
    externalEvidenceStillRequired: [
      {
        artifact: 'OpenRouter or Copilot/OpenAI account statement covering analysis-1793062329161.json wall-clock window',
        purpose: 'Confirm actual billed analysis (+ synthesis) charges, cache adjustments, and any retries.',
        humanWorkflow: 'Export or screenshot the provider usage/billing page for 2026-10-27T00:52:09Z–2026-10-27T01:00:07Z without sharing credentials or unrelated customer records.',
        blocksVerifiedSavingsClaim: true,
      },
      {
        artifact: 'TypeSafe console usage/billing export for triage-1793062000319.json',
        purpose: 'Confirm that provider-reported input tokens × list rate matched the account charge for this run.',
        humanWorkflow: 'Export the TypeSafe organization Usage/Billing view for 2026-10-27T00:46:40Z–2026-10-27T00:46:41Z, redacting account identity if needed.',
        blocksVerifiedSavingsClaim: true,
      },
    ],
    vscodeUsageInvestigation: {
      inspectedApi: 'vscode.LanguageModelChat / LanguageModelChatResponse in @types/vscode',
      supportedEvidence: [
        'model identity (name, id, vendor, version, maxInputTokens)',
        'countTokens on request messages and returned text',
        'returned text stream',
        'request wall time measured locally',
      ],
      notExposed: [
        'provider billed token usage',
        'cache hit/write counts',
        'hidden reasoning tokens',
        'invoice line amounts',
        'retry surcharge fields',
      ],
      conclusion: 'Tokenizer counts may be recorded as tokenizerCount evidence. They must not be substituted as actualBilled amounts.',
    },
  };
}

/**
 * @param {{ analysis: object, triage: object, ratesDoc: object, asOf?: string }} input
 */
function buildCostAccounting(input) {
  const { analysis, triage, ratesDoc } = input;
  const currency = ratesDoc.currency || 'USD';
  const asOf = input.asOf || ratesDoc.recordedAt || analysis.startedAt?.slice(0, 10);
  const rates = ratesDoc.rates || [];

  const beforeArm = analysis.arms.find((arm) => arm.name === 'baseline');
  const afterArm = analysis.arms.find((arm) => arm.name === 'triageEnabled');
  if (!beforeArm || !afterArm) throw new Error('Expected baseline and triageEnabled arms.');

  const beforeUsage = classifyArmUsage(beforeArm, analysis);
  const afterUsage = classifyArmUsage(afterArm, analysis);
  const typeSafeUsage = classifyTypeSafeUsage(triage);

  const beforeComponents = buildArmCostComponents(beforeUsage, rates, asOf, currency);
  const afterAnalysisComponents = buildArmCostComponents(afterUsage, rates, asOf, currency);
  const typeSafeCost = buildTypeSafeCost(typeSafeUsage, rates, asOf, currency);

  const beforeCostParts = {
    analysisBatches: beforeComponents.analysisBatches,
    synthesis: beforeComponents.synthesis,
    typesafe: measured(0, {
      currency,
      classification: 'actualBilled',
      usageSource: 'baseline arm; TypeSafe disabled',
      note: 'No TypeSafe requests were issued on the baseline arm.',
    }),
    cache: beforeComponents.cache,
    retriesOrFailedCalls: beforeComponents.retriesOrFailedCalls,
  };
  const afterCostParts = {
    analysisBatches: afterAnalysisComponents.analysisBatches,
    synthesis: afterAnalysisComponents.synthesis,
    typesafe: typeSafeCost.typesafe,
    cache: UNAVAILABLE(
      `Attributable cache charges require provider cache usage. Analysis: ${afterAnalysisComponents.cache.reason} TypeSafe: ${typeSafeCost.cache.reason}`,
    ),
    retriesOrFailedCalls: UNAVAILABLE(
      `Attributable retry/failed-call charges require billed retry evidence. Analysis: ${afterAnalysisComponents.retriesOrFailedCalls.reason} TypeSafe: ${typeSafeCost.retriesOrFailedCalls.reason}`,
    ),
  };

  const beforeTotals = sumAvailableEstimates({
    analysisBatches: beforeCostParts.analysisBatches,
    synthesis: beforeCostParts.synthesis,
    // Measured baseline TypeSafe $0 participates in partial estimates without pretending unverified analysis costs are billed.
    typesafe: estimate(0, {
      currency,
      classification: 'estimate',
      usageSource: beforeCostParts.typesafe.usageSource,
      note: beforeCostParts.typesafe.note,
    }),
    cache: beforeCostParts.cache,
    retriesOrFailedCalls: beforeCostParts.retriesOrFailedCalls,
  });
  const afterTotals = sumAvailableEstimates(afterCostParts);

  const missingBlocksVerification = [
    ...beforeTotals.missing.map((item) => `before.${item.name}`),
    ...afterTotals.missing.map((item) => `after.${item.name}`),
    beforeUsage.actualBilledAmount.status === 'unavailable' ? 'before.actualBilledAmount' : null,
    afterUsage.actualBilledAmount.status === 'unavailable' ? 'after.actualBilledAmount' : null,
    typeSafeUsage.actualBilledAmount.status === 'unavailable' ? 'typesafe.actualBilledAmount' : null,
  ].filter(Boolean);

  const verifiedSavingsClaim = {
    established: false,
    reason: missingBlocksVerification.length
      ? `Unavailable cost components prevent a verified savings claim: ${missingBlocksVerification.join(', ')}.`
      : 'All components present, but actual billed amounts are still required for verification.',
  };

  return {
    schemaVersion: 1,
    currency,
    ratesAsOf: asOf,
    ratesCatalog: {
      path: 'cost-rates.json',
      recordedAt: ratesDoc.recordedAt,
      rateIds: rates.map((rate) => rate.id),
    },
    usageClasses: {
      before: beforeUsage,
      after: afterUsage,
      typesafe: typeSafeUsage,
    },
    costComponents: {
      before: beforeCostParts,
      after: afterCostParts,
    },
    totals: {
      before: beforeTotals,
      after: afterTotals,
    },
    verifiedSavingsClaim,
    financialSavingsEstablished: false,
    evidenceInventory: evidenceInventory(analysis, triage),
  };
}

function reconcileTokenArithmetic(analysis, triage) {
  const before = analysis.arms.find((arm) => arm.name === 'baseline');
  const after = analysis.arms.find((arm) => arm.name === 'triageEnabled');
  const beforeTotal = before.inputTokens + before.outputTokens;
  const afterTotal = after.inputTokens + after.outputTokens;
  const triageTokens = triage.usage.input_tokens + triage.usage.output_tokens;
  return {
    beforeVisibleTokens: beforeTotal,
    afterVisibleTokens: afterTotal,
    triageProviderTokens: triageTokens,
    arithmeticCombinedAfter: afterTotal + triageTokens,
    beforeCallSumMatchesArm: before.inputTokens === before.calls.reduce((sum, call) => sum + call.inputTokens, 0)
      && before.outputTokens === before.calls.reduce((sum, call) => sum + call.outputTokens, 0),
    afterCallSumMatchesArm: after.inputTokens === after.calls.reduce((sum, call) => sum + call.inputTokens, 0)
      && after.outputTokens === after.calls.reduce((sum, call) => sum + call.outputTokens, 0),
    triageUsageSumMatchesRecords: triage.usage.input_tokens === triage.records.reduce((sum, record) => sum + (record.usage?.input_tokens || 0), 0)
      && triage.usage.output_tokens === triage.records.reduce((sum, record) => sum + (record.usage?.output_tokens || 0), 0),
  };
}

module.exports = {
  UNAVAILABLE,
  measured,
  estimate,
  costFromTokens,
  findRate,
  splitArmCalls,
  classifyArmUsage,
  classifyTypeSafeUsage,
  buildCostAccounting,
  reconcileTokenArithmetic,
};
