import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { BottomSheet } from '../../design/BottomSheet';
import { Button, Divider, TextAction } from '../../design/controls';
import {
  BackIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  LockIcon,
  WorkIcon,
} from '../../design/icons';
import { useTheme } from '../../design/theme';
import { geometry, radius, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { formatClock } from '../../core/session/selectors';
import { useAppStore, type ToolRow } from '../../core/state/store';
import type { HistoryMessage } from '../../core/protocol/frames';

const MAX_JSON_BYTES = 8 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024;

type Activity =
  | { kind: 'seam'; key: string; count: number | null }
  | { kind: 'tool'; key: string; row: ToolRow }
  | { kind: 'historyTool'; key: string; message: HistoryMessage };

function describeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path : typeof record.file_path === 'string' ? record.file_path : null;
  if (path) return path;
  if (typeof record.command === 'string') {
    const first = record.command.split('\n')[0];
    return first.length > 100 ? `${first.slice(0, 100)}…` : first;
  }
  if (typeof record.query === 'string') return `"${record.query}"`;
  if (typeof record.intent === 'string') return record.intent;
  const keys = Object.keys(record).filter((key) => record[key] !== null && record[key] !== undefined);
  return keys.slice(0, 3).join(', ');
}

function bound(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
}

export function WorkSheet({
  visible,
  onClose,
  onStop,
}: {
  visible: boolean;
  onClose: () => void;
  onStop: () => void;
}) {
  const { colors } = useTheme();
  const conversation = useAppStore((state) => state.conversation);
  const capabilities = useAppStore((state) => state.connection.capabilities);
  const headingRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const [tab, setTab] = useState<'activity' | 'plan'>('activity');
  const [selected, setSelected] = useState<{ row?: ToolRow; message?: HistoryMessage } | null>(null);
  const [expandedOutput, setExpandedOutput] = useState(false);
  const [currentFile, setCurrentFile] = useState<{ path: string; content: string; truncated: boolean } | null>(null);
  const [fileState, setFileState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setSelected(null);
      setExpandedOutput(false);
      setCurrentFile(null);
      setFileState('idle');
      setTab('activity');
    }
  }, [visible]);

  const showPlanTab = (conversation.plan?.state.todos.length ?? 0) > 0;

  // The adapter exposes todo state by request, not as a live frame. Opening the
  // sheet before the agent has written its plan would otherwise leave the Plan
  // tab hidden forever. Refresh when a tool row appears or changes state, and
  // once more when the turn settles.
  const toolRevision = conversation.tools.map((row) => `${row.callId}:${row.state}`).join('|');
  useEffect(() => {
    if (!visible) return;
    void controller.loadPlan();
  }, [visible, toolRevision, conversation.execution.kind]);

  useEffect(() => {
    if (!showPlanTab && tab === 'plan') setTab('activity');
  }, [showPlanTab, tab]);

  const activities = useMemo<Activity[]>(() => {
    const entries: Activity[] = [];
    // A tool call can appear both as committed history and as a live row.
    // Committed history fixes the order; the live row carries richer state.
    const liveRows = new Map(conversation.tools.map((row) => [row.callId, row]));
    const placed = new Set<string>();
    for (const message of conversation.messages) {
      if (message.tool_data) {
        const live = liveRows.get(message.tool_data.id);
        entries.push({
          kind: 'tool',
          key: `ht-${message.index}`,
          row:
            live ??
            {
              callId: message.tool_data.id,
              name: message.tool_data.name,
              input: message.tool_data.input,
              state: 'done',
              startedAt: 0,
              historical: true,
            },
        });
        placed.add(message.tool_data.id);
        continue;
      }
      if (message.role !== 'tool') continue;
      entries.push({ kind: 'historyTool', key: `h-${message.index}`, message });
    }
    for (const row of conversation.tools) {
      if (placed.has(row.callId)) continue;
      entries.push({ kind: 'tool', key: `t-${row.callId}`, row });
    }
    const seamIndex = conversation.seam?.index ?? null;
    if (seamIndex === null || entries.length === 0) return entries;
    const seam: Activity = {
      kind: 'seam',
      key: `seam-${seamIndex}`,
      count: conversation.seam?.count ?? null,
    };
    const firstHistory = entries.findIndex(
      (entry) =>
        (entry.kind === 'historyTool' && entry.message.index >= seamIndex) ||
        (entry.kind === 'tool' && entry.row.historical),
    );
    if (firstHistory >= 0) {
      entries.splice(firstHistory, 0, seam);
    } else {
      entries.push(seam);
    }
    return entries;
  }, [conversation.messages, conversation.tools, conversation.seam]);

  const copy = async (id: string, value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(id);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      setCopied(null);
    }
  };

  const readCurrentFile = async (path: string) => {
    setFileState('loading');
    setFileError(null);
    const result = await controller.readCurrentFile(path);
    if (result.ok) {
      setCurrentFile({ path, content: result.content, truncated: result.truncated });
      setFileState('idle');
    } else {
      setFileState('error');
      setFileError(result.error);
    }
  };

  const execution = conversation.execution;
  const observed = execution.observedAt ? formatClock(execution.observedAt) : null;

  return (
    <BottomSheet visible={visible} onClose={onClose} headingRef={headingRef} accessibilityLabel="Session work">
      {selected ? (
        <ToolDetail
          row={selected.row}
          message={selected.message}
          onBack={() => {
            setSelected(null);
            setExpandedOutput(false);
            setCurrentFile(null);
          }}
          onClose={onClose}
          copy={copy}
          copied={copied}
          expanded={expandedOutput}
          onExpand={() => setExpandedOutput(true)}
          capability={capabilities.includes('file_read')}
          currentFile={currentFile}
          fileState={fileState}
          fileError={fileError}
          onReadFile={readCurrentFile}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.header}>
            <View ref={headingRef} collapsable={false}>
              <Text variant="title" accessibilityRole="header">
                Session work
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close session work"
              onPress={onClose}
              style={styles.close}
            >
              <CloseIcon size={22} color={colors.ink} />
            </Pressable>
          </View>
          <View style={styles.tabs}>
            <TabButton
              label="Activity"
              active={tab === 'activity'}
              onPress={() => setTab('activity')}
            />
            {showPlanTab ? (
              <TabButton label="Plan" active={tab === 'plan'} onPress={() => setTab('plan')} />
            ) : null}
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
            <View style={styles.stateBlock}>
              <Text variant="subhead">
                {execution.kind === 'working'
                  ? execution.label
                  : execution.kind === 'ready'
                    ? 'Ready'
                    : execution.kind === 'stopped'
                      ? execution.label
                      : 'Status unavailable'}
              </Text>
              <Text variant="caption" color="muted">
                {observed ? `Observed at ${observed}` : 'No observation time reported'}
              </Text>
              {execution.detail ? (
                <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
                  {execution.detail}
                </Text>
              ) : null}
            </View>
            <Divider />
            {tab === 'activity' ? (
              activities.length === 0 ? (
                <View style={styles.empty}>
                  <Text variant="body" color="muted">
                    No tools have been reported for this session.
                  </Text>
                  <Text variant="caption" color="muted" style={{ marginTop: space.xs }}>
                    Work appears here when the server records a tool call.
                  </Text>
                </View>
              ) : (
                <View style={{ paddingTop: space.sm }}>
                  {activities.map((item) => {
                    if (item.kind === 'seam') {
                      return (
                        <View key={item.key} style={styles.seam}>
                          <View style={styles.seamRuleRow}>
                            <View style={[styles.seamRule, { backgroundColor: colors.accent }]} />
                            <Text variant="small" weight="semibold" style={{ marginHorizontal: space.sm }}>
                              Since you left
                            </Text>
                            <View style={[styles.seamRule, { backgroundColor: colors.accent }]} />
                          </View>
                          <Text variant="caption" color="muted" style={{ marginTop: space.xxs }}>
                            {item.count !== null
                              ? `${item.count} ${item.count === 1 ? 'update' : 'updates'}`
                              : 'New activity since your last visit'}
                          </Text>
                        </View>
                      );
                    }
                    if (item.kind === 'historyTool') {
                      const preview = item.message.content.split('\n').find((line) => line.trim().length > 0) ?? '';
                      return (
                        <Pressable
                          key={item.key}
                          accessibilityRole="button"
                          accessibilityLabel="Tool output. Open detail"
                          onPress={() => setSelected({ message: item.message })}
                          style={({ pressed }) => [
                            styles.activityRow,
                            { backgroundColor: pressed ? colors.raised : 'transparent' },
                          ]}
                        >
                          <View style={styles.spine} />
                          <CheckIcon size={18} color={colors.muted} />
                          <View style={{ flex: 1, marginLeft: space.sm }}>
                            <Text variant="body" numberOfLines={2}>
                              Tool output
                            </Text>
                            <Text variant="caption" color="muted" numberOfLines={1}>
                              {preview || 'No content'}
                            </Text>
                          </View>
                          <ChevronRightIcon size={18} color={colors.muted} />
                        </Pressable>
                      );
                    }
                    const row = item.row;
                    const summary = describeInput(row.input);
                    return (
                      <Pressable
                        key={item.key}
                        accessibilityRole="button"
                        accessibilityLabel={`${row.name}${summary ? `, ${summary}` : ''}. ${row.state}. Open detail`}
                        onPress={() => setSelected({ row })}
                        style={({ pressed }) => [
                          styles.activityRow,
                          { backgroundColor: pressed ? colors.raised : 'transparent' },
                        ]}
                      >
                        <View style={[styles.spine, { backgroundColor: colors.line }]} />
                        {row.state === 'running' ? (
                          <WorkIcon size={18} color={colors.success} />
                        ) : row.state === 'failed' ? (
                          <CloseIcon size={18} color={colors.error} />
                        ) : (
                          <CheckIcon size={18} color={colors.muted} />
                        )}
                        <View style={{ flex: 1, marginLeft: space.sm }}>
                          <Text variant="body" numberOfLines={2} weight="medium">
                            {row.name}
                          </Text>
                          {summary ? (
                            <Text variant="caption" color="muted" numberOfLines={2}>
                              {summary}
                            </Text>
                          ) : null}
                          {row.error ? (
                            <Text variant="caption" color="error" numberOfLines={2}>
                              {row.error}
                            </Text>
                          ) : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text variant="caption" color="muted" tabular>
                            {row.state === 'running' ? 'Running' : formatClock(row.completedAt ?? row.startedAt)}
                          </Text>
                          <ChevronRightIcon size={16} color={colors.muted} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )
            ) : (
              <PlanView />
            )}
          </ScrollView>
          {execution.kind === 'working' ? (
            <View style={[styles.stopFooter, { borderTopColor: colors.line }]}>
              <TextAction
                label={execution.label === 'Stopping…' ? 'Stopping…' : 'Stop this turn'}
                onPress={onStop}
                color="error"
                disabled={execution.label === 'Stopping…'}
              />
              <Text variant="caption" color="muted">
                Affects this session only.
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.tab, active && { borderBottomColor: colors.brand }]}
    >
      <Text variant="subhead" weight={active ? 'semibold' : 'medium'} color={active ? 'ink' : 'muted'}>
        {label}
      </Text>
    </Pressable>
  );
}

function PlanView() {
  const { colors } = useTheme();
  const plan = useAppStore((state) => state.conversation.plan);
  const loading = useAppStore((state) => state.conversation.planLoading);
  if (!plan) {
    return (
      <View style={styles.empty}>
        <Text variant="body" color="muted">
          {loading ? 'Reading the reported plan…' : 'No plan was reported.'}
        </Text>
      </View>
    );
  }
  const todos = plan.state.todos;
  const complete = todos.filter((item) => item.status === 'completed' || item.status === 'done').length;
  return (
    <View style={{ paddingTop: space.md }}>
      <Text variant="small" color="muted" style={{ paddingHorizontal: geometry.gutterCompact }}>
        {todos.length > 0
          ? `${complete} of ${todos.length} reported steps complete`
          : 'The server reported no steps'}
      </Text>
      {plan.state.plan?.user_intention ? (
        <View style={{ paddingHorizontal: geometry.gutterCompact, marginTop: space.sm }}>
          <Text variant="caption" color="muted">
            Your intention
          </Text>
          <Text variant="body">{plan.state.plan.user_intention}</Text>
        </View>
      ) : null}
      <View style={{ marginTop: space.sm }}>
        {todos.map((item) => {
          const blocked =
            item.status === 'blocked' || item.status.includes('block') || (item.blocked_by?.length ?? 0) > 0;
          const done = item.status === 'completed' || item.status === 'done';
          const current = item.status === 'in_progress' || item.status === 'running';
          return (
            <View key={item.id} style={styles.planRow}>
              {done ? (
                <CheckIcon size={18} color={colors.success} />
              ) : blocked ? (
                <LockIcon size={18} color={colors.warning} />
              ) : (
                <WorkIcon size={18} color={current ? colors.ink : colors.muted} />
              )}
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <Text variant="body" color={done ? 'muted' : 'ink'}>
                  {item.content}
                </Text>
                <Text variant="caption" color="muted">
                  {done ? 'Complete' : blocked ? 'Blocked' : current ? 'Current' : item.status.replace(/_/g, ' ')}
                </Text>
                {blocked && item.blocked_by?.length ? (
                  <Text variant="caption" color="warning">
                    Waiting on {item.blocked_by.join(', ')}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
      <Text variant="caption" color="muted" style={{ paddingHorizontal: geometry.gutterCompact, marginTop: space.md }}>
        Last reported at {formatClock(plan.observedAt) || '—'}. This describes the current plan only.
      </Text>
    </View>
  );
}

function ToolDetail({
  row,
  message,
  onBack,
  onClose,
  copy,
  copied,
  expanded,
  onExpand,
  capability,
  currentFile,
  fileState,
  fileError,
  onReadFile,
}: {
  row?: ToolRow;
  message?: HistoryMessage;
  onBack: () => void;
  onClose: () => void;
  copy: (id: string, value: string) => void;
  copied: string | null;
  expanded: boolean;
  onExpand: () => void;
  capability: boolean;
  currentFile: { path: string; content: string; truncated: boolean } | null;
  fileState: 'idle' | 'loading' | 'error';
  fileError: string | null;
  onReadFile: (path: string) => void;
}) {
  const { colors } = useTheme();
  const name = row?.name ?? 'Tool output';
  const params = row?.input !== undefined ? JSON.stringify(row.input, null, 2) : '';
  const boundedParams = bound(params, MAX_JSON_BYTES);
  const output = row?.output ?? message?.content ?? '';
  const boundedOutput = bound(output, MAX_OUTPUT_BYTES);
  const shownOutput = expanded ? boundedOutput.text : boundedOutput.text.split('\n').slice(0, 24).join('\n');
  const hiddenLines = boundedOutput.text.split('\n').length - shownOutput.split('\n').length;
  const pathValue =
    row?.input && typeof row.input === 'object'
      ? (row.input as Record<string, unknown>).path ?? (row.input as Record<string, unknown>).file_path
      : null;
  const path = typeof pathValue === 'string' ? pathValue : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.detailHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to activity" onPress={onBack} style={styles.close}>
          <BackIcon size={22} color={colors.ink} />
        </Pressable>
        <Text variant="title">Tool detail</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close tool detail" onPress={onClose} style={styles.close}>
          <CloseIcon size={22} color={colors.ink} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: geometry.gutterCompact, paddingBottom: space.xxl }}>
        <Text variant="caption" color="muted">
          {row?.historical
            ? 'Recorded in saved history'
            : `${row?.state === 'running' ? 'Running' : row?.state === 'failed' ? 'Failed' : 'Completed'}${
                row?.startedAt ? ` · started ${formatClock(row.startedAt)}` : ''
              }${row?.completedAt ? ` · finished ${formatClock(row.completedAt)}` : ''}`}
        </Text>
        <Text variant="subhead" style={{ marginTop: space.xxs }}>
          {name}
        </Text>
        {params ? (
          <Section title={copied === 'params' ? 'Parameters · Copied' : 'Parameters'} onCopy={() => copy('params', params)}>
            <Code text={boundedParams.text + (boundedParams.truncated ? '\n… truncated' : '')} />
          </Section>
        ) : null}
        {!output && row?.historical ? (
          <Text variant="small" color="muted" style={{ marginTop: space.sm }}>
            The tool result is not part of the bounded history window. Open the conversation to read
            the committed output.
          </Text>
        ) : null}
        {output ? (
          <Section
            title={copied === 'output' ? 'Result · Copied' : 'Result'}
            onCopy={() => copy('output', output)}
          >
            <Code text={shownOutput} />
            {hiddenLines > 0 ? (
              <TextAction label={`Show ${hiddenLines} more lines`} onPress={onExpand} />
            ) : null}
            {boundedOutput.truncated ? (
              <Text variant="caption" color="muted">
                Only the first {MAX_OUTPUT_BYTES} characters are loaded.
              </Text>
            ) : null}
          </Section>
        ) : null}
        {row?.error ? (
          <Section title="Error">
            <Text variant="body" color="error">
              {row.error}
            </Text>
          </Section>
        ) : null}
        {path && capability ? (
          <View style={{ marginTop: space.lg }}>
            <Button
              label="Read current file"
              variant="secondary"
              fullWidth
              loading={fileState === 'loading'}
              onPress={() => onReadFile(path)}
            />
            <Text variant="caption" color="muted" style={{ marginTop: space.xs }}>
              This reads the file on the server now. Tool output above describes an earlier action.
            </Text>
            {fileState === 'error' ? (
              <Text variant="small" color="error" style={{ marginTop: space.xs }}>
                {fileError}
              </Text>
            ) : null}
            {currentFile ? (
              <View style={{ marginTop: space.md }}>
                <Text variant="small" color="muted">
                  Current server file
                </Text>
                <Text variant="code" style={{ marginTop: space.xxs }} numberOfLines={1}>
                  {currentFile.path}
                </Text>
                <Code text={currentFile.content.slice(0, MAX_OUTPUT_BYTES)} />
                {currentFile.truncated ? (
                  <Text variant="caption" color="muted">
                    The file is longer than the read limit.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : path && !capability ? (
          <View style={{ marginTop: space.lg }}>
            <Text variant="caption" color="muted">
              This server does not support reading current files.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  onCopy,
  children,
}: {
  title: string;
  onCopy?: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: space.lg }}>
      <View style={styles.sectionHeader}>
        <Text variant="small" color="muted">
          {title}
        </Text>
        {onCopy ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Copy" onPress={onCopy} style={styles.copyTarget}>
            <CopyIcon size={18} color={colors.muted} />
            <Text variant="caption" color="muted" style={{ marginLeft: 4 }}>
              Copy
            </Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Code({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.code, { backgroundColor: colors.raised }]}>
      <Text variant="code" selectable>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: geometry.gutterCompact,
  },
  close: { width: target, height: target, alignItems: 'center', justifyContent: 'center' },
  tabs: {
    flexDirection: 'row',
    gap: space.lg,
    paddingHorizontal: geometry.gutterCompact,
    marginTop: space.xs,
  },
  tab: { minHeight: target, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  stateBlock: { paddingHorizontal: geometry.gutterCompact, paddingVertical: space.sm },
  empty: { padding: space.xl, alignItems: 'center' },
  activityRow: {
    minHeight: geometry.toolRowMin,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: geometry.gutterCompact,
    paddingVertical: space.sm,
  },
  spine: {
    position: 'absolute',
    left: geometry.gutterCompact + 8,
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  seam: {
    paddingHorizontal: geometry.gutterCompact,
    paddingVertical: space.sm,
  },
  seamRuleRow: { flexDirection: 'row', alignItems: 'center' },
  seamRule: { flex: 1, height: StyleSheet.hairlineWidth },
  planRow: {
    minHeight: geometry.planItemMin,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: geometry.gutterCompact,
    paddingVertical: space.sm,
  },
  stopFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: geometry.gutterCompact,
    paddingVertical: space.xs,
    alignItems: 'center',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: geometry.gutterCompact,
    paddingLeft: space.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xxs,
  },
  copyTarget: { minHeight: 36, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xxs },
  code: {
    borderRadius: radius.control,
    padding: space.sm,
  },
});
