# Image-backed decimal OCR

The committed Häagen-Dazs Singapore Belgian Chocolate label prints protein as **4.5 g per 100 g** and **4.0 g per 100 ml serving**. The cached full-panel PSM 11 pass drops the decimal marks and returns `45g` and `40g`.

The original image remains [in its existing source directory](../ice-dual-units/expanded-hd-sg-belgian-label.png). Its SHA-256 is `67907ce23aa9ff33a8431ad6ebe68289d842ab83f14586abf9d5ac7a5ab3c9e8`. [Original OCR TSV](original-psm11.tsv) retains the incorrect readings, with SHA-256 `0ce3ceffc726fd6299cfad3a7ced6d9166fe5f7e93600f5f03dce533a6e416c3`.

[Replay evidence](replay.json) records each original region, transform, original OCR ID, renderer versions, derived-image hash, raw TSV hash, engine, segmentation mode, language, confidence and cache result. The crop rectangles come from the original TSV bounds and source-image glyph separation. Numeric values do not decide their position.

| Source column              | Original OCR | Image-backed crop OCR | Confidence | Original-pixel rectangle                |
| -------------------------- | ------------ | --------------------- | ---------- | --------------------------------------- |
| Protein per 100 g          | `45g`        | `4.5`                 | 0.619      | left 801, top 517, width 82, height 68  |
| Protein per 100 ml serving | `40g`        | `4.0`                 | 0.916      | left 1074, top 512, width 83, height 73 |

The numerical crops exclude the unit glyph. The original label supplies `g` and the two different column bases. Both results remain review-only. This source's Singapore package/formula revision has not been matched to an exact Lazada selling SKU; the OCR results do not approve manufacturer identity or write nutrition into products.

## Library operation

```js
const result = await ocr.recognize(originalImageBlob, {
  psm: 7,
  sourceOcrId: originalFullPanelOcr.id,
  transform: {
    crop: { left: 801, top: 517, width: 82, height: 68 },
    resize: { width: 164, height: 136, kernel: 'lanczos3' },
    grayscale: true,
  },
});
```

`result.imageHash` identifies the physical derived PNG bytes sent to Tesseract. `originalImageHash` identifies the source image, and `imageTransform` links the two with a persistent `image-transform` cache receipt. A supplied `sourceOcrId` must belong to that original image and have an intact raw TSV blob. Full-image calls retain their existing `tsv-v2` cache identity.

Transforms accept static PNG, JPEG and WebP inputs, a crop contained in the original image, and bounded integer output dimensions. Input and output limits are 25 MiB, 16 million pixels and 8,192 pixels per dimension. Animated formats and PNG animation declarations are rejected. Renderer versions and normalized settings participate in the transform cache identity; crop results and raw TSV retain separate hashes. Identical requests reuse both derived bytes and OCR.

## Validation

`tests/ocr-crops.test.js` verifies the actual original image/TSV digests, crop provenance, deterministic cache replay, changed-region invalidation, bounds, unsupported options, source-image/TSV mismatch, animation rejection and unchanged full-image cache keys. A real local Tesseract test reproduces `4.5` and `4.0`; it reports a skip explicitly if Tesseract is unavailable. The cached-source and renderer checks run independently of that optional system binary.

The committed originals and derived image/OCR receipts also replay into the shared associative store through `node scripts/archive-decimal-ocr.mjs`. This verifies every source digest before writing, uses no OCR engine or downloads, and applies zero product facts. [The archive replay receipt](archive-replay.json) lists the imported OCR and transform IDs.
