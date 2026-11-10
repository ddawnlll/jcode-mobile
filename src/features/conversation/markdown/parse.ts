import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import type Token from 'markdown-it/lib/token.mjs';

export type Align = 'left' | 'center' | 'right' | null;

export interface TextSpan {
  type: 'text';
  text: string;
}
export interface StrongSpan {
  type: 'strong';
  children: InlineSpan[];
}
export interface EmSpan {
  type: 'em';
  children: InlineSpan[];
}
export interface StrikeSpan {
  type: 'strike';
  children: InlineSpan[];
}
export interface CodeSpan {
  type: 'code';
  text: string;
}
export interface LinkSpan {
  type: 'link';
  href: string;
  children: InlineSpan[];
}
export interface ImageSpan {
  type: 'image';
  src: string;
  alt: string;
  title: string | null;
}
export interface MathInlineSpan {
  type: 'math_inline';
  latex: string;
}
export interface FootnoteRefSpan {
  type: 'footnote_ref';
  label: string;
  id: number;
}
export interface BreakSpan {
  type: 'break';
  hard: boolean;
}

export type InlineSpan =
  | TextSpan
  | StrongSpan
  | EmSpan
  | StrikeSpan
  | CodeSpan
  | LinkSpan
  | ImageSpan
  | MathInlineSpan
  | FootnoteRefSpan
  | BreakSpan;

export interface ParagraphBlock {
  type: 'paragraph';
  spans: InlineSpan[];
}
export interface HeadingBlock {
  type: 'heading';
  level: number;
  spans: InlineSpan[];
}
export interface ListItem {
  blocks: Block[];
  task: 'checked' | 'unchecked' | null;
}
export interface ListBlock {
  type: 'list';
  ordered: boolean;
  start: number;
  tight: boolean;
  items: ListItem[];
}
export interface QuoteBlock {
  type: 'quote';
  blocks: Block[];
}
export interface CodeBlockNode {
  type: 'code';
  language: string;
  code: string;
  closed: boolean;
}
export interface MathBlockNode {
  type: 'math_block';
  latex: string;
}
export interface TableBlock {
  type: 'table';
  align: Align[];
  header: InlineSpan[][];
  rows: InlineSpan[][][];
}
export interface RuleBlock {
  type: 'rule';
}
export interface FootnoteDefinition {
  label: string;
  id: number;
  blocks: Block[];
}
export interface UnsupportedBlock {
  type: 'unsupported';
  source: string;
}

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | QuoteBlock
  | CodeBlockNode
  | MathBlockNode
  | TableBlock
  | RuleBlock
  | UnsupportedBlock;

export interface MarkdownDocument {
  blocks: Block[];
  footnotes: FootnoteDefinition[];
  /** True while a fence or math delimiter is still open. */
  provisional: boolean;
}

const MAX_BLOCKS = 900;
const MAX_INLINE = 20_000;
const MAX_MATH_BLOCK_LINES = 400;
const MAX_MATH_BLOCK_CHARS = 64 * 1024;
const MAX_INLINE_MATH_CHARS = 4096;

function makeMarkdown(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
    typographer: false,
  });
  md.use(footnote);

  // Display math: $$ ... $$ on their own lines, or \[ ... \].
  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(start, max).trim();
    let close: string | null = null;
    let first: string | null = null;
    if (line.startsWith('$$')) {
      close = '$$';
      first = line.slice(2);
    } else if (line.startsWith('\\[')) {
      close = '\\]';
      first = line.slice(2);
    }
    if (!close || first === null) return false;
    if (first.trim().endsWith(close)) {
      if (silent) return true;
      state.line = startLine + 1;
      const token = state.push('math_block', 'math', 0);
      token.content = first.trim().slice(0, -close.length).trim();
      token.map = [startLine, state.line];
      return true;
    }
    let nextLine = startLine + 1;
    const body: string[] = first.trim() ? [first] : [];
    let found = false;
    let chars = first.length;
    const lineLimit = Math.min(endLine, startLine + 1 + MAX_MATH_BLOCK_LINES);
    for (; nextLine < lineLimit; nextLine += 1) {
      const begin = state.bMarks[nextLine] + state.tShift[nextLine];
      const end = state.eMarks[nextLine];
      const text = state.src.slice(begin, end);
      chars += end - begin;
      if (chars > MAX_MATH_BLOCK_CHARS) break;
      if (text.trim().endsWith(close)) {
        const trimmed = text.trim();
        body.push(trimmed.slice(0, -close.length));
        found = true;
        break;
      }
      body.push(text);
    }
    if (silent) return found;
    if (!found) return false;
    state.line = nextLine + 1;
    const token = state.push('math_block', 'math', 0);
    token.content = body.join('\n').trim();
    token.map = [startLine, state.line];
    return true;
  });

  // Inline math: $...$, \(...\). Currency stays currency: a closing dollar
  // after whitespace or with an empty body is not a formula.
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    const src = state.src;
    if (src[start] === '\\' && src[start + 1] === '(') {
      const end = src.indexOf('\\)', start + 2);
      if (end === -1 || end - start - 2 > MAX_INLINE_MATH_CHARS) return false;
      const latex = src.slice(start + 2, end).trim();
      if (!latex || silent) return latex.length > 0;
      const token = state.push('math_inline', 'math', 0);
      token.content = latex;
      state.pos = end + 2;
      return true;
    }
    if (src[start] !== '$' || src[start - 1] === '\\') return false;
    const next = src[start + 1];
    if (!next || /\s/.test(next) || next === '$') return false;
    let end = start + 1;
    const limit = Math.min(src.length, start + 1 + MAX_INLINE_MATH_CHARS);
    while (end < limit) {
      if (src[end] === '\\') {
        end += 2;
        continue;
      }
      if (src[end] === '$') break;
      end += 1;
    }
    if (end >= limit) return false;
    const body = src.slice(start + 1, end);
    if (!body.trim() || /\s$/.test(body)) return false;
    if (silent) return true;
    const token = state.push('math_inline', 'math', 0);
    token.content = body;
    state.pos = end + 1;
    return true;
  });

  return md;
}

