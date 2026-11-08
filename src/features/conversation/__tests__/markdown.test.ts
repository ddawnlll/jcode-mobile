import { parseMarkdown } from '../Markdown';

describe('parseMarkdown', () => {
  it('separates paragraphs, headings, and lists', () => {
    const blocks = parseMarkdown('# Title\n\nFirst line\nsecond line.\n\n- one\n- two\n\n1. first\n2. second');
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: 'Title' });
    expect(blocks[1]).toMatchObject({ type: 'paragraph', text: 'First line\nsecond line.' });
    expect(blocks[2]).toEqual({ type: 'list', ordered: false, items: ['one', 'two'] });
    expect(blocks[3]).toEqual({ type: 'list', ordered: true, items: ['first', 'second'] });
  });

  it('keeps a code fence closed only when the fence actually closes', () => {
    const open = parseMarkdown('text\n```ts\nconst a = 1;');
    expect(open[1]).toMatchObject({ type: 'code', language: 'ts', closed: false });
    const closed = parseMarkdown('```ts\nconst a = 1;\n```');
    expect(closed[0]).toMatchObject({ type: 'code', language: 'ts', closed: true });
    expect(closed[0].type === 'code' && closed[0].code).toBe('const a = 1;');
  });

  it('renders an unterminated fence as readable plain code', () => {
    const blocks = parseMarkdown('```\nGET /health\n');
    expect(blocks[0]).toMatchObject({ type: 'code', closed: false, code: 'GET /health\n' });
  });

  it('treats a table separator as a table header', () => {
    const blocks = parseMarkdown('| Step | State |\n| --- | --- |\n| Build | Done |');
    expect(blocks[0]).toMatchObject({ type: 'table', header: ['Step', 'State'] });
    if (blocks[0].type === 'table') expect(blocks[0].rows).toEqual([['Build', 'Done']]);
  });

  it('does not treat a stray pipe as a table', () => {
    const blocks = parseMarkdown('a | b\nnot a separator');
    expect(blocks.every((block) => block.type !== 'table')).toBe(true);
  });

  it('bounds work for very large content', () => {
    const huge = Array.from({ length: 2000 }, (_, index) => `paragraph ${index}`).join('\n\n');
    expect(parseMarkdown(huge).length).toBeLessThanOrEqual(600);
  });
});
