import React, { memo, useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '../../design/typography';
import { useTheme } from '../../design/theme';
import { radius, space } from '../../design/tokens';
import { CodeBlock } from './CodeBlock';
import { MathBlock, MathInline } from './markdown/MathView';
import { MessageImage } from './markdown/MessageImage';
import {
  parseMarkdown,
  type Block,
  type FootnoteDefinition,
  type InlineSpan,
} from './markdown/parse';
import type { MessageImage as MessageImageData } from '../../core/protocol/frames';

function openLink(href: string): void {
  if (!/^(https?:|mailto:)/i.test(href)) return;
  void Linking.openURL(href).catch(() => undefined);
}

function Inline({
  spans,
  emphasis = false,
}: {
  spans: InlineSpan[];
  emphasis?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const nodes = spans.map((span, index) => {
    switch (span.type) {
      case 'text':
        return <Text key={index} variant="body">{span.text}</Text>;
      case 'strong':
        return (
          <Text key={index} variant="body" weight="semibold">
            <Inline spans={span.children} emphasis />
          </Text>
        );
      case 'em':
        return (
          <Text key={index} variant="body" style={{ fontStyle: 'italic' }}>
            <Inline spans={span.children} emphasis />
          </Text>
        );
      case 'strike':
        return (
          <Text key={index} variant="body" style={{ textDecorationLine: 'line-through' }}>
            <Inline spans={span.children} emphasis />
          </Text>
        );
      case 'code':
        return (
          <Text
            key={index}
            variant="code"
            style={{ backgroundColor: colors.raised, color: colors.ink }}
          >
            {span.text}
          </Text>
        );
      case 'link':
        return (
          <Text
            key={index}
            variant="body"
            accessibilityRole="link"
            accessibilityLabel={`Open link ${span.href}`}
            onPress={() => openLink(span.href)}
            style={{ color: colors.brand, textDecorationLine: 'underline' }}
          >
            <Inline spans={span.children} emphasis />
          </Text>
        );
      case 'image':
        return (
          <Text key={index} variant="caption" color="muted">
            {`[Image: ${span.alt || span.src}]`}
          </Text>
        );
      case 'math_inline':
        return <MathInline key={index} latex={span.latex} />;
      case 'footnote_ref':
        return (
          <Text
            key={index}
            variant="caption"
            color="brand"
            accessibilityLabel={`Footnote ${span.id}`}
          >
            {`[${span.id}]`}
          </Text>
        );
      case 'break':
        return <Text key={index} variant="body">{'\n'}</Text>;
      default:
        return null;
    }
  });
  return <>{nodes}</>;
}

function paragraphImages(spans: InlineSpan[]): string[] {
  return spans.flatMap((span) => (span.type === 'image' ? [span.src] : []));
}

function Paragraph({ block }: { block: Extract<Block, { type: 'paragraph' }> }) {
  const images = paragraphImages(block.spans);
  return (
    <View style={{ marginTop: space.sm }}>
      <Text variant="body">
        <Inline spans={block.spans.filter((span) => span.type !== 'image')} />
      </Text>
      {images.map((src, index) => (
        <MessageImage
          key={`${src}-${index}`}
          image={{ media_type: 'image/*', data: '', uri: src, alt: src }}
        />
      ))}
    </View>
  );
}

function ListBlockView({
  block,
  footnotes,
}: {
  block: Extract<Block, { type: 'list' }>;
  footnotes: FootnoteDefinition[];
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: space.sm }}>
      {block.items.map((item, index) => (
        <View key={index} style={styles.listItem}>
          <View style={styles.marker}>
            {item.task ? (
              <View
                style={[
                  styles.taskBox,
                  {
                    borderColor: item.task === 'checked' ? colors.brand : colors.control,
                    backgroundColor: item.task === 'checked' ? colors.brand : 'transparent',
                  },
                ]}
              >
                {item.task === 'checked' ? (
                  <Text variant="caption" style={{ color: colors.onBrand, lineHeight: 13 }}>
                    ✓
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text variant="body" color="muted">
                {block.ordered ? `${block.start + index}.` : '•'}
              </Text>
            )}
          </View>
          <View style={styles.listBody}>
            {item.blocks.map((child, childIndex) => (
              <BlockView key={childIndex} block={child} footnotes={footnotes} depth={1} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function TableBlockView({ block }: { block: Extract<Block, { type: 'table' }> }) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      style={{ marginTop: space.sm }}
      contentContainerStyle={{ minWidth: '100%' }}
    >
      <View style={[styles.table, { borderColor: colors.line }]} testID="markdown-table">
        <View style={[styles.tableRow, { backgroundColor: colors.raised }]}>
          {block.header.map((cell, index) => (
            <View
              key={index}
              style={[
                styles.tableCell,
                { borderLeftColor: colors.line, alignItems: alignFor(block.align[index]) },
              ]}
            >
              <Text variant="small" weight="semibold">
                <Inline spans={cell} />
              </Text>
            </View>
          ))}
        </View>
        {block.rows.map((row, rowIndex) => (
          <View
            key={rowIndex}
            style={[styles.tableRow, { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            {block.header.map((_, cellIndex) => (
              <View
                key={cellIndex}
                style={[
                  styles.tableCell,
                  {
                    borderLeftColor: colors.line,
                    alignItems: alignFor(block.align[cellIndex]),
                  },
                ]}
              >
                <Text variant="small">
                  <Inline spans={row[cellIndex] ?? []} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function alignFor(align: string | null): 'flex-start' | 'center' | 'flex-end' {
  return align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start';
}

function FootnoteSection({ footnotes }: { footnotes: FootnoteDefinition[] }) {
  const { colors } = useTheme();
  if (footnotes.length === 0) return null;
  return (
    <View style={[styles.footnotes, { borderTopColor: colors.line }]}>
      <Text variant="caption" color="muted" style={{ marginBottom: space.xxs }}>
        Footnotes
      </Text>
      {footnotes.map((note) => (
        <View key={`${note.label}-${note.id}`} style={styles.footnoteRow} testID={`footnote-${note.id}`}>
          <Text variant="caption" color="brand" style={{ minWidth: 22 }}>
            [{note.id}]
          </Text>
          <View style={{ flex: 1 }}>
            {note.blocks.map((block, index) => (
              <BlockView key={index} block={block} footnotes={[]} depth={1} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function BlockView({
  block,
  footnotes,
  depth = 0,
}: {
  block: Block;
  footnotes: FootnoteDefinition[];
  depth?: number;
}): React.ReactElement | null {
  const { colors } = useTheme();
  switch (block.type) {
    case 'paragraph':
      return <Paragraph block={block} />;
    case 'heading': {
      const variant = block.level <= 1 ? 'title' : block.level === 2 ? 'subhead' : 'body';
      return (
        <Text
          variant={variant}
          weight="semibold"
          style={{ marginTop: block.level <= 2 ? space.lg : space.md }}
        >
          <Inline spans={block.spans} />
        </Text>
      );
    }
    case 'list':
      return <ListBlockView block={block} footnotes={footnotes} />;
    case 'quote':
      return (
        <View
          style={[
            styles.quote,
            { borderLeftColor: colors.accent, backgroundColor: colors.accentSoft },
          ]}
        >
          {block.blocks.map((child, index) => (
            <BlockView key={index} block={child} footnotes={footnotes} depth={depth + 1} />
          ))}
        </View>
      );
    case 'code':
      return <CodeBlock code={block.code} language={block.language} closed={block.closed} />;
    case 'math_block':
      return <MathBlock latex={block.latex} />;
    case 'table':
      return <TableBlockView block={block} />;
    case 'rule':
      return <View style={[styles.rule, { backgroundColor: colors.line }]} />;
    case 'unsupported':
      return (
        <View style={[styles.unsupported, { borderColor: colors.line }]}>
          <Text variant="caption" color="muted">
            Raw HTML is shown as text, never executed
          </Text>
          <Text variant="code" selectable>
            {block.source}
          </Text>
        </View>
      );
    default:
      return null;
  }
}

export const RichMarkdown = memo(function RichMarkdown({
  content,
  streaming = false,
  extraImages = [],
}: {
  content: string;
  streaming?: boolean;
  extraImages?: MessageImageData[];
}) {
  const document = useMemo(() => parseMarkdown(content), [content]);
  return (
    <View testID="rich-markdown">
      {document.blocks.map((block, index) => (
        <BlockView key={index} block={block} footnotes={document.footnotes} />
      ))}
      {extraImages.map((image, index) => (
        <MessageImage key={index} image={image} />
      ))}
      <FootnoteSection footnotes={document.footnotes} />
      {streaming && document.provisional ? (
        <Text variant="caption" color="muted" style={{ marginTop: space.xs }}>
          Still being written…
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  listItem: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 },
  marker: { width: 24, alignItems: 'flex-start', paddingTop: 2 },
  taskBox: {
    width: 16,
    height: 16,
    borderWidth: 1.5,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
  },
  listBody: { flex: 1 },
  quote: {
    borderLeftWidth: 2,
    borderRadius: radius.control,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    marginTop: space.sm,
  },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.control, overflow: 'hidden' },
  tableRow: { flexDirection: 'row' },
  tableCell: {
    minWidth: 140,
    maxWidth: 240,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderLeftWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: space.md },
  footnotes: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.lg, paddingTop: space.sm },
  footnoteRow: { flexDirection: 'row', marginTop: space.xxs },
  unsupported: { borderWidth: 1, borderRadius: radius.control, padding: space.sm, marginTop: space.sm, gap: space.xxs },
});
