import { fold } from './text.js';

// Conservative negative evidence for the chocolate/plain whey + chocolate ice
// case. An unknown title or another flavour never excludes a whole listing:
// that listing may contain a relevant sibling SKU.
export function targetCategoryExclusion(title) {
  const text = fold(title || '')
    .replace(/\[[^\]]*\]/gu, ' ')
    .replace(/[-–—]/gu, ' ');
  const powder = /\b(?:powder|bot|kg|lbs?)\b/u.test(text);
  if (
    /\b(?:animal feed|pet food|livestock feed|fodder)\b|\b(?:chuyen dung|danh|dung)\s+cho\s+(?:ech|ca|cho|meo|ga|heo|lon|bo)\b|\bthuc an\s+(?:cho\s+)?(?:ech|ca|cho|meo|ga|heo|lon|gia suc)\b/u.test(
      text
    )
  ) {
    return 'Animal feed is outside the human whey and ice-cream categories';
  }
  if (
    /\b(?:protein|whey)\s*(?:bars?|thanh)\b|\bthanh\s*(?:protein|whey|nang luong|dinh duong)\b|\benergy\s*bars?\b/u.test(
      text
    ) &&
    !/ice\s*cream|gelato|\bkem\s*(?:que|hop|ly|oc que)\b/u.test(text)
  ) {
    return 'Protein bars are outside the protein powder category';
  }
  const hardware =
    /binh\s*lac\s*dien|dien\s*binh\s*lac|electric\s*shaker|coc\s*khuay|\b(?:blender|shaker\s*bottle)\b|may\s*xay/u.test(
      text
    );
  if (hardware && !powder) {
    return 'Standalone shaker or blender hardware, not a food product';
  }
  if (
    /\b(?:vegan|thuc vat|thuan chay|plant based|plant protein|pea protein|non dairy)\b/u.test(
      text
    )
  ) {
    return 'Plant-only protein is outside the whey category';
  }
  if (
    /\b(?:soy|soya)\s*(?:protein|isolate)\b|\b(?:protein|isolate)\s*(?:soy|soya)\b|dam\s*dau\s*nanh/u.test(
      text
    ) &&
    !/\bwhey\b/u.test(text)
  ) {
    return 'Soy protein is a separate category from whey';
  }
  return null;
}
