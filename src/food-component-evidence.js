import { parseHTML } from 'linkedom';
import { isDeepStrictEqual } from 'node:util';
import { canonicalUrl, normalizeText, sha256 } from './util.js';
import { parseTsv } from './ocr.js';
import { MANUFACTURERS, isTrustedManufacturer } from './manufacturers.js';
import { resolveProductReviews } from './catalog-products.js';
import { REQUIRED_SPEC_FIELDS, specificationProblems } from './verification.js';
import { extractCheckoutLineBinding } from './lazada-checkout-line-bindings.js';
import { checkoutField, checkoutPointer } from './lazada-checkout-fields.js';

const countFields = [
  'orderQuantity',
  'minOrderQuantity',
  'maxOrderQuantity',
  'units',
  'stockUnits',
  'maxUnitsPerOrder',
];
const packageFields = [
  ...REQUIRED_SPEC_FIELDS,
  'packCount',
  'netVolumeMl',
  'proteinPer100ml',
  'proteinPerPackageG',
];
const digestPattern = /^[a-f\d]{64}$/u;

function sameUrl(left, right) {
  try {
    return canonicalUrl(left) === canonicalUrl(right);
  } catch {
    return false;
  }
}

function observationTime(record) {
  const value = record?.observedAt ?? record?.fetchedAt;
  return typeof value === 'number' ? value : Date.parse(value);
}

function sourceReferences(record) {
  return ['html', 'blob', 'image', 'screenshot', 'textBlob', 'original']
    .filter((key) => digestPattern.test(record?.[key]?.sha256 || ''))
    .map((key) => ({ key, ...record[key] }));
}

function cachedRead(context, kind, id) {
  const key = `${kind}:${id}`;
  if (!context.records.has(key)) {
    context.records.set(key, context.store.get(kind, id));
  }
  return context.records.get(key);
}

async function originalBytes(context, hash) {
  if (!digestPattern.test(hash || '')) {
    throw new Error('Original source digest is missing or invalid');
  }
  if (!context.blobs.has(hash)) {
    context.blobs.set(hash, context.store.blob(hash));
  }
  const bytes = await context.blobs.get(hash);
  if (!bytes || sha256(bytes) !== hash) {
    throw new Error('Original source bytes are missing or corrupt');
  }
  return bytes;
}

async function sourceCaches(context, evidence, url) {
  const ids = new Set(
    [
      evidence.cacheId,
      ...['manufacturer', 'image', 'page', 'lazada', 'delivery'].map(
        (namespace) => `${namespace}:${canonicalUrl(url)}`
      ),
    ].filter(Boolean)
  );
  const records = await Promise.all(
    [...ids].map((id) => cachedRead(context, 'cache', id))
  );
  return records.filter(Boolean);
}

function sourceInvalidated(context, evidence, caches, observedAt) {
  if (evidence.invalidated === true || evidence.invalidatedAt) {
    return true;
  }
  const records = [
    ...caches,
    ...context.invalidations.filter(
      (record) =>
        sameUrl(record.url, evidence.url || evidence.sourceUrl) ||
        record.evidenceIds?.includes(evidence.id) ||
        record.cacheIds?.includes(evidence.cacheId)
    ),
  ];
  return records.some(
    (record) =>
      record.invalidated === true ||
      (record.invalidatedAt &&
        (!Number.isFinite(Date.parse(record.invalidatedAt)) ||
          Date.parse(record.invalidatedAt) >= observedAt))
  );
}

function validReviewMetadata(proof) {
  return Boolean(
    typeof proof?.excerpt === 'string' &&
    proof.excerpt.trim() &&
    typeof proof.reviewedBy === 'string' &&
    proof.reviewedBy.trim() &&
    Number.isFinite(Date.parse(proof.reviewedAt)) &&
    Date.parse(proof.reviewedAt) <= Date.now() + 60000 &&
    proof.invalidated !== true
  );
}

function proofShape(proof, evidenceIds) {
  const url = new URL(proof?.sourceUrl);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !digestPattern.test(proof.sourceSha256 || '') ||
    !evidenceIds?.includes(proof.evidenceId) ||
    !validReviewMetadata(proof)
  ) {
    throw new Error(
      'Source proof requires attached original evidence and a valid review'
    );
  }
}

