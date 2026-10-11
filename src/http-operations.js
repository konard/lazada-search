import { executeOperation } from './operations.js';

export const MUTATION_PATHS = [
  '/api/operations',
  '/api/translation',
  '/api/translation-product',
  '/api/translation-catalog',
];
const maxBodyBytes = 1048576;

function assertOrigin(request, origin) {
  const port = new URL(origin).port;
  if (
    ![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)
  ) {
    throw new Error('Operation requires a local host header');
  }
  const requestOrigin = `http://${request.headers.host}`;
  if (
    (request.headers.origin && request.headers.origin !== requestOrigin) ||
    request.headers['sec-fetch-site'] === 'cross-site'
  ) {
    throw new Error('Operation requires the same local origin');
  }
  if (
    !/^application\/json(?:\s*;|$)/iu.test(
      request.headers['content-type'] || ''
    )
  ) {
    throw new Error('Operation requires application/json');
  }
}

async function readJson(request) {
  if (Number(request.headers['content-length']) > maxBodyBytes) {
    throw new Error('Operation body exceeds 1 MiB');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new Error('Operation body exceeds 1 MiB');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function handleHttpOperation(
  application,
  request,
  pathname,
  origin
) {
  assertOrigin(request, origin);
  const payload = await readJson(request);
  if (pathname === '/api/operations') {
    return executeOperation(application, payload);
  }
  const operation =
    pathname === '/api/translation'
      ? 'translate'
      : pathname === '/api/translation-product'
        ? 'translate-product'
        : 'translate-catalog';
  return executeOperation(application, {
    operation,
    input: payload,
    options:
      payload.options || (operation === 'translate-catalog' ? payload : {}),
  });
}
