import type { ExpoConfig, ConfigContext } from 'expo/config';

const IS_INSECURE_DEV = process.env.JCODE_INSECURE_DEV === '1';

/**
 * Provisional application identity. Change `ios.bundleIdentifier`,
 * `android.package`, `scheme`, `name` and `slug` before distribution.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'JCode Mobile',
  slug: 'jcode-mobile',
  version: '0.2.2',
  orientation: 'portrait',
  scheme: 'jcodemobile',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.jcodemobile.app',
    buildNumber: '4',
    infoPlist: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: IS_INSECURE_DEV,
      },
      NSCameraUsageDescription:
        'Scan a JCode pairing code shown on your own server.',
      NSPhotoLibraryUsageDescription:
        'Attach a screenshot or image to a message for JCode on your server.',
      NSFaceIDUsageDescription: undefined,
    },
  },
  android: {
    package: 'com.jcodemobile.app',
    versionCode: 4,
    softwareKeyboardLayoutMode: 'resize',
    predictiveBackGestureEnabled: true,
    adaptiveIcon: {
      backgroundColor: '#F3F6F5',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  plugins: [
    './plugins/withLocalCleartext',
    './plugins/withBunGradle',
    'expo-secure-store',
    'expo-sqlite',
    'expo-font',
    'expo-image',
    [
      'expo-image-picker',
      {
        photosPermission:
          'Attach a screenshot or image to a message for JCode on your server.',
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 120,
        resizeMode: 'contain',
        backgroundColor: '#F3F6F5',
        dark: { backgroundColor: '#111F20' },
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Scan a JCode pairing code shown on your own server.',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // Scoped development exception only: loopback adapter reached through
          // `adb reverse`. Release builds keep cleartext disabled.
          usesCleartextTraffic: IS_INSECURE_DEV,
        },
      },
    ],
  ],
  extra: {
    // Deep-link scheme guard + adapter default port. No secrets here.
    adapterDefaultPort: 7643,
  },
});