async function proofSource(context, proof, evidenceIds) {
  proofShape(proof, evidenceIds);
  const evidence = await cachedRead(context, 'evidence', proof.evidenceId);
  if (
    !evidence ||
    !sameUrl(proof.sourceUrl, evidence.url || evidence.sourceUrl)
  ) {
    throw new Error('Source URL does not match the stored evidence');
  }
  const reference = sourceReferences(evidence).find(
    (blob) => blob.sha256 === proof.sourceSha256
  );
  if (!reference) {
    throw new Error(
      'Source digest does not match an original attached to the evidence'
    );
  }
  const bytes = await originalBytes(context, reference.sha256);
  const caches = await sourceCaches(context, evidence, proof.sourceUrl);
  const boundCaches = caches.filter((record) =>
    sourceReferences(record).some((blob) => blob.sha256 === reference.sha256)
  );
  const observedAt = observationTime(evidence);
  const time = Number.isFinite(observedAt)
    ? observedAt
    : observationTime(boundCaches[0]);
  if (
    !Number.isFinite(time) ||
    time > Date.now() + 60000 ||
    Date.parse(proof.reviewedAt) < time
  ) {
    throw new Error(
      'Source needs its real capture time and a subsequent review'
    );
  }
  if (sourceInvalidated(context, evidence, caches, time)) {
    throw new Error('Stored source was invalidated after this observation');
  }
  return { evidence, reference, bytes, caches: boundCaches, observedAt: time };
}

function sourceText(source) {
  if (
    ['image', 'screenshot'].includes(source.reference.key) ||
    /^(?:image\/|application\/pdf)/iu.test(source.evidence.contentType || '') ||
    !Buffer.from(source.bytes.toString('utf8'), 'utf8').equals(source.bytes) ||
    [...source.bytes].some((byte) => byte < 32 && ![9, 10, 13].includes(byte))
  ) {
    return undefined;
  }
  const text = source.bytes.toString('utf8');
  if (
    source.reference.key !== 'html' &&
    !/^\s*(?:<!doctype\s+html|<html\b)/iu.test(text)
  ) {
    return text;
  }
  const { document } = parseHTML(text);
  for (const node of document.querySelectorAll(
    'script, style, template, noscript'
  )) {
    node.remove();
  }
  return (
    document.body?.textContent || document.documentElement?.textContent || ''
  );
}

function transformMatches(transform, ocr, originalHash) {
  return Boolean(
    transform &&
    isDeepStrictEqual(transform, ocr.imageTransform) &&
    transform.originalImage?.sha256 === originalHash &&
    transform.derivedImage?.sha256 === ocr.imageHash &&
    ocr.originalImageHash === originalHash &&
    ocr.derivedImage?.sha256 === ocr.imageHash &&
    transform.id ===
      sha256(
        JSON.stringify([
          'ocr-image-transform-v1',
          originalHash,
          transform.transform,
          transform.renderer,
          transform.sourceOcr || null,
        ])
      )
  );
}

async function transformedOcrMatches(context, ocr, originalHash) {
  const transform = await cachedRead(
    context,
    'image-transform',
    ocr.imageTransform?.id
  );
  if (!transformMatches(transform, ocr, originalHash)) {
    throw new Error(
      'OCR transformation is not bound to the preserved original image'
    );
  }
  await originalBytes(context, transform.originalImage.sha256);
  await originalBytes(context, transform.derivedImage.sha256);
  if (transform.sourceOcr) {
    const original = await cachedRead(context, 'ocr', transform.sourceOcr.id);
    if (
      original?.imageHash !== originalHash ||
      original.rawTsv?.sha256 !== transform.sourceOcr.rawTsv?.sha256
    ) {
      throw new Error('OCR crop lost its original OCR provenance');
    }
    await checkedOcrText(context, original);
  }
}

