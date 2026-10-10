import { sha256 } from '../src/util.js';

function backlogFingerprint(audit) {
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
  return (
    audit.missingListings.length +
    audit.missingSkuPrices.length +
    audit.missingPrices.length +
    (audit.unknownSkuInventories?.length || 0)
  );
}

// Each step owns the same persistent profile in sequence. Publication is local.
export async function runAccountCase({
  discover,
  collect,
  audit,
  publish,
  recollect,
}) {
  await discover();
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
  if (recollect) {
    await recollect();
    await publish();
  }
  return {
    phase: 'initial-product-pass-finished',
    passes,
    manufacturerVerificationPending: true,
    deliveryVerificationPending: true,
  };
}
