import { DomainScheduler } from './cache.js';
import { sha256 } from './util.js';
import { assertCollectionRunning, stopForChallenge } from './page-challenge.js';

const language = (value) => {
  if (
    typeof value !== 'string' ||
    !/^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(value)
  ) {
    throw new Error('A valid translation language code is required');
  }
  return value;
};
const identity = (value, label) => {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value)
  ) {
    throw new Error(`A stable translation ${label} is required`);
  }
  return value;
};
const adapterIdentity = (provider, providerId, providerVersion) => ({
  providerId: identity(
    providerId || provider?.id || 'unconfigured',
    'provider ID'
  ),
  providerVersion: identity(
    providerVersion || provider?.version || '1',
    'provider version'
  ),
});
const releaseResponse = async (response) => {
  await response.body?.cancel().catch(() => {});
};
function validateAdapter(provider, configured) {
  if (!provider) {
    return;
  }
  if (typeof provider.translate !== 'function') {
    throw new Error('Translation provider must expose a translate function');
  }
  if (configured.providerId === 'unconfigured') {
    throw new Error(
      'Translation adapters require an explicit provider identity'
    );
  }
  if (
    (provider.id && provider.id !== configured.providerId) ||
    (provider.version && provider.version !== configured.providerVersion)
  ) {
    throw new Error(
      'Translation adapter identity differs from the configured cache identity'
    );
  }
}
function sourceAssociation(sourceEvidenceId, sourceEvidenceHash) {
  if (
    sourceEvidenceHash !== undefined &&
    !/^[a-f\d]{64}$/u.test(sourceEvidenceHash)
  ) {
    throw new Error('Source evidence hash must be SHA-256');
  }
  if (
    sourceEvidenceId !== undefined &&
    (typeof sourceEvidenceId !== 'string' || !sourceEvidenceId)
  ) {
    throw new Error('Source evidence ID must be a nonempty string');
  }
  return {
    ...(sourceEvidenceId !== undefined ? { sourceEvidenceId } : {}),
    ...(sourceEvidenceHash !== undefined ? { sourceEvidenceHash } : {}),
  };
}
function translationBase(
  translator,
  originalText,
  sourceLanguage,
  targetLanguage
) {
  if (
    typeof originalText !== 'string' ||
    !originalText.trim() ||
    Buffer.byteLength(originalText, 'utf8') > 1048576
  ) {
    throw new Error('Translation needs nonempty source text of at most 1 MiB');
  }
  const base = {
    originalText,
    sourceSha256: sha256(Buffer.from(originalText, 'utf8')),
    sourceLanguage: language(sourceLanguage),
    targetLanguage: language(targetLanguage),
    providerId: translator.providerId,
    providerVersion: translator.providerVersion,
    presentationOnly: true,
    authoritative: false,
  };
  base.id = `translation:${sha256(JSON.stringify([base.sourceSha256, base.sourceLanguage, base.targetLanguage, base.providerId, base.providerVersion]))}`;
  return base;
}

/** Opt-in JSON adapter. Secrets and the endpoint are kept outside cached records. */
export function createHttpTranslationProvider({
  endpoint,
  id,
  version,
  tokenEnv,
  timeoutMs = 30000,
  fetch: request = globalThis.fetch,
} = {}) {
  const url = new URL(endpoint);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Translation endpoint must be an HTTP URL without credentials or query parameters'
    );
  }
  identity(id, 'provider ID');
  identity(version, 'provider version');
  if (
    id === 'unconfigured' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new Error('Configure a translation provider ID and positive timeout');
  }
  if (tokenEnv && !/^[A-Z][A-Z0-9_]*$/u.test(tokenEnv)) {
    throw new Error('Translation token environment variable name is invalid');
  }
  return {
    id,
    version,
    endpoint: url.href,
    async translate(input) {
      const token = tokenEnv ? process.env[tokenEnv] : undefined;
      const response = await request(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text: input.originalText,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
        }),
      });
      if ([403, 429].includes(response.status)) {
        await releaseResponse(response);
        await input.stop({
          url: url.href,
          signals: [`translation-http-${response.status}`],
        });
        throw Object.assign(new Error('Translation request stopped'), {
          code: 'COLLECTION_STOPPED',
        });
      }
      if (!response.ok) {
        await releaseResponse(response);
        throw new Error('Translation provider request failed');
      }
      if (
        !/application\/json/iu.test(response.headers.get('content-type') || '')
      ) {
        await releaseResponse(response);
        throw new Error('Translation provider must return JSON');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2097152) {
          await response.body.cancel?.().catch(() => {});
          throw new Error('Translation response exceeds the size limit');
        }
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')).translatedText;
    },
  };
}

