import React, { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { Text } from '../../design/typography';
import { useTheme } from '../../design/theme';
import { radius, space, target } from '../../design/tokens';
import { CopyIcon } from '../../design/icons';
import { highlightCode, supportedLanguage } from './markdown/highlight';

const MAX_CODE_CHARS = 64 * 1024;
const PREVIEW_LINES = 24;

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  closed,
}: {
  code: string;
  language: string;
  closed: boolean;
}) {
  const { colors } = useTheme();
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);
  const trimmed = code.length > MAX_CODE_CHARS ? code.slice(0, MAX_CODE_CHARS) : code;
  const omittedBytes = code.length - trimmed.length;
  const allLines = trimmed.split('\n');
  const previewLines = full ? allLines : allLines.slice(0, PREVIEW_LINES);
  const hiddenLines = allLines.length - previewLines.length;
  const resolved = supportedLanguage(language);
  const tokens = useMemo(
    () => (closed && resolved ? highlightCode(trimmed, language) : null),
    [closed, language, resolved, trimmed],
  );
  const shownTokens = tokens ? tokens.slice(0, previewLines.length) : null;

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const roleColor = (role: string): string => {
    switch (role) {
      case 'keyword':
        return colors.syntaxKeyword;
      case 'string':
        return colors.syntaxString;
      case 'number':
        return colors.syntaxNumber;
      case 'comment':
        return colors.syntaxComment;
      case 'punctuation':
        return colors.syntaxPunctuation;
      case 'inserted':
        return colors.syntaxInserted;
      case 'deleted':
        return colors.syntaxDeleted;
      default:
        return colors.ink;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.raised }]} testID="code-block">
      <View style={styles.header}>
        <Text variant="caption" color="muted">
          {language || 'code'}
          {!closed ? ' · writing' : resolved ? '' : ' · plain'}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Wrap lines"
            accessibilityState={{ checked: wrap }}
            onPress={() => setWrap((value) => !value)}
            style={styles.smallAction}
            testID="code-wrap"
          >
            <Text variant="caption" color={wrap ? 'brand' : 'muted'}>
              Wrap
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={full ? 'Collapse code' : 'Open full code view'}
            onPress={() => setFull((value) => !value)}
            style={styles.smallAction}
            testID="code-full"
          >
            <Text variant="caption" color={full ? 'brand' : 'muted'}>
              {full ? 'Collapse' : 'Full view'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied code' : 'Copy code'}
            onPress={() => void copy()}
            style={styles.smallAction}
            testID="code-copy"
          >
            <CopyIcon size={18} color={colors.muted} />
            <Text variant="caption" color="muted" style={{ marginLeft: 4 }}>
              {copied ? 'Copied' : 'Copy'}
            </Text>
          </Pressable>
        </View>
      </View>
      <ScrollView
        horizontal={!wrap}
        showsHorizontalScrollIndicator={!wrap}
        scrollEnabled={!wrap}
        contentContainerStyle={!wrap ? { minWidth: '100%' } : undefined}
      >
        <View style={styles.codeBody}>
          {previewLines.map((line, index) => (
            <View key={index} style={styles.line}>
              {full ? (
                <Text variant="codeSmall" color="muted" style={styles.lineNumber}>
                  {String(index + 1).padStart(3, ' ')}
                </Text>
              ) : null}
              <Text
                variant="code"
                selectable
                style={[styles.codeLine, { color: colors.ink }]}
              >
                {shownTokens?.[index]?.segments.map((segment, segmentIndex) => (
                  <Text
                    key={segmentIndex}
                    variant="code"
                    style={{ color: roleColor(segment.role) }}
                  >
                    {segment.text}
                  </Text>
                )) ?? (line || ' ')}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
      {!closed ? (
        <Text variant="caption" color="muted" style={{ marginTop: space.xs }}>
          Still being written…
        </Text>
      ) : null}
      {hiddenLines > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show ${hiddenLines} more lines`}
          onPress={() => setFull(true)}
          style={styles.smallAction}
          testID="code-show-more"
        >
          <Text variant="caption" color="brand">
            Show {hiddenLines} more lines
          </Text>
        </Pressable>
      ) : null}
      {omittedBytes > 0 ? (
        <Text variant="caption" color="muted" style={{ marginTop: space.xs }}>
          Preview limited to 64 KiB. Copy copies the full block.
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.control,
    padding: space.sm,
    marginTop: space.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xs,
    gap: space.xs,
    flexWrap: 'wrap',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, flexWrap: 'wrap' },
  smallAction: {
    minHeight: target,
    minWidth: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxs,
  },
  codeBody: { paddingBottom: 2 },
  line: { flexDirection: 'row', alignItems: 'flex-start' },
  lineNumber: { width: 30, opacity: 0.7 },
  codeLine: { paddingBottom: 1 },
});
