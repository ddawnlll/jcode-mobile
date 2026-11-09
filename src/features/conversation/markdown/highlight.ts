import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const REGISTRY: Record<string, { language: typeof javascript; aliases: string[] }> = {
  javascript: { language: javascript, aliases: ['js', 'jsx', 'mjs', 'cjs'] },
  typescript: { language: typescript, aliases: ['ts', 'tsx'] },
  python: { language: python, aliases: ['py'] },
  json: { language: json, aliases: ['jsonc'] },
  bash: { language: bash, aliases: ['sh', 'shell', 'zsh', 'console'] },
  yaml: { language: yaml, aliases: ['yml'] },
  sql: { language: sql, aliases: [] },
  markdown: { language: markdown, aliases: ['md', 'mdx'] },
  diff: { language: diff, aliases: ['patch'] },
  rust: { language: rust, aliases: ['rs'] },
  go: { language: go, aliases: ['golang'] },
  java: { language: java, aliases: [] },
  c: { language: c, aliases: ['h'] },
  cpp: { language: cpp, aliases: ['c++', 'cc', 'hpp'] },
  xml: { language: xml, aliases: ['html', 'svg'] },
  css: { language: css, aliases: ['scss'] },
};

for (const [name, entry] of Object.entries(REGISTRY)) {
  hljs.registerLanguage(name, entry.language);
}

export type SyntaxRole =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'punctuation'
  | 'inserted'
  | 'deleted'
  | 'plain';

export interface SyntaxSegment {
  text: string;
  role: SyntaxRole;
}

export interface SyntaxLine {
  segments: SyntaxSegment[];
}

const ALIASES = new Map<string, string>();
for (const [name, entry] of Object.entries(REGISTRY)) {
  ALIASES.set(name, name);
  for (const alias of entry.aliases) ALIASES.set(alias, name);
}

export function supportedLanguage(label: string): string | null {
  return ALIASES.get(label.trim().toLowerCase()) ?? null;
}

export function highlightCode(code: string, language: string): SyntaxLine[] | null {
  const resolved = supportedLanguage(language);
  if (!resolved) return null;
  let html: string;
  try {
    html = hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
  return html
    .split('\n')
    .map((line) => ({ segments: parseLine(line) }));
}

function roleFor(className: string): SyntaxRole {
  if (/addition|inserted/.test(className)) return 'inserted';
  if (/deletion|deleted/.test(className)) return 'deleted';
  if (/comment|quote/.test(className)) return 'comment';
  if (/keyword|built_in|type|title|function|selector-tag/.test(className)) return 'keyword';
  if (/string|regexp|template|char|attribute/.test(className)) return 'string';
  if (/number|literal|symbol|bullet/.test(className)) return 'number';
  if (/punctuation|operator/.test(className)) return 'punctuation';
  return 'plain';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number(dec)));
}

/** Convert highlight.js span markup into flat colored segments. */
function parseLine(line: string): SyntaxSegment[] {
  const segments: SyntaxSegment[] = [];
  const stack: string[] = [];
  const pattern = /<span class="([^"]+)">|<\/span>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match[1]) {
      stack.push(match[1]);
    } else if (match[0] === '</span>') {
      stack.pop();
    } else if (match[2]) {
      const text = decodeEntities(match[2]);
      if (!text) continue;
      const role = roleFor(stack[stack.length - 1] ?? '');
      const previous = segments[segments.length - 1];
      if (previous && previous.role === role) previous.text += text;
      else segments.push({ text, role });
    }
  }
  if (segments.length === 0) segments.push({ text: '', role: 'plain' });
  return segments;
}
