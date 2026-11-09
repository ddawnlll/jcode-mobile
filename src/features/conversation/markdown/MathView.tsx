import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { CopyIcon } from '../../../design/icons';
import { useTheme } from '../../../design/theme';
import { radius, space, target } from '../../../design/tokens';
import { Text } from '../../../design/typography';

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  sum: '∑', prod: '∏', int: '∫', oint: '∮', infty: '∞', partial: '∂', nabla: '∇',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', leq: '≤', geq: '≥',
  le: '≤', ge: '≥', lt: '<', gt: '>', ne: '≠',
  neq: '≠', approx: '≈', equiv: '≡', propto: '∝', in: '∈', notin: '∉',
  subset: '⊂', supset: '⊃', cup: '∪', cap: '∩', forall: '∀', exists: '∃',
  rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', iff: '⇔',
  ldots: '…', cdots: '⋯', dots: '…', quad: '\u2003', qquad: '\u2003\u2003',
  sin: 'sin', cos: 'cos', tan: 'tan', log: 'log', ln: 'ln', exp: 'exp',
  lim: 'lim', max: 'max', min: 'min', det: 'det',
};

export function mathToText(latex: string): string {
  let value = latex.trim();
  // Fractions become a readable quotient; nested fractions still flatten.
  for (let depth = 0; depth < 8; depth += 1) {
    const next = value.replace(
      /\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      (_match, numerator: string, denominator: string) => `(${numerator})/(${denominator})`,
    );
    if (next === value) break;
    value = next;
  }
  value = value.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_match, inner: string) => `√(${inner})`);
  value = value.replace(/\\([A-Za-z]+)/g, (match, name: string) => SYMBOLS[name] ?? match);
  // Use ASCII scripts rather than Unicode blocks the bundled mono font does
  // not cover; an unsupported glyph must never become tofu in a transcript.
  value = value.replace(/\^\{([^{}]*)\}/g, (_match, inner: string) => `^(${inner})`);
  value = value.replace(/\^([A-Za-z0-9+\-=()])/g, (_match, char: string) => `^${char}`);
  value = value.replace(/_\{([^{}]*)\}/g, (_match, inner: string) => `_(${inner})`);
  value = value.replace(/_([A-Za-z0-9+\-=()])/g, (_match, char: string) => `_${char}`);
  value = value.replace(/\\begin\{[^{}]+\}|\\end\{[^{}]+\}/g, '');
  value = value.replace(/\\\\/g, ' ');
  value = value.replace(/&/g, ' ');
  value = value.replace(/[{}]/g, '');
  return value.replace(/\s+/g, ' ').trim();
}

export function MathInline({ latex }: { latex: string }) {
  const { colors } = useTheme();
  return (
    <Text
      variant="body"
      accessibilityLabel={`Equation: ${mathToText(latex)}`}
      style={{ color: colors.ink, fontFamily: 'IBMPlexMono-Regular' }}
    >
      {mathToText(latex)}
    </Text>
  );
}

interface EnvMatch {
  name: string;
  body: string;
}

function environment(latex: string): EnvMatch | null {
  const match = /\\begin\{([A-Za-z*]+)\}([\s\S]*)\\end\{\1\}/.exec(latex);
  if (!match) return null;
  return { name: match[1], body: match[2] };
}

function splitTop(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0 && value.startsWith(separator, index)) {
      parts.push(current);
      current = '';
      index += separator.length - 1;
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function Fraction({ numerator, denominator }: { numerator: string; denominator: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.fraction} accessibilityLabel={`${numerator} over ${denominator}`}>
      <Text variant="body" style={[styles.mathText, { color: colors.ink }]}>
        {mathToText(numerator)}
      </Text>
      <View style={[styles.fractionBar, { backgroundColor: colors.ink }]} />
      <Text variant="body" style={[styles.mathText, { color: colors.ink }]}>
        {mathToText(denominator)}
      </Text>
    </View>
  );
}

