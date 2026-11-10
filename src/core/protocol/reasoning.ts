/**
 * JCode persists historical reasoning as sentinel-wrapped, escaped Markdown
 * emphasis lines: `*\u2063line\u2063*` (see jcode-render-core/src/reasoning.rs).
 * Older adapters forwarded that markup as ordinary assistant content, which
 * made reasoning appear as italic prose and enter Copy/Find (TXT-1).
 *
 * Decode both the live adapter's separate `reasoning` field and this legacy
 * wrapper. Ordinary Markdown is returned byte-for-byte.
 */
const REASONING_ESCAPES = '\\*_`[]<>&~|$';

function decodeReasoningLine(line: string): string | null {
  const trimmed = line.replace(/[ \t\r]+$/, '');
  if (!trimmed.startsWith('*\u2063') || !trimmed.endsWith('\u2063*')) return null;
  const body = trimmed.slice(2, -2);
  let out = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '\\' && index + 1 < body.length && REASONING_ESCAPES.includes(body[index + 1])) {
      out += body[index + 1];
      index += 1;
    } else {
      out += char;
    }
  }
  return out;
}

export function splitLegacyReasoning(content: string): {
  content: string;
  reasoning?: string;
} {
  let found = false;
  const kept: string[] = [];
  const reasoning: string[] = [];
  for (const line of content.split('\n')) {
    const decoded = decodeReasoningLine(line);
    if (decoded === null) {
      kept.push(line);
    } else {
      found = true;
      reasoning.push(decoded);
    }
  }
  if (!found) return { content };
  // Remove only the blank lines contributed by the reasoning block preamble.
  let start = 0;
  while (start < kept.length && kept[start].trim() === '') start += 1;
  return {
    content: kept.slice(start).join('\n'),
    reasoning: reasoning.join('\n').trim(),
  };
}
