const EMAIL_PATTERN = /^([^@]{1,2})[^@]*(@.+)$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const INJECTION_MARKERS =
  /\b(ignore (all|previous|the above)|disregard (all|previous)|system prompt|voce agora e|you are now)\b/gi;

export function maskEmail(email: string): string {
  const match = EMAIL_PATTERN.exec(email);
  if (!match) return "[redacted]";
  return `${match[1]}***${match[2]}`;
}

export function sanitizeUntrustedText(text: string, maxLength = 500): string {
  return text
    .replace(CONTROL_CHARS, " ")
    .replace(INJECTION_MARKERS, "[conteudo removido]")
    .trim()
    .slice(0, maxLength);
}