const markdown = makeMarkdown();

function findClose(
  tokens: Token[],
  openIndex: number,
  openType: string,
  closeType: string,
): number {
  const level = tokens[openIndex].level;
  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index].type === closeType && tokens[index].level === level) return index;
    if (tokens[index].type === openType && tokens[index].level < level) break;
  }
  return tokens.length - 1;
}

function spanContainer(
  type: 'strong' | 'em' | 'strike',
  children: InlineSpan[],
): StrongSpan | EmSpan | StrikeSpan {
  return { type, children };
}

function parseLinkAttrs(token: Token): string {
  return token.attrGet('href') ?? '';
}

function parseInlines(tokens: Token[] | null | undefined): InlineSpan[] {
  if (!tokens) return [];
  const root: InlineSpan[] = [];
  const stack: InlineSpan[][] = [root];
  let count = 0;
  for (const token of tokens) {
    if (count >= MAX_INLINE) break;
    count += 1;
    const top = stack[stack.length - 1];
    if (token.type === 'text') {
      top.push({ type: 'text', text: token.content });
    } else if (token.type === 'code_inline') {
      top.push({ type: 'code', text: token.content });
    } else if (token.type === 'softbreak') {
      top.push({ type: 'break', hard: false });
    } else if (token.type === 'hardbreak') {
      top.push({ type: 'break', hard: true });
    } else if (token.type === 'strong_open') {
      const node = spanContainer('strong', []);
      top.push(node);
      stack.push(node.children);
    } else if (token.type === 'em_open') {
      const node = spanContainer('em', []);
      top.push(node);
      stack.push(node.children);
    } else if (token.type === 's_open') {
      const node = spanContainer('strike', []);
      top.push(node);
      stack.push(node.children);
    } else if (
      token.type === 'strong_close' ||
      token.type === 'em_close' ||
      token.type === 's_close'
    ) {
      if (stack.length > 1) {
        stack.pop();
      }
    } else if (token.type === 'link_open') {
      const node: LinkSpan = { type: 'link', href: parseLinkAttrs(token), children: [] };
      top.push(node);
      stack.push(node.children);
    } else if (token.type === 'link_close') {
      if (stack.length > 1) {
        stack.pop();
      }
    } else if (token.type === 'image') {
      top.push({
        type: 'image',
        src: token.attrGet('src') ?? '',
        alt: token.content ?? token.attrGet('alt') ?? '',
        title: token.attrGet('title'),
      });
    } else if (token.type === 'math_inline') {
      top.push({ type: 'math_inline', latex: token.content });
    } else if (token.type === 'footnote_ref') {
      const label = token.meta?.label ?? token.content ?? '';
      const id = typeof token.meta?.id === 'number' ? token.meta.id + 1 : 1;
      top.push({ type: 'footnote_ref', label: String(label), id });
    } else if (token.type === 'html_inline') {
      // Raw HTML is never executable message content.
      top.push({ type: 'text', text: token.content });
    } else if (token.content) {
      top.push({ type: 'text', text: token.content });
    }
  }
  return root;
}

