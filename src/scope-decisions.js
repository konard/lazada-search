import { sha256 } from './util.js';
import { sanitizePublicData } from './archive.js';

export const SCOPE_POLICY_VERSION = 3;

function decisionsFor(audit, scope) {
  return [
    ...(audit.excludedCategoryListings || []).map((entry) => ({
      id: `scope:${scope}:listing:${entry.listingKey}`,
      kind: 'listing',
      listingKey: entry.listingKey,
      decision: 'excluded',
      titles: entry.titles,
      reasons: entry.reasons,
      sourceUrls: entry.sourceUrls || [],
      sourceRecordIds: entry.sourceRecordIds || [],
    })),
    ...(audit.excludedFlavourTasks || []).map((entry) => ({
      id: `scope:${scope}:sku:${entry.sku}:${entry.url}`,
      kind: 'sku',
      listingUrl: entry.listingUrl,
      url: entry.url,
      sku: entry.sku,
      decision: 'excluded',
      options: entry.options,
      reasons: [entry.reason],
      extractedFlavour: entry.extractedFlavour,
    })),
  ];
}

async function saveDecision(store, input) {
  const evidenceFingerprint = sha256(JSON.stringify(input));
  const previous = await store.get('scope-decision', input.id);
  if (previous?.evidenceFingerprint === evidenceFingerprint) {
    return { record: previous, reused: true };
  }
  if (previous) {
    await store.put('scope-decision-history', {
      ...previous,
      id: `${previous.id}:${previous.evidenceFingerprint}`,
      decisionId: previous.id,
    });
  }
  return {
    record: await store.put('scope-decision', {
      ...input,
      evidenceFingerprint,
      evaluatedAt: new Date().toISOString(),
    }),
    reused: false,
  };
}

// Search discoveries retain all original observations. These materialized
// decisions retain why a listing/SKU was skipped. Only fresh audit evidence can
// keep an exclusion active; changed evidence/rules revoke it automatically.
export async function persistScopeDecisions(
  store,
  audit,
  { flavourScope = 'chocolate-or-unflavoured' } = {}
) {
  const inputs = decisionsFor(audit, flavourScope).map((entry) => ({
    ...entry,
    flavourScope,
    policyVersion: SCOPE_POLICY_VERSION,
  }));
  const currentIds = new Set(inputs.map((entry) => entry.id));
  const results = [];
  for (const input of inputs) {
    results.push(await saveDecision(store, input));
  }
  for (const previous of await store.list('scope-decision')) {
    if (
      previous.flavourScope === flavourScope &&
      previous.decision === 'excluded' &&
      !currentIds.has(previous.id)
    ) {
      results.push(
        await saveDecision(store, {
          ...Object.fromEntries(
            Object.entries(previous).filter(
              ([key]) =>
                !['evidenceFingerprint', 'evaluatedAt', 'visibility'].includes(
                  key
                )
            )
          ),
          decision: 'needs-review',
          policyVersion: SCOPE_POLICY_VERSION,
          reasons: ['Current audit no longer confirms the prior exclusion'],
        })
      );
    }
  }
  return {
    decisions: results.map((result) => result.record),
    reused: results.filter((result) => result.reused).length,
    excluded: inputs.length,
  };
}

export async function publishScopeDecisions(publicStore, accountStore) {
  const results = [];
  for (const record of await accountStore.list('scope-decision')) {
    if (record.visibility !== 'private') {
      continue;
    }
    const safe = sanitizePublicData(record);
    delete safe.visibility;
    delete safe.evidenceFingerprint;
    delete safe.evaluatedAt;
    results.push(await saveDecision(publicStore, safe));
  }
  return {
    published: results.length,
    reused: results.filter((result) => result.reused).length,
  };
}
