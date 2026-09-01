const EMAIL_PATTERN = /^([^@]{1,2})[^@]*(@.+)$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD]/g;
// Markers are intentionally multilingual: an injection attempt does not have to
// arrive in the language the product speaks. The denylist is telemetry, not the
// control -- the real defense is normalizing untrusted text and never treating it
// as instructions. The regex runs after NFKC + zero-width stripping so homoglyph
// and spacing tricks collapse into the forms below.
const INJECTION_MARKERS =
  /\b(ignore|disregard|forget)\s+(all\s+|the\s+)?(previous|prior|above)\b|system[\s-]?prompt|\byou\s+are\s+now\b|\bvoce\s+agora\s+e\b|new\s+instructions?:/gi;

export function maskEmail(email: string): string {
  const match = EMAIL_PATTERN.exec(email);
  if (!match) return "[redacted]";
  return `${match[1]}***${match[2]}`;
}

export function maskDocument(document: string): string {
  const trimmed = document.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}

/**
 * Neutralize any free-text string that came from the corporate system before it
 * reaches the model. Normalization (NFKC), zero-width removal and whitespace
 * collapse come first so that fullwidth, non-breaking-space and zero-width
 * variants of an injection phrase collapse into a detectable form.
 */
export function sanitizeUntrustedText(text: string, maxLength = 500): string {
  return text
    .normalize("NFKC")
    .replace(CONTROL_CHARS, " ")
    .replace(ZERO_WIDTH, " ")
    .replace(/\s+/g, " ")
    .replace(INJECTION_MARKERS, "[content removed]")
    .trim()
    .slice(0, maxLength);
}
