import { sha256 } from '../src/util.js';

function backlogFingerprint(audit) {
  if (audit.collectableUrls) {
    return sha256(JSON.stringify([...audit.collectableUrls].sort()));
  }
  return sha256(
    JSON.stringify(
      [
        ...audit.missingListings,
        ...audit.missingSkuPrices.map(
          (entry) => `${entry.listingUrl}:${entry.sku}`
        ),
        ...audit.missingPrices.map((entry) => entry.url),
        ...(audit.unknownSkuInventories || []),
      ].sort()
    )
  );
}

function pending(audit) {
  if (audit.collectableUrls) {
    return audit.collectableUrls.length;
  }
  return (
    audit.missingListings.length +
    audit.missingSkuPrices.length +
    audit.missingPrices.length +
    (audit.unknownSkuInventories?.length || 0)
  );
}

async function ensureDiscovery({ reuseDiscovery, audit, discover }) {
  const existing = reuseDiscovery ? await audit() : undefined;
  if (!existing?.discoveryComplete || existing.failures.length) {
    await discover();
  }
}

const canRecollect = (state) =>
  !state.deferredUrls?.length && !state.categoryReview?.length;

function caseCompletion(state, passes) {
  return {
    phase: 'initial-product-pass-finished',
    passes,
    manufacturerVerificationPending: true,
    deliveryVerificationPending: true,
    deferredProducts: state.deferredUrls?.length || 0,
    categoryReviewPending: state.categoryReview?.length || 0,
  };
}

// Each step owns the same persistent profile in sequence. Publication is local.
export async function runAccountCase({
  discover,
  collect,
  audit,
  publish,
  recollect,
  reuseDiscovery = false,
}) {
  await ensureDiscovery({ reuseDiscovery, audit, discover });
  await publish();
  let state = await audit();
  if (!state.discoveryComplete || state.failures.length) {
    return {
      phase: 'discovery',
      stopped: true,
      reason: 'discovery-incomplete',
    };
  }
  let passes = 0;
  while (pending(state)) {
    const before = backlogFingerprint(state);
    try {
      await collect();
    } catch (error) {
      await publish();
      throw error;
    }
    passes++;
    await publish();
    state = await audit();
    if (pending(state) && backlogFingerprint(state) === before) {
      return {
        phase: 'details',
        stopped: true,
        reason: 'unresolved-products',
        passes,
        pending: pending(state),
      };
    }
  }
  // Old captures are refreshed only after the entire initial product backlog.
  if (recollect && canRecollect(state)) {
    await recollect();
    await publish();
  }
  return caseCompletion(state, passes);
}