async function checkedOcrText(context, ocr) {
  if (
    !ocr?.rawTsv?.sha256 ||
    !ocr.engine ||
    ocr.invalidated === true ||
    ocr.invalidatedAt
  ) {
    throw new Error('OCR needs preserved original TSV and engine provenance');
  }
  const bytes = await originalBytes(context, ocr.rawTsv.sha256);
  const parsed = parseTsv(bytes.toString('utf8'));
  if (normalizeText(parsed.text) !== normalizeText(ocr.text)) {
    throw new Error('OCR text differs from the preserved original TSV');
  }
  return parsed.text;
}

async function imageOcrText(context, source, proof) {
  const id = proof.ocrId || source.evidence.ocrId;
  if (!id) {
    return undefined;
  }
  const ocr = await cachedRead(context, 'ocr', id);
  if (!ocr) {
    throw new Error('Image OCR evidence does not exist');
  }
  if (ocr.imageHash !== source.reference.sha256) {
    await transformedOcrMatches(context, ocr, source.reference.sha256);
  }
  await originalBytes(context, ocr.imageHash);
  return checkedOcrText(context, ocr);
}

function storedReviewMatches(review, component) {
  const verification = component.product.manufacturerVerification;
  return Boolean(
    review &&
    review.productId === component.product.id &&
    review.identityMatched &&
    review.sourceAuthority === 'manufacturer' &&
    review.evidenceId === verification.evidenceId &&
    review.invalidated !== true &&
    !review.invalidatedAt
  );
}

async function exactStoredReview(context, component) {
  const verification = component.product?.manufacturerVerification;
  const id = verification?.reviewId;
  if (!id) {
    return undefined;
  }
  const review = await cachedRead(context, 'manufacturer-review', id);
  if (!storedReviewMatches(review, component)) {
    throw new Error(
      'Exact operator manufacturer review is missing or invalidated'
    );
  }
  for (const [field, value] of Object.entries(
    review.identity?.manufacturer || {}
  )) {
    const actual =
      field === 'packCount'
        ? component.product.packCount
        : component.sourceIdentity?.[field];
    if (
      actual !== undefined &&
      normalizeText(actual) !== normalizeText(value)
    ) {
      throw new Error(
        `Stored manufacturer review contradicts bonus identity: ${field}`
      );
    }
  }
  return review;
}

async function imagePublishedByManufacturer(context, component, source) {
  const officialId = component.product?.manufacturerVerification?.evidenceId;
  const official = await cachedRead(context, 'evidence', officialId);
  const url = official?.url || official?.sourceUrl;
  if (
    !official ||
    !isTrustedManufacturer(component.product, url, context.registry)
  ) {
    throw new Error('Label image lacks its trusted manufacturer page');
  }
  const caches = await sourceCaches(context, official, url);
  const attached = caches.some((cache) =>
    sameUrl(source.evidence.url || source.evidence.sourceUrl, url)
      ? cache.screenshot?.sha256 === source.reference.sha256
      : cache.snapshot?.productImages?.some((image) =>
          sameUrl(
            typeof image === 'string' ? image : image.url,
            source.evidence.url
          )
        )
  );
  if (!attached) {
    throw new Error(
      'Label image was not published by the captured manufacturer page'
    );
  }
  return { official, caches };
}

async function visualExcerptReviewed(context, component, source, proof, field) {
  const review = await exactStoredReview(context, component);
  if (
    !review ||
    normalizeText(review.reviewedBy) !== normalizeText(proof.reviewedBy)
  ) {
    return false;
  }
  await imagePublishedByManufacturer(context, component, source);
  const product = await cachedRead(context, 'product', component.product.id);
  const claims = product?.claims || [];
  return claims.some(
    (claim) =>
      claim.reviewId === review.id &&
      !claim.requiresReview &&
      (claim.sourceEvidenceId || claim.evidenceId) === source.evidence.id &&
      (field === 'identity' ||
        (claim.field === field &&
          isDeepStrictEqual(claim.value, proof.value) &&
          normalizeText(claim.excerpt) === normalizeText(proof.excerpt)))
  );
}

