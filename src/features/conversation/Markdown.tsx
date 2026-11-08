import React, { memo } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Text } from '../../design/typography';
import { useTheme } from '../../design/theme';
import { radius, space } from '../../design/tokens';
import { CodeBlock } from './CodeBlock';

export type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language: string; code: string; closed: boolean }
  | { type: 'quote'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'rule' };

const MAX_BLOCKS = 600;

/** Block-level Markdown for assistant prose. Deliberately small and bounded. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let code: { language: string; lines: string[]; closed: boolean } | null = null;
  let table: { header: string[]; rows: string[][] } | null = null;
  let skipTableSeparator = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push({ type: 'quote', text: quote.join(' ').trim() });
    quote = [];
  };
  const flushTable = () => {
    if (!table) return;
    blocks.push({ type: 'table', header: table.header, rows: table.rows });
    table = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
    flushTable();
  };

  for (const raw of lines) {
    if (blocks.length >= MAX_BLOCKS) break;
    const line = raw.replace(/\t/g, '    ');
    if (skipTableSeparator) {
      skipTableSeparator = false;
      continue;
    }
    if (code) {
      if (line.trim().startsWith('```')) {
        blocks.push({ type: 'code', language: code.language, code: code.lines.join('\n'), closed: true });
        code = null;
      } else {
        code.lines.push(raw);
      }
      continue;
    }
    const fence = /^\s*```([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (fence) {
      flushAll();
      code = { language: fence[1] || '', lines: [], closed: false };
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flushAll();
      blocks.push({ type: 'rule' });
      continue;
    }
    const quoteLine = /^>\s?(.*)$/.exec(line);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }
    if (line.includes('|') && /^\s*\|?.+\|.+\|?\s*$/.test(line)) {
      const cells = splitRow(line);
      const next = lines[lines.indexOf(raw) + 1] ?? '';
      if (!table && cells.length > 1) {
        const separator = splitRow(next);
        if (separator.length === cells.length && separator.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))) {
          flushAll();
          table = { header: cells, rows: [] };
          skipTableSeparator = true;
          continue;
        }
      }
      if (table) {
        table.rows.push(cells);
        continue;
      }
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      flushTable();
      const isOrdered = !!ordered;
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((bullet ? bullet[1] : ordered![2]).trim());
      continue;
    }
    flushQuote();
    flushTable();
    flushList();
    paragraph.push(line);
  }
  if (code) blocks.push({ type: 'code', language: code.language, code: code.lines.join('\n'), closed: false });
  flushAll();
  return blocks;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function openLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  void Linking.openURL(url).catch(() => undefined);
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)\s]+\))/g;

function Inline({ text }: { text: string }) {
  const { colors } = useTheme();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  let key = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      parts.push(
        <Text key={key++} weight="semibold">
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith('`')) {
      parts.push(
        <Text
          key={key++}
          variant="code"
          style={{ backgroundColor: colors.raised, color: colors.ink }}
        >
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith('*') || token.startsWith('_')) {
      parts.push(
        <Text key={key++} style={{ fontStyle: 'italic' }}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (link) {
        parts.push(
          <Text
            key={key++}
            style={{ color: colors.brand, textDecorationLine: 'underline' }}
            onPress={() => openLink(link[2])}
            accessibilityRole="link"
          >
            {link[1]}
          </Text>,
        );
      } else {
        parts.push(token);
      }
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  const { colors } = useTheme();
  const blocks = React.useMemo(() => parseMarkdown(content), [content]);
  return (
    <View>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'paragraph':
            return (
              <Text key={index} variant="body" style={{ marginTop: index === 0 ? 0 : space.sm }}>
                <Inline text={block.text} />
              </Text>
            );
          case 'heading':
            return (
              <Text
                key={index}
                variant={block.level <= 2 ? 'subhead' : 'body'}
                weight="semibold"
                style={{ marginTop: index === 0 ? 0 : space.md }}
              >
                <Inline text={block.text} />
              </Text>
            );
          case 'list':
            return (
              <View key={index} style={{ marginTop: index === 0 ? 0 : space.sm }}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.listRow}>
                    <Text variant="body" color="muted" style={styles.marker}>
                      {block.ordered ? `${itemIndex + 1}.` : '•'}
                    </Text>
                    <Text variant="body" style={styles.listText}>
                      <Inline text={item} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'quote':
            return (
              <View
                key={index}
                style={[
                  styles.quote,
                  { borderLeftColor: colors.accent, backgroundColor: colors.accentSoft },
                ]}
              >
                <Text variant="body" style={{ color: colors.onAccent }}>
                  <Inline text={block.text} />
                </Text>
              </View>
            );
          case 'code':
            return (
              <CodeBlock
                key={index}
                code={block.code}
                language={block.language}
                closed={block.closed}
              />
            );
          case 'table':
            return (
              <View key={index} style={[styles.table, { borderColor: colors.line }]}>
                {block.rows.map((row, rowIndex) => (
                  <View key={rowIndex} style={[styles.tableRow, { borderTopColor: colors.line }]}>
                    {row.map((cell, cellIndex) => (
                      <View key={cellIndex} style={styles.tableCell}>
                        <Text variant="caption" color="muted">
                          {block.header[cellIndex] ?? ''}
                        </Text>
                        <Text variant="body">
                          <Inline text={cell} />
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            );
          case 'rule':
            return <View key={index} style={[styles.rule, { backgroundColor: colors.line }]} />;
          default:
            return null;
        }
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  listRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 },
  marker: { width: 22 },
  listText: { flex: 1 },
  quote: {
    borderLeftWidth: 2,
    borderRadius: radius.control,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    marginTop: space.sm,
  },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.control, marginTop: space.sm },
  tableRow: { borderTopWidth: StyleSheet.hairlineWidth, padding: space.sm },
  tableCell: { marginBottom: space.xs },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: space.md },
});
