import { normalizeColor } from '/project-data.mjs';
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
export function colorSwatch(value) {
  const color = normalizeColor(value);
  if (!color) return null;
  const swatch = element('span', undefined, 'swatch');
  swatch.style.backgroundColor = color;
  swatch.setAttribute('aria-hidden', 'true');
  return swatch;
}
export function colorLabel(value, label = '') {
  const group = element('span', undefined, 'color-value');
  if (label) group.append(element('span', label));
  const swatch = colorSwatch(value);
  if (swatch) group.append(swatch);
  group.append(element('code', normalizeColor(value) ? value : 'Unknown color'));
  return group;
}