function parseBlocks(
  tokens: Token[],
  from: number,
  to: number,
  sourceLines: string[] = [],
): Block[] {
  const blocks: Block[] = [];
  let index = from;
  while (index < to && blocks.length < MAX_BLOCKS) {
    const token = tokens[index];
    switch (token.type) {
      case 'paragraph_open': {
        const inline = tokens[index + 1];
        blocks.push({ type: 'paragraph', spans: parseInlines(inline?.children) });
        index += 3;
        break;
      }
      case 'inline': {
        blocks.push({ type: 'paragraph', spans: parseInlines(token.children) });
        index += 1;
        break;
      }
      case 'heading_open': {
        const inline = tokens[index + 1];
        blocks.push({
          type: 'heading',
          level: Number(token.tag.replace('h', '')) || 1,
          spans: parseInlines(inline?.children),
        });
        index += 3;
        break;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const closeType = token.type === 'bullet_list_open' ? 'bullet_list_close' : 'ordered_list_close';
        const close = findClose(tokens, index, token.type, closeType);
        const items: ListItem[] = [];
        let cursor = index + 1;
        while (cursor < close) {
          if (tokens[cursor].type === 'list_item_open') {
            const itemClose = findClose(tokens, cursor, 'list_item_open', 'list_item_close');
            const blocksInItem = parseBlocks(tokens, cursor + 1, itemClose, sourceLines);
            let task: ListItem['task'] = null;
            const first = blocksInItem[0];
            if (first?.type === 'paragraph') {
              const textSpan = first.spans[0];
              if (textSpan?.type === 'text') {
                const match = /^\[([ xX])\]\s+/.exec(textSpan.text);
                if (match) {
                  task = match[1].toLowerCase() === 'x' ? 'checked' : 'unchecked';
                  const rest = textSpan.text.slice(match[0].length);
                  first.spans = [
                    ...(rest ? [{ type: 'text' as const, text: rest }] : []),
                    ...first.spans.slice(1),
                  ];
                }
              }
            }
            items.push({ blocks: blocksInItem, task });
            cursor = itemClose + 1;
          } else {
            cursor += 1;
          }
        }
        blocks.push({
          type: 'list',
          ordered: token.type === 'ordered_list_open',
          // `start="0"` is valid and must not collapse to 1 (TXT-3).
          start: listStart(token),
          tight: token.hidden,
          items,
        });
        index = close + 1;
        break;
      }
      case 'blockquote_open': {
        const close = findClose(tokens, index, 'blockquote_open', 'blockquote_close');
        blocks.push({
          type: 'quote',
          blocks: parseBlocks(tokens, index + 1, close, sourceLines),
        });
        index = close + 1;
        break;
      }
      case 'fence':
      case 'code_block': {
        blocks.push({
          type: 'code',
          language: (token.info ?? '').trim().split(/\s+/)[0] ?? '',
          code: token.content,
          // A fence nested in a quote or list can still be unfinished; report
          // the real state instead of claiming it closed (TXT-3).
          closed: token.type === 'fence' ? fenceIsClosed(sourceLines, token) : true,
        });
        index += 1;
        break;
      }
      case 'math_block': {
        blocks.push({ type: 'math_block', latex: token.content });
        index += 1;
        break;
      }
      case 'table_open': {
        const close = findClose(tokens, index, 'table_open', 'table_close');
        const header: InlineSpan[][] = [];
        const rows: InlineSpan[][][] = [];
        const align: Align[] = [];
        let cursor = index + 1;
        let current: InlineSpan[][] | null = null;
        while (cursor < close) {
          const item = tokens[cursor];
          if (item.type === 'thead_open') current = header;
          else if (item.type === 'tbody_open') current = null;
          else if (item.type === 'tr_open') {
            if (current === null) {
              current = [];
            }
          } else if (item.type === 'tr_close') {
            if (current && current !== header) rows.push(current);
            current = null;
          } else if (item.type === 'th_open' || item.type === 'td_open') {
            const inline = tokens[cursor + 1];
            const cell = parseInlines(inline?.children);
            const style = item.attrGet('style') ?? '';
            if (!align[header.length - 1]) {
              align.push(
                style.includes('text-align:right')
                  ? 'right'
                  : style.includes('text-align:center')
                    ? 'center'
                    : 'left',
              );
            }
            if (current) current.push(cell);
          }
          cursor += 1;
        }
        blocks.push({ type: 'table', header, rows, align });
        index = close + 1;
        break;
      }
      case 'hr':
        blocks.push({ type: 'rule' });
        index += 1;
        break;
      case 'html_block':
      case 'html_inline':
        blocks.push({ type: 'unsupported', source: token.content });
        index += 1;
        break;
      case 'footnote_block_open': {
        // Definitions belong to the footnote section only. Skipping just the
        // markers made every definition paragraph render twice (TXT-3).
        const close = findClose(tokens, index, 'footnote_block_open', 'footnote_block_close');
        index = close + 1;
        break;
      }
      case 'footnote_open': {
        const close = findClose(tokens, index, 'footnote_open', 'footnote_close');
        index = close + 1;
        break;
      }
      case 'footnote_block_close':
      case 'footnote_close':
      case 'footnote_anchor':
      case 'footnote_label':
        index += 1;
        break;
      default:
        index += 1;
        break;
    }
  }
  return blocks;
}

