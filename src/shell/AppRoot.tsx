import React, { useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './navigation';

import { ThemeProvider, useTheme } from '../design/theme';
import { Text } from '../design/typography';
import { JCodeMark } from '../design/icons';
import { space } from '../design/tokens';
import { useAppStore } from '../core/state/store';
import { controller } from '../core/app-controller';
import { RootNavigator } from './navigation';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const FONT_MAP = {
  'BricolageGrotesque-SemiBold': require('../../assets/fonts/BricolageGrotesque-SemiBold.ttf'),
  'HankenGrotesk-Regular': require('../../assets/fonts/HankenGrotesk-Regular.ttf'),
  'HankenGrotesk-Medium': require('../../assets/fonts/HankenGrotesk-Medium.ttf'),
  'HankenGrotesk-SemiBold': require('../../assets/fonts/HankenGrotesk-SemiBold.ttf'),
  'IBMPlexMono-Regular': require('../../assets/fonts/IBMPlexMono-Regular.ttf'),
};

export default function AppRoot() {
  const [fontsLoaded, fontError] = useFonts(FONT_MAP);
  const appearance = useAppStore((state) => state.appearance);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    void controller.bootstrap().finally(() => setBootstrapped(true));
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && bootstrapped) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError, bootstrapped]);

  const ready = (fontsLoaded || fontError) && bootstrapped;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {ready ? (
          <ThemeProvider preference={appearance}>
            <ThemedApp />
          </ThemeProvider>
        ) : (
          <ThemeProvider preference="light">
            <BootstrapSurface />
          </ThemeProvider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedApp() {
  const { scheme, colors } = useTheme();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const setPendingPairLink = useAppStore((state) => state.actions.setPendingPairLink);
  const pendingPairLink = useAppStore((state) => state.pendingPairLink);

  useEffect(() => {
    const handle = (url: string) => {
      if (!url.startsWith('jcode://pair') && !url.startsWith('jcodemobile://pair')) return;
      setPendingPairLink(url);
      if (navigationRef.isReady()) navigationRef.navigate('Connect');
    };
    void Linking.getInitialURL().then((url) => {
      if (url) handle(url);
    });
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => subscription.remove();
  }, [navigationRef, setPendingPairLink]);

  useEffect(() => {
    if (pendingPairLink && navigationRef.isReady()) navigationRef.navigate('Connect');
  }, [pendingPairLink, navigationRef]);

  return (
    <>
      <StatusBar style={scheme === 'night' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <NavigationContainer ref={navigationRef}>
          <RootNavigator />
        </NavigationContainer>
        <PrivacyShield />
      </View>
    </>
  );
}

function BootstrapSurface() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bootstrap, { paddingTop: insets.top }]}>
      <JCodeMark size={28} color="#173B3A" />
      <Text variant="small" color="muted" style={{ marginTop: space.sm }}>
        Opening your sessions…
      </Text>
      <View style={styles.placeholders}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.placeholderRow} />
        ))}
      </View>
    </View>
  );
}

/** Hides transcript content in the app switcher when the device is locked. */
function PrivacyShield() {
  const privacy = useAppStore((state) => state.privacyPreview);
  const [hidden, setHidden] = useState(false);
  const { colors } = useTheme();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (!privacy) return setHidden(false);
      setHidden(state === 'inactive' || state === 'background');
    });
    return () => subscription.remove();
  }, [privacy]);
  if (!hidden) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.shield, { backgroundColor: colors.bg }]}>
      <JCodeMark size={40} />
      <Text variant="subhead" style={{ marginTop: space.md }}>
        JCode Mobile
      </Text>
      <Text variant="small" color="muted" style={{ marginTop: space.xs }}>
        Your sessions are on your server.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bootstrap: {
    flex: 1,
    backgroundColor: '#F3F6F5',
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  placeholders: { marginTop: 48, gap: 20 },
  placeholderRow: {
    height: 76,
    borderRadius: 12,
    backgroundColor: '#E8EFEC',
    opacity: 0.7,
  },
  shield: { alignItems: 'center', justifyContent: 'center' },
});
