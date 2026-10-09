import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { positive } from './util.js';

export function apiComparisonOptions(params) {
  const options = {};
  for (const field of [
    'quantity',
    'shipping',
    'discount',
    'minProtein',
    'maxSugar',
  ]) {
    if (params.has(field) && params.get(field) !== '') {
      options[field] = positive(Number(params.get(field)), field, {
        zero: field !== 'quantity',
        integer: field === 'quantity',
      });
    }
  }
  for (const field of [
    'category',
    'proteinType',
    'currency',
    'sort',
    'deliveryArea',
  ]) {
    if (params.get(field)) {
      options[field] = params.get(field);
    }
  }
  options.allowStale = params.get('allowStale') === 'true';
  options.requireShipping = params.get('requireShipping') !== 'false';
  options.excludeIngredients = params.getAll('excludeIngredient');
  return options;
}

export async function startServer({ application, port = 8080 } = {}) {
  positive(port, 'port', { zero: true, integer: true });
  if (port > 65535) {
    throw new Error('Invalid server port');
  }
  const server = createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'",
    };
    try {
      if (request.method !== 'GET') {
        response.writeHead(405, headers);
        response.end();
        return;
      }
      const url = new URL(request.url, 'http://localhost');
      let result;
      if (url.pathname === '/health') {
        result = { status: 'ok' };
      } else if (url.pathname === '/api/compare') {
        result = await application.compare(
          apiComparisonOptions(url.searchParams)
        );
      } else if (url.pathname === '/api/products') {
        result = await application.store.list('product');
      } else if (url.pathname === '/api/evidence') {
        result = await application.store.get(
          'evidence',
          url.searchParams.get('id') || ''
        );
      } else if (url.pathname === '/api/ocr') {
        result = await application.store.get(
          'ocr',
          url.searchParams.get('id') || ''
        );
      } else if (/^\/blobs\/[a-f\d]{64}$/u.test(url.pathname)) {
        const bytes = await application.store.blob(url.pathname.slice(7));
        if (!bytes) {
          response.writeHead(404, headers);
          response.end();
          return;
        }
        response.writeHead(200, {
          ...headers,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment',
        });
        response.end(bytes);
        return;
      } else if (['/', '/app.js', '/app.css'].includes(url.pathname)) {
        const name =
          url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const mime = name.endsWith('.html')
          ? 'text/html'
          : name.endsWith('.js')
            ? 'text/javascript'
            : 'text/css';
        response.writeHead(200, {
          ...headers,
          'Content-Type': `${mime}; charset=utf-8`,
        });
        response.end(await readFile(new URL(`./web/${name}`, import.meta.url)));
        return;
      } else {
        response.writeHead(404, headers);
        response.end();
        return;
      }
      response.writeHead(200, {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify(result ?? null));
    } catch (error) {
      response.writeHead(400, {
        ...headers,
        'Content-Type': 'application/json',
      });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