function MathLine({ latex }: { latex: string }) {
  const { colors } = useTheme();
  const segments = useMemo(() => {
    const result: Array<{ kind: 'text' | 'frac'; value: string; denominator?: string }> = [];
    let rest = latex;
    const pattern = /\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/;
    for (let guard = 0; guard < 24; guard += 1) {
      const match = pattern.exec(rest);
      if (!match) break;
      if (match.index > 0) result.push({ kind: 'text', value: rest.slice(0, match.index) });
      result.push({ kind: 'frac', value: match[1], denominator: match[2] });
      rest = rest.slice(match.index + match[0].length);
    }
    if (rest) result.push({ kind: 'text', value: rest });
    return result;
  }, [latex]);
  if (segments.length === 0) return null;
  return (
    <View style={styles.mathLine}>
      {segments.map((segment, index) =>
        segment.kind === 'frac' ? (
          <Fraction key={index} numerator={segment.value} denominator={segment.denominator ?? ''} />
        ) : (
          <Text
            key={index}
            variant="body"
            style={[styles.mathText, { color: colors.ink }]}
          >
            {mathToText(segment.value)}
          </Text>
        ),
      )}
    </View>
  );
}

function MatrixTable({
  rows,
  name,
}: {
  rows: string[][];
  name: string;
}) {
  const { colors } = useTheme();
  const bracket = name.includes('bmatrix') ? ['[', ']'] : ['(', ')'];
  const cases = name === 'cases';
  return (
    <View style={styles.matrixRow} accessibilityLabel={`${name} with ${rows.length} rows`}>
      {!cases ? (
        <Text variant="title" style={{ color: colors.muted }}>
          {bracket[0]}
        </Text>
      ) : null}
      <View style={[styles.matrix, cases ? { borderLeftColor: colors.ink, borderLeftWidth: 1 } : null]}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.matrixRow}>
            {row.map((cell, cellIndex) => (
              <View key={cellIndex} style={styles.matrixCell}>
                <MathLine latex={cell} />
              </View>
            ))}
          </View>
        ))}
      </View>
      {!cases ? (
        <Text variant="title" style={{ color: colors.muted }}>
          {bracket[1]}
        </Text>
      ) : null}
    </View>
  );
}

export function MathBlock({
  latex,
  onCopy,
}: {
  latex: string;
  onCopy?: (value: string) => void;
}) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const env = environment(latex);
  const rows = env
    ? splitTop(env.body, '\\\\').map((row) => splitTop(row, '&').map((cell) => cell.trim()))
    : null;
  const lines = env ? [] : splitTop(latex, '\\\\').map((line) => line.trim());
  const unsupported = !env && /\\begin\{/.test(latex);
  const copy = async () => {
    try {
      if (onCopy) onCopy(latex);
      else await Clipboard.setStringAsync(latex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <View style={[styles.block, { backgroundColor: colors.raised }]} testID="math-block">
      <View style={styles.header}>
        <Text variant="caption" color="muted">
          {unsupported ? 'Cannot typeset this expression' : 'Math'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Copied LaTeX' : 'Copy LaTeX'}
          onPress={() => void copy()}
          style={styles.copy}
        >
          <CopyIcon size={16} color={colors.muted} />
          <Text variant="caption" color="muted" style={{ marginLeft: 4 }}>
            {copied ? 'Copied' : 'Copy LaTeX'}
          </Text>
        </Pressable>
      </View>
      {unsupported ? (
        <Text variant="code" selectable style={{ color: colors.ink }}>
          {latex}
        </Text>
      ) : env && rows ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.envScroll}>
          <MatrixTable rows={rows.filter((row) => row.some(Boolean))} name={env.name} />
        </ScrollView>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.envScroll}>
          <View>
            {lines.filter(Boolean).map((line, index) => (
              <View key={index} style={index > 0 ? { marginTop: space.xs } : null}>
                <MathLine latex={line} />
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      <Text variant="caption" color="muted" style={{ marginTop: space.xs }} selectable>
        {mathToText(latex)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    borderRadius: radius.control,
    padding: space.sm,
    marginTop: space.sm,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  copy: {
    minHeight: target,
    minWidth: target,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  envScroll: { paddingVertical: space.xs, minWidth: '100%' },
  mathLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 2 },
  mathText: { fontFamily: 'IBMPlexMono-Regular' },
  fraction: { alignItems: 'center', paddingHorizontal: 2 },
  fractionBar: { height: StyleSheet.hairlineWidth * 2, alignSelf: 'stretch', minWidth: 18, marginVertical: 1 },
  matrixRow: { flexDirection: 'row', alignItems: 'center' },
  matrix: { marginHorizontal: 2 },
  matrixCell: { paddingHorizontal: space.xs, paddingVertical: 2, minWidth: 28 },
});
