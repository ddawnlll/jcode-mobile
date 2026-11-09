import { markdownToText, parseMarkdown } from '../Markdown';
import { mathToText } from '../markdown/MathView';
import { highlightCode } from '../markdown/highlight';

describe('parseMarkdown', () => {
  it('separates paragraphs, headings, and lists', () => {
    const document = parseMarkdown(
      '# Title\n\nFirst line\nsecond line.\n\n- one\n- two\n\n1. first\n2. second',
    );
    expect(document.blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(document.blocks[1]).toMatchObject({ type: 'paragraph' });
    expect(document.blocks[2]).toMatchObject({ type: 'list', ordered: false });
    expect(document.blocks[3]).toMatchObject({ type: 'list', ordered: true });
    expect(markdownToText('# Title\n\n- one\n- two')).toContain('- one');
  });

  it('keeps nested list indentation and task state', () => {
    const document = parseMarkdown('- [x] done\n  - child\n- [ ] todo');
    const list = document.blocks[0];
    expect(list.type).toBe('list');
    if (list.type !== 'list') return;
    expect(list.items[0].task).toBe('checked');
    expect(list.items[1].task).toBe('unchecked');
    const child = list.items[0].blocks.find((block) => block.type === 'list');
    expect(child).toMatchObject({ type: 'list', ordered: false });
  });

  it('keeps a code fence closed only when the fence actually closes', () => {
    const open = parseMarkdown('text\n```ts\nconst a = 1;');
    const openCode = open.blocks.find((block) => block.type === 'code');
    expect(openCode).toMatchObject({ type: 'code', language: 'ts', closed: false });
    expect(open.provisional).toBe(true);
    const closed = parseMarkdown('```ts\nconst a = 1;\n```');
    expect(closed.blocks[0]).toMatchObject({ type: 'code', language: 'ts', closed: true });
    expect(closed.blocks[0].type === 'code' && closed.blocks[0].code.trim()).toBe('const a = 1;');
  });

  it('treats a table separator as a table header', () => {
    const document = parseMarkdown('| Step | State |\n| --- | --- |\n| Build | Done |');
    expect(document.blocks[0]).toMatchObject({ type: 'table' });
    if (document.blocks[0].type === 'table') {
      expect(document.blocks[0].header).toHaveLength(2);
      expect(document.blocks[0].rows[0]).toHaveLength(2);
    }
  });

  it('parses inline and display math without treating currency as a formula', () => {
    const document = parseMarkdown('Costs $20 USDT and $30. Formula $x^2$.\n\n$$\n\\frac{a}{b}\n$$');
    const text = markdownToText('Costs $20 USDT and $30. Formula $x^2$.');
    expect(text).toContain('$20 USDT and $30');
    expect(text).toContain('$x^2$');
    expect(document.blocks.some((block) => block.type === 'math_block')).toBe(true);
    expect(mathToText('\\frac{a}{b}')).toBe('(a)/(b)');
  });

  it('supports footnotes and malformed raw HTML', () => {
    const document = parseMarkdown('Text[^1]\n\n[^1]: Footnote body\n\n<script>alert(1)</script>');
    expect(document.footnotes).toHaveLength(1);
    expect(document.blocks.some((block) => block.type === 'unsupported')).toBe(true);
  });

  it('tokenizes a bounded practical language set only', () => {
    const lines = highlightCode('const answer = 42;', 'ts');
    expect(lines && lines[0].segments.length).toBeGreaterThan(0);
    expect(highlightCode('const answer = 42;', 'brainfuck')).toBeNull();
  });

  it('bounds work for very large content', () => {
    const huge = Array.from({ length: 2000 }, (_, index) => `paragraph ${index}`).join('\n\n');
    expect(parseMarkdown(huge).blocks.length).toBeLessThanOrEqual(900);
  });
});
