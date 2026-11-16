/**
 * Rich, safe markdown.
 *
 * - Fenced code gets a header with a one-tap copy control.
 * - `diff` / `patch` fences render added, removed, hunk and meta lines with
 *   restrained +/− styling.
 * - Images are lazy, cap at the content width, and are only rendered for
 *   https/http/data:image sources.
 * - External links open outside the app with `noopener noreferrer`.
 * - The component is memoised on text so a streaming delta re-renders only the
 *   bubble that changed, never the whole transcript.
 */
import MarkdownIt from 'markdown-it';
import { memo, useMemo, useState } from 'react';
import { copyText, haptic } from './motion';
import { classifyDiffLine } from '../lib/toolLabels';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeImageSource(source: string): boolean {
  const value = source.trim().toLowerCase();
  return (
    value.startsWith('https://') ||
    value.startsWith('http://') ||
    value.startsWith('data:image/')
  );
}

function diffHtml(content: string): string {
  return content
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => {
      const kind = classifyDiffLine(line);
      const body = line.length ? escapeHtml(line) : '&nbsp;';
      return `<span class="diff-line diff-${kind}">${body}</span>`;
    })
    .join('\n');
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
});

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const info = (token.info ?? '').trim();
  const language = info.split(/\s+/)[0]?.toLowerCase() ?? '';
  const body =
    language === 'diff' || language === 'patch'
      ? `<pre class="diff-block"><code>${diffHtml(token.content)}</code></pre>`
      : `<pre><code>${escapeHtml(token.content)}</code></pre>`;
  const label = language || 'text';
  return [
    `<div class="code-block" data-lang="${escapeHtml(label)}">`,
    '<div class="code-head">',
    `<span class="code-lang">${escapeHtml(label)}</span>`,
    '<button type="button" class="code-copy" aria-label="Copy code block">Copy</button>',
    '</div>',
    body,
    '</div>',
  ].join('');
};

markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noreferrer noopener');
  return self.renderToken(tokens, index, options);
};

markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  const src = token.attrGet('src') ?? '';
  const alt = token.content ?? token.attrGet('alt') ?? '';
  if (!safeImageSource(src)) {
    return `<span class="md-image-blocked">Image omitted: only http(s) and data:image sources are rendered.</span>`;
  }
  return [
    '<img class="md-image"',
    ` src="${escapeHtml(src)}"`,
    ` alt="${escapeHtml(alt)}"`,
    ' loading="lazy" decoding="async" referrerpolicy="no-referrer"',
    ' />',
  ].join('');
};

export const RichMarkdown = memo(
  function RichMarkdown({ text }: { text: string }) {
    const html = useMemo(() => markdown.render(text), [text]);
    const [status, setStatus] = useState<string | null>(null);

    const onClick = async (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const anchor = target.closest('a');
      if (anchor) {
        const href = anchor.getAttribute('href') ?? '';
        if (/^https?:/i.test(href)) {
          event.preventDefault();
          try {
            window.open(href, '_blank', 'noopener,noreferrer');
          } catch {
            setStatus('The link could not be opened.');
          }
        }
        return;
      }
      const button = target.closest<HTMLElement>('.code-copy');
      if (!button) return;
      const block = button.closest('.code-block');
      const code = block?.querySelector('code')?.textContent ?? '';
      const ok = await copyText(code);
      haptic(ok ? 'select' : 'warn');
      setStatus(ok ? 'Code copied.' : 'Clipboard permission was denied.');
      button.textContent = ok ? 'Copied' : 'Blocked';
      button.classList.toggle('is-copied', ok);
      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.textContent = 'Copy';
        button.classList.remove('is-copied');
      }, 1500);
    };

    return (
      <div className="markdown" onClick={onClick}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <span className="sr-only" role="status" aria-live="polite">
          {status}
        </span>
      </div>
    );
  },
  (previous, next) => previous.text === next.text,
);
