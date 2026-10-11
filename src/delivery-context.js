import { fold, normalizeText } from './text.js';

// A requested city is configuration. The page's selected address is evidence.
// Unrecognised localities retain their full address and need an explicit
// matching comparison area.
export function deliveryAreaForDestination(destination) {
  const text =
    typeof destination === 'string' ? normalizeText(destination) : '';
  const parts = text.split(',').map((part) => fold(part.trim()));
  if (
    parts.length === 2 &&
    /^(?:tinh )?khanh hoa$/u.test(parts[0]) &&
    /^(?:(?:phuong|thanh pho|tp\.?)[ ]+)?nha trang$/u.test(parts[1])
  ) {
    return 'Nha Trang';
  }
  return text;
}

export function deliveryContextMatches(offer, requestedArea) {
  const requested = fold(requestedArea || '');
  const recorded = fold(offer.deliveryArea || '');
  if (requested && requested !== recorded) {
    return false;
  }
  const area = requested || recorded;
  return (
    !area ||
    offer.shippingDestination === undefined ||
    fold(deliveryAreaForDestination(offer.shippingDestination)) === area
  );
}
