import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import {
  inspectPageChallenge,
  classifyPage,
  AssociativeStore,
  EvidenceCache,
  DomainScheduler,
} from '../src/index.js';
import { stopForChallenge } from '../src/page-challenge.js';

function inspect(html, url = 'https://www.lazada.vn/products/pdp-i123.html') {
  const { document } = parseHTML(
    `<html><head></head><body>${html}</body></html>`
  );
  return inspectPageChallenge({ document, url });
}

test('a visible iframe challenge is detected even without readable instructions', () => {
  const challenge = inspect(
    '<iframe src="https://sec.lazada.vn/nocaptcha/index"></iframe>'
  );
  assert.equal(challenge.detected, true);
  assert.deepEqual(challenge.signals, ['visible-challenge-widget']);
  assert.equal(classifyPage({ challenge }), 'challenge');
});

test('hidden CAPTCHA templates and ordinary embedded media do not block', () => {
  for (const html of [
    '<div hidden><iframe src="https://sec.lazada.vn/captcha"></iframe>Slide to verify</div>',
    '<div style="display: none"><div data-captcha>Trượt để xác minh</div></div>',
    '<div hidden><div class="cf-turnstile">Verify you are human</div></div>',
    '<template>Slide to verify</template><p>Chocolate whey</p>',
    '<template><div class="cf-turnstile">Verify you are human</div></template><p>Chocolate whey</p>',
    '<script>const instruction="Slide to verify";</script><iframe src="https://video.example/embed"></iframe>',
    '<p>Ingredients: whey isolate and cocoa. Customer review: good protein.</p>',
  ]) {
    assert.equal(inspect(html).detected, false, html);
  }
});

test('English and Vietnamese security instructions halt collection', () => {
  for (const text of [
    'Slide to verify',
    'Please complete the security check',
    'Verify you are human',
    'Verifying that you are human',
    'I am not a robot',
    'Trượt để xác minh',
    'Kéo thanh trượt để hoàn thành',
    'Xác minh bạn không phải là robot',
  ]) {
    assert.equal(inspect(`<p>${text}</p>`).detected, true, text);
  }
});

test('visible common CAPTCHA widgets stop even before their instructions load', () => {
  for (const widget of [
    'g-recaptcha',
    'h-captcha',
    'cf-turnstile',
    'geetest_panel',
  ]) {
    assert.equal(inspect(`<div class="${widget}"></div>`).detected, true);
  }
});

test('blank challenge redirects are detected without product text', () => {
  assert.equal(
    inspect('', 'https://www.lazada.vn/_____tmd_____/punish?token=private')
      .detected,
    true
  );
});

test('the saved Cloudflare403 interstitial is detected without executable scripts', async () => {
  const original = gunzipSync(
    await readFile(
      new URL(
        '../docs/acceptance/source-integrity/natural-chocolate-manufacturer/official-natural-whey.http403.public.html.gz',
        import.meta.url
      )
    )
  );
  const { document } = parseHTML(original.toString());
  assert.equal(document.title, 'Just a moment...');
  assert.equal(document.querySelector('script'), null);
  const result = inspectPageChallenge({
    document,
    url: 'https://www.optimumnutrition.com/en-us/products/gold-standard-whey-naturally-flavored-protein-powder',
  });
  assert.deepEqual(result.signals, ['visible-cloudflare-interstitial']);
  assert.equal(result.detected, true);
});

test('Cloudflare waiting titles need visible interstitial corroboration', () => {
  for (const html of [
    '<title>Just a moment...</title><body>Chocolate whey product loading.</body>',
    '<title>Just a moment...</title><body><div hidden><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div>Chocolate whey</body>',
    '<title>Just a moment...</title><body><div style="display:none" id="challenge-stage"></div>Chocolate whey</body>',
    '<title>Just a moment...</title><body><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><script>window._cf_chl_opt={};</script>Chocolate whey</body>',
    '<title>Just a moment...</title><body><script id="challenge-stage">window._cf_chl_opt={};</script>Chocolate whey</body>',
    '<title>Just a moment...</title><body><template id="challenge-error-text">Enable JavaScript and cookies to continue</template>Chocolate whey</body>',
    '<title>Just a moment...</title><body><template id="challenge-stage">Verify you are human</template>Chocolate whey</body>',
    '<title>Just a moment...</title><body><style id="challenge-stage">.challenge{display:none}</style>Chocolate whey</body>',
    '<title>Chocolate whey</title><body><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></body>',
    '<title>Access denied</title><body>Forbidden: HTTP403. Access permission required.</body>',
  ]) {
    const { document } = parseHTML(`<html><head>${html}</html>`);
    assert.equal(inspectPageChallenge({ document }).detected, false, html);
  }
  const { document } = parseHTML(
    '<html><head><title>Just a moment…</title></head><body><div id="challenge-stage"></div></body></html>'
  );
  assert.equal(inspectPageChallenge({ document }).detected, true);
});

test('a CAPTCHA during a pacing interval prevents every new download while cached evidence remains readable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-captcha-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const scheduler = new DomainScheduler({
    intervalMs: 60000,
    sleep: () =>
      stopForChallenge(store, {
        url: 'https://www.lazada.vn/_____tmd_____/punish?token=private',
        signals: ['challenge-url'],
      }),
  });
  const cache = new EvidenceCache({ store, scheduler });
  const savedUrl = 'https://www.lazada.vn/saved';
  await store.put('cache', {
    id: `page:${savedUrl}`,
    url: savedUrl,
    checkedAt: Date.now(),
    text: 'Original public product evidence',
  });
  scheduler.last.set('www.lazada.vn', Date.now());
  let requests = 0;
  const load = () => {
    requests++;
    return { text: 'Unexpected download' };
  };
  await assert.rejects(cache.get('https://www.lazada.vn/new', { load }), {
    code: 'COLLECTION_STOPPED',
  });
  await assert.rejects(
    cache.get('https://manufacturer.example/new', { load }),
    {
      code: 'COLLECTION_STOPPED',
    }
  );
  assert.equal(requests, 0);
  const replay = await cache.get(savedUrl, { load });
  assert.equal(replay.cacheHit, true);
  assert.equal(replay.text, 'Original public product evidence');
  const state = await store.get('collection-stop', 'browser-collection');
  assert.equal(state.origin, 'https://www.lazada.vn');
  assert.doesNotMatch(JSON.stringify(state), /token=|private/u);
});
