import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DomainScheduler } from '../src/cache.js';

const directory = 'docs/acceptance/urgent-whey-reviews/cgn-sources';
const scheduler = new DomainScheduler({ intervalMs: 60000 });
const definitions = [
  {
    name: 'brand-ownership',
    url: 'https://corporate.iherb.com/iherb-introduces-california-gold-nutrition-beauty/',
    extension: 'html',
    contentType: /^text\/html/iu,
  },
  {
    name: 'dark-chocolate-907g-front',
    url: 'https://cloudinary.images-iherb.com/image/upload/f_auto%2Cq_auto%3Aeco/images/cgn/cgn01202/r/77.jpg',
    extension: 'image',
    contentType: /^image\//iu,
  },
  {
    name: 'dark-chocolate-907g-back',
    url: 'https://cloudinary.images-iherb.com/image/upload/f_auto%2Cq_auto%3Aeco/images/cgn/cgn01202/r/81.jpg',
    extension: 'image',
    contentType: /^image\//iu,
  },
  {
    name: 'dark-chocolate-907g-front-original',
    url: 'https://s3.images-iherb.com/cgn/cgn01202/l/77.jpg',
    publishedThumbnailUrl:
      'https://cloudinary.images-iherb.com/image/upload/f_auto%2Cq_auto%3Aeco/images/cgn/cgn01202/r/77.jpg',
    extension: 'jpg',
    contentType: /^image\//iu,
  },
  {
    name: 'dark-chocolate-907g-back-original',
    url: 'https://s3.images-iherb.com/cgn/cgn01202/l/81.jpg',
    publishedThumbnailUrl:
      'https://cloudinary.images-iherb.com/image/upload/f_auto%2Cq_auto%3Aeco/images/cgn/cgn01202/r/81.jpg',
    extension: 'jpg',
    contentType: /^image\//iu,
  },
];
await mkdir(directory, { recursive: true });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const definition of definitions) {
  const metadataPath = `${directory}/${definition.name}-source.json`;
  const sourcePath = `${directory}/${definition.name}.${definition.extension}`;
  let saved;
  try {
    saved = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (saved) {
    if (saved.status !== 200) {
      console.log(`${definition.name}: retained failed capture; no retry`);
      continue;
    }
    const bytes = await readFile(sourcePath);
    if (digest(bytes) !== saved.sha256) {
      throw new Error(`Invalid cached ${definition.name} source digest`);
    }
    console.log(`${definition.name}: verified existing source`);
    continue;
  }
  const captured = await scheduler.run(definition.url, async () => {
    const response = await fetch(definition.url, {
      signal: AbortSignal.timeout(30000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || '';
    const success = response.ok && definition.contentType.test(contentType);
    await writeFile(sourcePath, bytes);
    const metadata = {
      url: definition.url,
      finalUrl: response.url,
      observedAt: new Date().toISOString(),
      method: 'direct-public-http-original-bytes',
      status: response.status,
      success,
      contentType,
      sha256: digest(bytes),
      bytes: bytes.length,
      filename: sourcePath,
      ...(definition.publishedThumbnailUrl
        ? {
            publishedThumbnailUrl: definition.publishedThumbnailUrl,
            imageDerivation:
              'Official CDN high-resolution version of the same product image identifier; visual comparison with the published thumbnail is required.',
          }
        : {}),
      ...(success ? {} : { error: 'Unusable source; retained without retry' }),
    };
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    return metadata;
  });
  console.log(JSON.stringify(captured));
}