async function validateExcerpt(context, component, source, proof, field) {
  const text =
    sourceText(source) ?? (await imageOcrText(context, source, proof));
  if (text !== undefined) {
    if (!normalizeText(text).includes(normalizeText(proof.excerpt))) {
      throw new Error(
        'Reviewed excerpt is absent from the original source text'
      );
    }
    return text;
  }
  if (
    !(await visualExcerptReviewed(context, component, source, proof, field))
  ) {
    throw new Error(
      'Binary source needs SHA-bound OCR or a stored exact visual review'
    );
  }
  return undefined;
}

function eligibilitySourceContext(source, proof, component, offer, text) {
  const url = new URL(proof.sourceUrl);
  if (
    !/(?:^|\.)lazada\.(?:vn|co\.th|sg|com\.my|com\.ph|co\.id)$/u.test(
      url.hostname
    )
  ) {
    throw new Error(
      'Gift order eligibility requires original marketplace evidence'
    );
  }
  if (Date.parse(component.eligibility?.observedAt) !== source.observedAt) {
    throw new Error(
      'Gift eligibility time differs from the original observation'
    );
  }
  const excerpt = proof.contextExcerpt || proof.excerpt;
  if (proof.checkoutIdentityBinding) {
    checkoutEligibilityContext(source, proof, offer, excerpt);
    return;
  }
  const tokens = normalizeText(excerpt).match(/[\p{L}\p{N}_-]+/gu) || [];
  if (
    !text ||
    !normalizeText(text).includes(normalizeText(excerpt)) ||
    !normalizeText(excerpt).includes(normalizeText(proof.excerpt)) ||
    !tokens.includes(String(offer.sku))
  ) {
    throw new Error(
      'Gift eligibility original context does not identify the exact selected SKU'
    );
  }
}

function boundCheckoutEligibility(source, proof, offer) {
  const url = new URL(proof.sourceUrl);
  if (
    source.reference.key !== 'html' ||
    source.bytes.length > 20 * 1024 * 1024 ||
    source.evidence.role !== 'checkout' ||
    !/\/(?:cart|checkout)(?:\/|$)/u.test(url.pathname)
  ) {
    throw new Error(
      'Attribute or JSON gift identity requires bounded original checkout HTML evidence'
    );
  }
  const { document } = parseHTML(source.bytes.toString('utf8'));
  const identity = extractCheckoutLineBinding(document, {
    identityBinding: proof.checkoutIdentityBinding,
  });
  if (!identity || identity.sku !== offer.sku) {
    throw new Error(
      'Gift original checkout row does not identify the exact selected paid item and SKU'
    );
  }
  return { document, identity };
}

function checkoutEligibilityContext(source, proof, offer, excerpt) {
  const { document, identity } = boundCheckoutEligibility(source, proof, offer);
  if (proof.checkoutValuePointer !== undefined) {
    if (identity.kind !== 'embedded-json') {
      throw new Error(
        'Gift count JSON pointer must share the exact original selected identity JSON row'
      );
    }
    return;
  }
  const context = checkoutField(
    document,
    proof.checkoutContextSelector,
    'original checkout gift context'
  );
  const node = document.querySelector(proof.checkoutContextSelector);
  if (
    !identity.row.contains(node) ||
    !normalizeText(context.text).includes(normalizeText(excerpt)) ||
    !normalizeText(excerpt).includes(normalizeText(proof.excerpt))
  ) {
    throw new Error(
      'Gift original count excerpt must belong to its exact selected checkout row'
    );
  }
}

function checkoutStateCountExcerpt(source, proof, component, offer, field) {
  const { document, identity } = boundCheckoutEligibility(source, proof, offer);
  if (identity.kind !== 'embedded-json' || !countFields.includes(field)) {
    throw new Error(
      'Only exact gift eligibility counts may use an original selected checkout JSON value'
    );
  }
  const value = checkoutPointer(identity.value, proof.checkoutValuePointer);
  const script = document.querySelector(
    proof.checkoutIdentityBinding.scriptSelector
  );
  const original = script.textContent;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value !== proof.value ||
    value !== component.eligibility?.[field] ||
    !normalizeText(original).includes(normalizeText(proof.excerpt)) ||
    !normalizeText(original).includes(
      normalizeText(proof.contextExcerpt || proof.excerpt)
    )
  ) {
    throw new Error(
      'Gift eligibility count, original JSON value and reviewed original excerpt disagree'
    );
  }
  return original;
}

