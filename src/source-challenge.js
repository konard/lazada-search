import { parseHTML } from 'linkedom';
import { inspectPageChallenge } from './page-challenge.js';

export function isHtmlSource(bytes, contentType = '') {
  return (
    /text\/html|application\/xhtml\+xml/iu.test(contentType) ||
    /^\s*<(?:!doctype|html|head|body|title|div|main)\b/iu.test(
      bytes.toString('utf8', 0, 512)
    )
  );
}

export function sourceChallenge(bytes, contentType, url) {
  if (!isHtmlSource(bytes, contentType)) {
    return null;
  }
  const html = bytes.toString('utf8');
  const parsed = parseHTML(html).document;
  const document =
    parsed.documentElement?.tagName === 'HTML'
      ? parsed
      : parseHTML(`<html><head></head><body>${html}</body></html>`).document;
  const title = document.querySelector('title');
  if (title) {
    document.title = title.textContent;
  }
  const challenge = inspectPageChallenge({ document, url });
  return challenge.detected ? challenge : null;
}
