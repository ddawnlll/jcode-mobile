import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { Button, Divider, Field, TextAction } from '../../design/controls';
import { CloseIcon, JCodeMark, LinkIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { geometry, radius, space } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { parseServerAddress } from '../../core/connection/client';
import { useAppStore } from '../../core/state/store';

export function ConnectScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const deviceName = useAppStore((state) => state.deviceName);
  const profileId = useAppStore((state) => state.profileId);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [name, setName] = useState(deviceName || 'JCode Mobile');
  const [error, setError] = useState<string | null>(null);
  const [pairError, setPairError] = useState<{ message: string; code?: string; detail?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;
  const [scanning, setScanning] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const pendingPairLink = useAppStore((state) => state.pendingPairLink);
  const setPendingPairLink = useAppStore((state) => state.actions.setPendingPairLink);

  const dismissKeyboard = () => Keyboard.dismiss();

  const parsed = address.trim() ? parseServerAddress(address) : null;

  useEffect(() => {
    if (!busy) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, pulse]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const handle = (url: string) => {
      if (!url.startsWith('jcode://pair') && !url.startsWith('jcodemobile://pair')) return;
      try {
        const parsedUrl = new URL(url.replace('jcode://', 'https://'));
        const host = parsedUrl.searchParams.get('host');
        const port = parsedUrl.searchParams.get('port');
        const invite = parsedUrl.searchParams.get('code');
        if (host) {
          const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
          const insecure = parsedUrl.searchParams.get('insecure') === '1' && loopback;
          setAddress(`${insecure ? 'ws://' : ''}${host}${port ? `:${port}` : ''}`);
        }
        if (invite) setCode(invite);
        setError(null);
      } catch {
        setError('That pairing link could not be read.');
      }
    };
    void Linking.getInitialURL().then((url) => {
      if (url) handle(url);
    });
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!pendingPairLink) return;
    const handle = (url: string) => {
      try {
        const parsedUrl = new URL(url.replace('jcode://', 'https://'));
        const host = parsedUrl.searchParams.get('host');
        const port = parsedUrl.searchParams.get('port');
        const invite = parsedUrl.searchParams.get('code');
        if (host) {
          const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
          const insecure = parsedUrl.searchParams.get('insecure') === '1' && loopback;
          setAddress(`${insecure ? 'ws://' : ''}${host}${port ? `:${port}` : ''}`);
        }
        if (invite) setCode(invite);
        setError(null);
      } catch {
        setError('That pairing link could not be read.');
      }
    };
    handle(pendingPairLink);
    setPendingPairLink(null);
  }, [pendingPairLink, setPendingPairLink]);

  const shouldShowConnect = profileId !== null;

  const pair = async () => {
    setError(null);
    setPairError(null);
    setBusy(true);
    const started = Date.now();
    const result = await Promise.race([
      controller.pair({
        address,
        code,
        label,
        deviceName: name.trim() || 'JCode Mobile',
      }),
      new Promise<{ ok: false; error: string; code: string; detail?: string }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: false,
              code: 'PAIR_TIMEOUT_UI',
              error: 'Pairing was still waiting after 20s. The server did not complete /pair.',
              detail: 'No response returned to the app. Check the adapter log and TLS chain.',
            }),
          20_000,
        ),
      ),
    ]);
    setBusy(false);
    if (!result.ok) {
      setPairError({
        message: result.error,
        code: result.code,
        detail: 'detail' in result ? result.detail : undefined,
      });
      return;
    }
    void started;
    navigation.reset({ index: 0, routes: [{ name: 'Sessions' as never }] });
  };

  const copyPairError = async () => {
    if (!pairError) return;
    const text = [pairError.message, pairError.code ? `Code: ${pairError.code}` : null, pairError.detail]
      .filter(Boolean)
      .join('\n');
    await Clipboard.setStringAsync(text).catch(() => undefined);
    setCopied('pairError');
    setTimeout(() => setCopied(null), 1200);
  };

  const copy = async (id: string, value: string) => {
    await Clipboard.setStringAsync(value).catch(() => undefined);
    setCopied(id);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.appBar}>
        <View style={styles.brand}>
          <JCodeMark size={22} />
          <Text variant="subhead" style={{ marginLeft: space.xs }}>
            jcode
          </Text>
        </View>
        {shouldShowConnect ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close connection setup"
            onPress={() => navigation.goBack()}
            style={styles.close}
          >
            <CloseIcon size={22} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text variant="display" accessibilityRole="header">
          Bring your server.
        </Text>
        <Text variant="lead" color="muted" style={{ marginTop: space.sm }}>
          Pair this phone with JCode running on your VPS.
        </Text>

        <View style={styles.firstDecision}>
          <Button
            label={scanning ? 'Stop scanning' : 'Scan pairing code'}
            onPress={async () => {
              if (scanning) return setScanning(false);
              if (!permission?.granted) {
                const next = await requestPermission();
                if (!next.granted) {
                  setError('Camera access is off. Paste the pairing code instead.');
                  return;
                }
              }
              setScanning(true);
            }}
            variant="secondary"
            fullWidth
          />
          <TextAction
            label="Enter connection details"
            onPress={() => setScanning(false)}
            align="center"
          />
        </View>

        {scanning ? (
          <View style={[styles.scanner, { borderColor: colors.line }]}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                setScanning(false);
                try {
                  const parsedUrl = new URL(data.replace('jcode://', 'https://'));
                  const host = parsedUrl.searchParams.get('host');
                  const port = parsedUrl.searchParams.get('port');
                  const invite = parsedUrl.searchParams.get('code');
                  if (!host || !invite) throw new Error('missing');
                  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
                  const insecure = parsedUrl.searchParams.get('insecure') === '1' && loopback;
                  setAddress(`${insecure ? 'ws://' : ''}${host}${port ? `:${port}` : ''}`);
                  setCode(invite);
                  setError(null);
                } catch {
                  setError('That code is not a JCode pairing link. Paste the code instead.');
                }
              }}
            />
            <View style={styles.scanFrame} pointerEvents="none" />
            <Text variant="caption" color="onBrand" style={styles.scanHint}>
              Point at the code shown by your server
            </Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Field
            label="Server address"
            value={address}
            onChangeText={(value) => {
              setAddress(value);
              setError(null);
            }}
            placeholder="studio.example.net:7643"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={dismissKeyboard}
            leading={<LinkIcon size={20} color={colors.muted} />}
            helper="Scheme, host, and port are shown below before anything is sent."
          />
          <View style={[styles.review, { backgroundColor: colors.raised }]}>
            <Text variant="caption" color="muted">
              {parsed && parsed.ok
                ? `This phone will contact ${parsed.endpoint.tls ? 'wss' : 'ws'}://${parsed.display}/ws${
                    parsed.endpoint.tls ? ' over TLS' : ' on this local network only'
                  }`
                : parsed
                  ? parsed.error
                  : 'Enter the address shown by your server.'}
            </Text>
          </View>
          <Field
            label="Pairing code"
            value={code}
            onChangeText={(value) => setCode(value.replace(/[^\d\s]/g, '').slice(0, 7))}
            placeholder="123 456"
            keyboardType="numbers-and-punctuation"
            returnKeyType="done"
            onSubmitEditing={dismissKeyboard}
            maxLength={7}
            helper="Minted by `jcode pair` on your server. Valid for five minutes."
          />
          <Field
            label="Server label"
            value={label}
            onChangeText={setLabel}
            placeholder="Studio VPS"
            helper="Optional. A friendly name for this server on this phone."
          />
          <Field
            label="Device name"
            value={name}
            onChangeText={setName}
            placeholder="JCode Mobile"
            helper="Shown in the server's paired-device list."
          />
          {busy ? (
            <View style={[styles.pairing, { backgroundColor: colors.raised }]} accessibilityLiveRegion="polite">
              <View style={styles.pairingRing}>
                <Animated.View
                  style={[
                    styles.pairingPulse,
                    {
                      borderColor: colors.brand,
                      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                      transform: [
                        { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) },
                      ],
                    },
                  ]}
                />
                <ActivityIndicator color={colors.brand} />
              </View>
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <Text variant="small">
                  Pairing with {parsed?.ok ? parsed.display : address}…
                </Text>
                <Text variant="caption" color="muted">
                  {elapsed}s · POST /pair · up to 12s
                </Text>
              </View>
            </View>
          ) : null}
          {pairError ? (
            <View style={[styles.pairError, { borderColor: colors.error }]} accessibilityLiveRegion="assertive">
              <Text variant="small" color="error">
                {pairError.message}
              </Text>
              {pairError.code ? (
                <Text variant="code" color="muted" style={{ marginTop: space.xxs }}>
                  Code: {pairError.code}
                </Text>
              ) : null}
              {pairError.detail ? (
                <Text variant="caption" color="muted" style={{ marginTop: space.xxs }}>
                  {pairError.detail}
                </Text>
              ) : null}
              <TextAction
                label={copied === 'pairError' ? 'Copied details' : 'Copy error details'}
                onPress={() => void copyPairError()}
              />
            </View>
          ) : null}
          {error ? (
            <Text variant="small" color="error" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button
            label="Pair this phone"
            onPress={pair}
            loading={busy}
            disabled={!parsed?.ok || code.replace(/\D/g, '').length !== 6}
            reason={!parsed?.ok ? 'Enter a valid server address first.' : undefined}
            fullWidth
            testID="connect-pair"
          />
        </View>

        <Divider />
        <TextAction
          label={showDetails ? 'Hide setup details' : 'View setup details'}
          onPress={() => setShowDetails((value) => !value)}
        />
        {showDetails ? (
          <View style={[styles.setup, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <Text variant="small" color="muted">
              Run this on the server as the same user that runs the JCode daemon:
            </Text>
            <CommandRow command="jcode pair" copied={copied === 'cli'} onCopy={() => copy('cli', 'jcode pair')} />
            <Text variant="small" color="muted" style={{ marginTop: space.xs }}>
              The six-digit code is valid for five minutes. If `jcode pair` is missing, upgrade JCode;
              this build was verified with JCode 0.99.1.
            </Text>
            <Text variant="small" color="muted" style={{ marginTop: space.sm }}>
              This app also needs the JCode Mobile adapter on the server, with TLS enabled for remote
              access. The adapter reuses the same pairing registry and sets disconnect continuation on
              every session attachment. Without it, this server needs mobile continuation support and
              sending stays disabled.
            </Text>
            <Text variant="small" color="muted" style={{ marginTop: space.xs }}>
              Do not expose an unencrypted gateway to the internet. A private tunnel is an alternative
              deployment, not a setting in this app.
            </Text>
          </View>
        ) : null}

        <Text variant="caption" color="muted" style={{ marginTop: space.lg }}>
          This app never asks for your provider key, shell password, or root access. Pairing gives this
          phone a device token, not your credentials.
        </Text>
        <View style={{ height: space.xxl }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function CommandRow({
  command,
  copied,
  onCopy,
}: {
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy ${command}`}
      onPress={onCopy}
      style={({ pressed }) => [
        styles.command,
        { backgroundColor: pressed ? colors.raised : colors.raised },
      ]}
    >
      <Text variant="code" style={{ flex: 1 }}>
        {command}
      </Text>
      <Text variant="caption" color="brand">
        {copied ? 'Copied' : 'Copy'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  appBar: {
    height: 56,
    paddingHorizontal: geometry.gutterCompact,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center' },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: geometry.gutterCompact, paddingBottom: space.xxl },
  firstDecision: { marginTop: space.xl, gap: space.xs },
  scanner: {
    height: 260,
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: space.md,
    backgroundColor: '#000',
  },
  scanFrame: {
    position: 'absolute',
    left: '12%',
    right: '12%',
    top: '18%',
    bottom: '18%',
    borderWidth: 2,
    borderColor: '#F4F8F5',
    borderRadius: 12,
  },
  pairing: {
    borderRadius: radius.control,
    padding: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pairingRing: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  pairingPulse: { position: 'absolute', width: 28, height: 28, borderRadius: 14, borderWidth: 2 },
  pairError: { borderWidth: 1, borderRadius: radius.control, padding: space.sm, gap: space.xxs },
  scanHint: { position: 'absolute', bottom: space.sm, alignSelf: 'center' },
  form: { marginTop: space.lg, gap: space.md },
  review: { borderRadius: radius.control, padding: space.sm },
  setup: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space.sm,
    marginTop: space.sm,
    gap: space.xs,
  },
  command: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.control,
    paddingHorizontal: space.sm,
    gap: space.sm,
  },
});