function trustedSource(context, component, source) {
  const url = source.evidence.url || source.evidence.sourceUrl;
  const finalUrls = source.caches
    .map((cache) => cache.finalUrl || cache.snapshot?.url)
    .filter(Boolean);
  return [url, source.evidence.finalUrl, ...finalUrls]
    .filter(Boolean)
    .every((value) =>
      isTrustedManufacturer(component.product, value, context.registry)
    );
}

async function validateProof(
  context,
  component,
  offer,
  proof,
  field,
  mode = 'fact'
) {
  const source = await proofSource(context, proof, component.evidenceIds);
  const text =
    mode === 'eligibility' &&
    proof.checkoutIdentityBinding &&
    proof.checkoutValuePointer !== undefined
      ? checkoutStateCountExcerpt(source, proof, component, offer, field)
      : await validateExcerpt(context, component, source, proof, field);
  if (mode === 'eligibility') {
    eligibilitySourceContext(source, proof, component, offer, text);
  }
  return {
    evidenceId: source.evidence.id,
    sourceSha256: source.reference.sha256,
    sourceUrl: proof.sourceUrl,
    observedAt: new Date(source.observedAt).toISOString(),
  };
}

async function storedManufacturerMatch(context, component) {
  const stored = await cachedRead(context, 'product', component.product?.id);
  if (!stored) {
    throw new Error('Bonus manufacturer approval has no stored product');
  }
  const product = await resolveProductReviews(
    context.store,
    globalThis.structuredClone(stored)
  );
  if (
    specificationProblems(product).length ||
    product.specificationsInvalidated
  ) {
    throw new Error(
      'Stored bonus manufacturer specifications are incomplete or held'
    );
  }
  if (
    !isDeepStrictEqual(
      product.manufacturerVerification,
      component.product.manufacturerVerification
    )
  ) {
    throw new Error(
      'Embedded bonus manufacturer approval differs from the stored approval'
    );
  }
  for (const field of packageFields) {
    if (
      component.product[field] !== undefined &&
      !isDeepStrictEqual(component.product[field], product[field])
    ) {
      throw new Error(
        `Bonus field contradicts the stored manufacturer product: ${field}`
      );
    }
  }
  return product;
}

async function manufacturerIdentitySource(context, component, product) {
  const verification = product.manufacturerVerification;
  const evidence = await cachedRead(
    context,
    'evidence',
    verification.evidenceId
  );
  const reference = sourceReferences(evidence)[0];
  if (!evidence || !reference) {
    throw new Error(
      'Stored manufacturer approval has no original primary evidence'
    );
  }
  const proof = {
    sourceUrl: evidence.url || evidence.sourceUrl,
    sourceSha256: reference.sha256,
    evidenceId: evidence.id,
    excerpt: 'Stored manufacturer identity',
    reviewedBy: 'Stored exact manufacturer match',
    reviewedAt: verification.checkedAt,
  };
  const source = await proofSource(context, proof, product.evidenceIds);
  if (!trustedSource(context, component, source)) {
    throw new Error(
      'Manufacturer source authority does not match the trusted bonus brand'
    );
  }
  if (verification.identityMethod === 'visual-exact-variant') {
    await exactStoredReview(context, component);
  } else {
    const checks =
      product.crossChecks?.filter(
        (check) =>
          check.evidenceId === evidence.id &&
          check.identityMatched &&
          check.sourceAuthority === 'manufacturer'
      ) || [];
    let matched = false;
    for (const check of checks) {
      const original = await cachedRead(context, 'cross-check', check.id);
      matched ||= Boolean(
        original?.identityMatched &&
        original.sourceAuthority === 'manufacturer' &&
        original.productId === product.id &&
        original.evidenceId === evidence.id
      );
    }
    if (!matched) {
      throw new Error(
        'Manufacturer identity has no stored exact cross-check or operator review'
      );
    }
  }
  return source;
}

