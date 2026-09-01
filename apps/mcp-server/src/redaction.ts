const EMAIL_PATTERN = /^([^@]{1,2})[^@]*(@.+)$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
// Markers are intentionally multilingual: an injection attempt does not have to
// arrive in the language the product speaks.
const INJECTION_MARKERS =
  /\b(ignore (all|previous|the above)|disregard (all|previous)|system prompt|voce agora e|you are now|ignore as instrucoes)\b/gi;

export function maskEmail(email: string): string {
  const match = EMAIL_PATTERN.exec(email);
  if (!match) return "[redacted]";
  return `${match[1]}***${match[2]}`;
}

export function sanitizeUntrustedText(text: string, maxLength = 500): string {
  return text
    .replace(CONTROL_CHARS, " ")
    .replace(INJECTION_MARKERS, "[content removed]")
    .trim()
    .slice(0, maxLength);
}
