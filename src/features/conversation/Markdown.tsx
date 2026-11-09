/**
 * Compatibility entry point. The 0.2.0 renderer lives in RichMarkdown and the
 * typed parser under ./markdown. The old handwritten block parser is gone.
 */
export { RichMarkdown as Markdown } from './RichMarkdown';
export { parseMarkdown, markdownToText } from './markdown/parse';
export type { Block, InlineSpan, MarkdownDocument } from './markdown/parse';