async function validateManufacturerClaims(context, component) {
  if (
    !(
      component.product?.manufacturerVerification?.identityMatched &&
      component.product.manufacturerVerification.sourceAuthority ===
        'manufacturer'
    )
  ) {
    return [];
  }
  const product = await storedManufacturerMatch(context, component);
  const official = await manufacturerIdentitySource(
    context,
    component,
    product
  );
  const reviewed = [];
  for (const field of packageFields.filter(
    (name) => component.product[name] !== undefined
  )) {
    const claim = product.claims.find(
      (candidate) =>
        candidate.field === field &&
        !candidate.requiresReview &&
        candidate.source === 'manufacturer' &&
        candidate.evidenceId === product.manufacturerVerification.evidenceId &&
        isDeepStrictEqual(candidate.value, product[field])
    );
    if (!claim) {
      throw new Error(
        `Bonus manufacturer field lacks its stored source claim: ${field}`
      );
    }
    const leaf = await cachedRead(
      context,
      'evidence',
      claim.sourceEvidenceId || claim.evidenceId
    );
    const reference = sourceReferences(leaf)[0];
    if (!reference) {
      throw new Error(`Manufacturer claim lacks original evidence: ${field}`);
    }
    const proof = {
      ...claim,
      evidenceId: leaf.id,
      sourceUrl: leaf.url || leaf.sourceUrl,
      sourceSha256: reference.sha256,
      reviewedBy: claim.reviewedBy || 'Stored exact manufacturer match',
      reviewedAt:
        claim.reviewedAt || product.manufacturerVerification.checkedAt,
    };
    const source = await proofSource(context, proof, product.evidenceIds);
    if (source.evidence.id !== official.evidence.id) {
      await imagePublishedByManufacturer(context, component, source);
    }
    await validateExcerpt(context, component, source, proof, field);
    reviewed.push({
      field,
      evidenceId: source.evidence.id,
      sourceSha256: source.reference.sha256,
    });
  }
  return reviewed;
}

function componentProofs(component) {
  return [
    { path: 'review', field: 'identity', proof: component.review },
    ...Object.entries(component.facts || {}).map(([field, proof]) => ({
      path: `facts.${field}`,
      field,
      proof,
    })),
    ...countFields.map((field) => ({
      path: `eligibility.claims.${field}`,
      field,
      mode: 'eligibility',
      proof: component.eligibility?.claims?.[field],
    })),
  ];
}

async function validateComponent(context, component, offer) {
  const failures = [],
    sources = [];
  for (const entry of componentProofs(component)) {
    try {
      sources.push({
        path: entry.path,
        ...(await validateProof(
          context,
          component,
          offer,
          entry.proof,
          entry.field,
          entry.mode
        )),
      });
    } catch (error) {
      failures.push(`${entry.path}: ${error.message}`);
      if (entry.proof) {
        entry.proof.invalidated = true;
      }
    }
  }
  try {
    sources.push(...(await validateManufacturerClaims(context, component)));
  } catch (error) {
    failures.push(`manufacturer: ${error.message}`);
  }
  component.evidenceValidation = {
    status: failures.length ? 'unconfirmed' : 'originals-validated',
    checkedAt: new Date().toISOString(),
    reasons: failures,
    sources,
  };
  if (failures.length) {
    component.invalidated = true;
    component.review = { ...component.review, invalidated: true };
  }
}

/** Read-only original-evidence gate shared by comparison interfaces. */
export async function validateFoodComponentEvidence(
  store,
  offers,
  { manufacturerRegistry = MANUFACTURERS } = {}
) {
  const cloned = globalThis.structuredClone(offers);
  if (
    !cloned.some((offer) =>
      offer.foodComponents?.some((component) => component.kind === 'bonus-food')
    )
  ) {
    return cloned;
  }
  const context = {
    store,
    registry: manufacturerRegistry,
    records: new Map(),
    blobs: new Map(),
    invalidations: await store.list('invalidation'),
  };
  for (const offer of cloned) {
    for (const component of offer.foodComponents || []) {
      if (component.kind === 'bonus-food') {
        await validateComponent(context, component, offer);
      }
    }
  }
  return cloned;
}
