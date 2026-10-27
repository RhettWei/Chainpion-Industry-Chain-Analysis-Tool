// Display precision only; never round the underlying calculation or input.
export function displayValue(value, digits = 1) {
  return Number.isFinite(value) ? (Math.abs(value) < .5 * 10 ** -digits ? 0 : value) : null;
}
export function formatValue(value, digits = 1, missing = '—') {
  const rounded = displayValue(value, digits);
  return rounded === null ? missing : rounded.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export function signedValue(value, digits = 1) {
  const rounded = displayValue(value, digits);
  return rounded === null ? '—' : `${rounded > 0 ? '+' : ''}${formatValue(rounded, digits)}`;
}
export function valueClass(value, digits = 1) {
  const rounded = displayValue(value, digits);
  return rounded > 0 ? 'positive' : rounded < 0 ? 'negative' : 'neutral';
}