/** Cached presentation text. Never used to derive authoritative product facts. */
export class CachedTranslator {
  constructor({
    store,
    provider,
    providerId,
    providerVersion,
    scheduler = new DomainScheduler(),
    offline = false,
    beforeDownload,
  } = {}) {
    if (!store) {
      throw new Error('Translation storage is required');
    }
    this.store = store;
    this.provider =
      typeof provider === 'function' ? { translate: provider } : provider;
    Object.assign(
      this,
      adapterIdentity(this.provider, providerId, providerVersion)
    );
    validateAdapter(this.provider, this);
    this.scheduler = scheduler;
    this.offline = offline;
    this.beforeDownload = beforeDownload;
    this.pending = new Map();
  }

  async translate(
    originalText,
    {
      sourceLanguage = 'vi',
      targetLanguage = 'en',
      refresh = false,
      sourceEvidenceId,
      sourceEvidenceHash,
    } = {}
  ) {
    const association = sourceAssociation(sourceEvidenceId, sourceEvidenceHash);
    const base = translationBase(
      this,
      originalText,
      sourceLanguage,
      targetLanguage
    );
    const key = `${base.id}:${refresh}`;
    if (!this.pending.has(key)) {
      this.pending.set(
        key,
        this.obtain(base, refresh).finally(() => this.pending.delete(key))
      );
    }
    const result = await this.pending.get(key);
    if (Object.keys(association).length) {
      await this.store.put('translation-source', {
        id: `translation-source:${sha256(JSON.stringify([base.id, association]))}`,
        translationId: base.id,
        ...association,
      });
    }
    return { ...result, ...association };
  }

  async cached(
    originalText,
    { sourceLanguage = 'vi', targetLanguage = 'en' } = {}
  ) {
    const base = translationBase(
      this,
      originalText,
      sourceLanguage,
      targetLanguage
    );
    const record = await this.store.get('translation', base.id);
    return this.valid(record, base) ? { ...record, cacheHit: true } : undefined;
  }

  async obtain(base, refresh) {
    const cached = await this.store.get('translation', base.id);
    if (!refresh && this.valid(cached, base)) {
      return { ...cached, cacheHit: true };
    }
    let reason = this.offline
      ? refresh
        ? 'offline-refresh-pending'
        : 'offline-cache-miss'
      : 'provider-not-configured';
    if (!this.offline && this.provider) {
      try {
        const translatedText = await this.request(base);
        await assertCollectionRunning(this.store);
        if (
          typeof translatedText !== 'string' ||
          !translatedText.trim() ||
          Buffer.byteLength(translatedText, 'utf8') > 2097152
        ) {
          throw new Error('Invalid translated text');
        }
        const saved = await this.store.put('translation', {
          ...base,
          status: 'translated',
          translatedText,
          translatedSha256: sha256(Buffer.from(translatedText, 'utf8')),
          translatedAt: new Date().toISOString(),
        });
        return { ...saved, cacheHit: false };
      } catch (error) {
        // Provider errors may contain credentials or response bodies. Never persist them.
        reason =
          error?.code === 'COLLECTION_STOPPED'
            ? 'collection-stopped'
            : 'provider-failed';
      }
    }
    return {
      ...(await this.store.put('translation', {
        ...base,
        status: 'pending',
        reason,
      })),
      cacheHit: false,
    };
  }

  valid(cached, base) {
    return (
      cached?.status === 'translated' &&
      Object.entries(base).every(([key, value]) => cached[key] === value) &&
      typeof cached.translatedText === 'string' &&
      cached.translatedText.trim() &&
      cached.translatedSha256 ===
        sha256(Buffer.from(cached.translatedText, 'utf8'))
    );
  }

  async request(base) {
    const run = async () => {
      await assertCollectionRunning(this.store);
      await this.beforeDownload?.();
      return this.provider.translate({
        ...base,
        stop: (challenge) => stopForChallenge(this.store, challenge),
      });
    };
    await assertCollectionRunning(this.store);
    return this.scheduler.run(
      this.provider.endpoint ||
        `https://${this.providerId}.translation.invalid/`,
      run
    );
  }
}

export async function translateProductText(
  application,
  productId,
  options = {}
) {
  const product = await application.store.get('product', productId);
  if (!product) {
    throw new Error('Unknown product for translation');
  }
  const texts = ['title', 'description', 'ingredients'].flatMap((field) => {
    const value = product[field];
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((text, index) => ({ field, index, text }))
      .filter((item) => typeof item.text === 'string' && item.text.trim());
  });
  const translations = [];
  for (const { field, index, text } of texts) {
    const translated = await application.translate(text, options);
    await application.store.put('translation-source', {
      id: `translation-product-source:${sha256(JSON.stringify([productId, field, index, translated.id]))}`,
      productId,
      field,
      index,
      translationId: translated.id,
      evidenceIds: [...(product.evidenceIds || [])],
    });
    translations.push({ field, index, ...translated });
  }
  return {
    productId,
    presentationOnly: true,
    authoritative: false,
    complete:
      translations.length > 0 &&
      translations.every((item) => item.status === 'translated'),
    translations,
  };
}
