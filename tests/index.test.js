import test from 'node:test';
import assert from 'node:assert/strict';
import * as library from '../src/index.js';

test('public package exposes the library and adapters without launching a browser', () => {
  for (const name of [
    'LazadaSearch',
    'AssociativeStore',
    'DoubletGraph',
    'NativeLinkStore',
    'BrowserCollector',
    'EvidenceCache',
    'TesseractOcr',
    'compareOffers',
    'createTelegramBot',
    'startServer',
    'importSession',
  ]) {
    assert.equal(typeof library[name], 'function');
  }
});