function parseFootnotes(tokens: Token[], sourceLines: string[] = []): FootnoteDefinition[] {
  const definitions: FootnoteDefinition[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'footnote_open') continue;
    const close = findClose(tokens, index, 'footnote_open', 'footnote_close');
    const openMeta = tokens[index].meta as { label?: string; id?: number } | null;
    let label = typeof openMeta?.label === 'string' ? openMeta.label : '';
    let id =
      typeof openMeta?.id === 'number' ? openMeta.id + 1 : definitions.length + 1;
    for (let cursor = index + 1; cursor < close; cursor += 1) {
      if (tokens[cursor].type === 'footnote_label') {
        label = tokens[cursor].content;
        id =
          typeof tokens[cursor].meta?.id === 'number'
            ? tokens[cursor].meta.id + 1
            : id;
        break;
      }
    }
    definitions.push({
      label,
      id,
      blocks: parseBlocks(tokens, index + 1, close, sourceLines),
    });
  }
  return definitions;
}

export function parseMarkdown(source: string): MarkdownDocument {
  const tokens = markdown.parse(source, {});
  const sourceLines = source.split('\n');
  const blocks = parseBlocks(tokens, 0, tokens.length, sourceLines);
  const footnotes = parseFootnotes(tokens, sourceLines);
  const fenceClosed = !hasUnclosedFence(blocks);
  const provisional =
    !fenceClosed || (source.match(/\$\$/g)?.length ?? 0) % 2 !== 0;
  return { blocks, footnotes, provisional };
}

function hasUnclosedFence(blocks: Block[]): boolean {
  for (const block of blocks) {
    if (block.type === 'code' && !block.closed) return true;
    if (block.type === 'quote' && hasUnclosedFence(block.blocks)) return true;
    if (block.type === 'list') {
      for (const item of block.items) {
        if (hasUnclosedFence(item.blocks)) return true;
      }
    }
  }
  return false;
}

function listStart(token: Token): number {
  const raw = token.attrGet('start');
  if (raw === null || raw === undefined || raw === '') return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

/** Check the real closing line, including blockquote/list prefixes. */
function fenceIsClosed(lines: string[], token: Token): boolean {
  if (!token.map) return false;
  const closing = lines[token.map[1] - 1] ?? '';
  const marker = (token.markup ?? '```').trim();
  if (!marker) return false;
  const stripped = closing
    .replace(/^\s*(?:>\s*)*/, '')
    .replace(/^\s*/, '');
  return stripped.startsWith(marker);
}

/** Readable projection used by Copy text; exact source stays separate. */
export function inlineToText(spans: InlineSpan[]): string {
  return spans
    .map((span) => {
      switch (span.type) {
        case 'text':
          return span.text;
        case 'code':
          return span.text;
        case 'strong':
        case 'em':
        case 'strike':
          return inlineToText(span.children);
        case 'link':
          return inlineToText(span.children);
        case 'image':
          return span.alt || 'image';
        case 'math_inline':
          return `$${span.latex}$`;
        case 'footnote_ref':
          return `[${span.id}]`;
        case 'break':
          return '\n';
        default:
          return '';
      }
    })
    .join('');
}

export function blockToText(block: Block, depth = 0): string {
  switch (block.type) {
    case 'paragraph':
      return inlineToText(block.spans);
    case 'heading':
      return inlineToText(block.spans);
    case 'list':
      return block.items
        .map((item, index) => {
          const marker = block.ordered ? `${block.start + index}. ` : '- ';
          const content = item.blocks.map((entry) => blockToText(entry, depth + 1)).join(' ');
          return `${'  '.repeat(depth)}${marker}${content}`;
        })
        .join('\n');
    case 'quote':
      return block.blocks.map((entry) => blockToText(entry, depth + 1)).join('\n');
    case 'code':
      return block.code;
    case 'math_block':
      return block.latex;
    case 'table':
      return [
        block.header.map(inlineToText).join(' | '),
        ...block.rows.map((row) => row.map(inlineToText).join(' | ')),
      ].join('\n');
    case 'rule':
      return '';
    case 'unsupported':
      return block.source;
    default:
      return '';
  }
}

export function markdownToText(source: string): string {
  return parseMarkdown(source).blocks.map((block) => blockToText(block)).join('\n\n');
}
