import {
  checkoutNodeVisible,
  checkoutPointer,
} from './lazada-checkout-fields.js';

function visibleElement(document, selector, row) {
  if (typeof selector !== 'string' || !selector || selector.length > 1000) {
    throw new Error('Checkout binding requires an explicit bounded selector');
  }
  const nodes = document.querySelectorAll(selector);
  if (
    nodes.length !== 1 ||
    !checkoutNodeVisible(nodes[0]) ||
    (row && !row.contains(nodes[0]))
  ) {
    throw new Error(
      'Checkout binding must identify one visible field within its exact selected row'
    );
  }
  return nodes[0];
}

function attribute(element, name) {
  if (typeof name !== 'string' || !/^data-[a-z\d-]+$/u.test(name)) {
    throw new Error(
      'Checkout identity binding needs an explicit data attribute'
    );
  }
  const value = element.getAttribute(name);
  if (typeof value !== 'string' || !value || value.length > 200) {
    throw new Error('Checkout identity attribute is absent or unbounded');
  }
  return value;
}

function selectedRow(document, row, binding) {
  if (
    !binding ||
    !['checked', 'aria-checked', 'data-selected'].includes(binding.attribute)
  ) {
    throw new Error(
      'Checkout identity binding needs an explicit selected-row control'
    );
  }
  const control = visibleElement(document, binding.selector, row);
  const selected =
    binding.attribute === 'checked'
      ? control.tagName === 'INPUT' &&
        control.getAttribute('type') === 'checkbox' &&
        control.hasAttribute('checked')
      : control.getAttribute(binding.attribute) === 'true';
  if (!selected) {
    throw new Error('Checkout source row is not explicitly selected');
  }
}

function exactSku(itemId, skuId) {
  if (!/^\d+$/u.test(String(itemId)) || !/^\d+$/u.test(String(skuId))) {
    throw new Error('Checkout source needs numeric original item and SKU IDs');
  }
  return `${itemId}_VNAMZ-${skuId}`;
}

function jsonRow(document, row, binding) {
  const scripts = document.querySelectorAll(binding.scriptSelector);
  if (
    scripts.length !== 1 ||
    scripts[0].tagName !== 'SCRIPT' ||
    !['application/json', 'application/ld+json'].includes(
      scripts[0].getAttribute('type')
    ) ||
    scripts[0].textContent.length > 2 * 1024 * 1024
  ) {
    throw new Error(
      'Checkout JSON binding requires one bounded original JSON script'
    );
  }
  const rows = checkoutPointer(
    JSON.parse(scripts[0].textContent),
    binding.rowsPointer
  );
  if (
    !Array.isArray(rows) ||
    rows.length > 100 ||
    !Number.isSafeInteger(binding.rowIndex) ||
    binding.rowIndex < 0 ||
    binding.rowIndex >= rows.length
  ) {
    throw new Error(
      'Checkout JSON binding requires an exact bounded row index'
    );
  }
  const value = rows[binding.rowIndex];
  const key = checkoutPointer(value, binding.rowKeyPointer);
  const domKey = attribute(row, binding.rowKeyAttribute);
  if (
    !['string', 'number'].includes(typeof key) ||
    !String(key) ||
    String(key).length > 200 ||
    String(key) !== domKey ||
    rows.filter(
      (entry) =>
        String(checkoutPointer(entry, binding.rowKeyPointer)) === domKey
    ).length !== 1
  ) {
    throw new Error(
      'Original checkout JSON row must uniquely identify its visible selected DOM row'
    );
  }
  return value;
}

/** Explicit reviewed source identity only; no normal HTML or state is mutated. */
export function extractCheckoutLineBinding(document, line) {
  const binding = line.identityBinding;
  if (!binding) {
    return undefined;
  }
  const row = visibleElement(document, binding.rowSelector);
  if (['HTML', 'BODY'].includes(row.tagName)) {
    throw new Error(
      'A selected checkout row binding cannot cover the entire document'
    );
  }
  selectedRow(document, row, binding.selection);
  if (binding.kind === 'attributes') {
    const itemId = attribute(
      visibleElement(document, binding.itemId?.selector, row),
      binding.itemId?.attribute
    );
    const skuId = attribute(
      visibleElement(document, binding.skuId?.selector, row),
      binding.skuId?.attribute
    );
    return { row, sku: exactSku(itemId, skuId), kind: binding.kind };
  }
  if (binding.kind === 'embedded-json') {
    const value = jsonRow(document, row, binding);
    return {
      row,
      sku: exactSku(
        checkoutPointer(value, binding.itemIdPointer),
        checkoutPointer(value, binding.skuIdPointer)
      ),
      value,
      kind: binding.kind,
    };
  }
  throw new Error('Unsupported checkout identity binding');
}

export function extractCheckoutQuantityBinding(document, line, identity) {
  const binding = line.quantityBinding;
  if (!binding) {
    return undefined;
  }
  if (!identity) {
    throw new Error(
      'Quantity attributes or JSON need an exact reviewed selected-row identity binding'
    );
  }
  let value;
  if (binding.kind === 'embedded-json') {
    if (identity.kind !== 'embedded-json') {
      throw new Error(
        'JSON quantity must come from its identity-bound original JSON row'
      );
    }
    value = checkoutPointer(identity.value, binding.pointer);
  } else {
    if (!['value', 'data-quantity'].includes(binding.attribute)) {
      throw new Error(
        'Quantity binding requires an explicit original value or data-quantity attribute'
      );
    }
    const field = visibleElement(document, binding.selector, identity.row);
    if (
      binding.attribute === 'value' &&
      !['INPUT', 'SELECT'].includes(field.tagName)
    ) {
      throw new Error(
        'A quantity value attribute must belong to an original input or select control'
      );
    }
    value = field.getAttribute(binding.attribute);
  }
  if (
    !/^\d+$/u.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  ) {
    throw new Error(
      'Original checkout quantity binding needs one positive exact integer'
    );
  }
  return Number(value);
}

export function assertCheckoutPriceRow(document, identity, selectors) {
  if (identity) {
    for (const selector of [selectors.unitPrice, selectors.subtotal]) {
      visibleElement(document, selector, identity.row);
    }
  }
}

export async function assertLiveCheckoutBindings(page, lines) {
  for (const line of lines || []) {
    const selection = line.identityBinding?.selection;
    if (
      selection?.attribute === 'checked' &&
      !(await page.locator(selection.selector).isChecked())
    ) {
      throw new Error(
        'Original HTML selected marker disagrees with the live selected checkout control'
      );
    }
    if (line.quantityBinding?.attribute === 'value') {
      const control = page.locator(line.quantityBinding.selector);
      const original = await control.getAttribute('value');
      const actual = await control.inputValue();
      if (original !== actual) {
        throw new Error(
          'Live quantity property differs from preserved HTML value; an exact original state binding is required'
        );
      }
    }
  }
}
