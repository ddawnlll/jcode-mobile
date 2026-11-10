import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAppStore } from '../core/state/store';
import { SessionsScreen } from '../features/sessions/SessionsScreen';
import { ConversationScreen } from '../features/conversation/ConversationScreen';
import { ConnectScreen } from '../features/connect/ConnectScreen';
import { ServerDetailsScreen } from '../features/server/ServerDetailsScreen';
import { WelcomeScreen } from '../features/welcome/WelcomeScreen';
import { AppearanceScreen } from '../features/appearance/AppearanceScreen';
import { ProjectsScreen } from '../features/projects/ProjectsScreen';
import { useTheme } from '../design/theme';

export type RootStackParamList = {
  Welcome: undefined;
  Sessions: { scope?: string; newSession?: boolean } | undefined;
  Conversation: { sessionId: string };
  Connect: undefined;
  ServerDetails: undefined;
  Appearance: undefined;
  Projects: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const profileId = useAppStore((state) => state.profileId);
  const demo = useAppStore((state) => state.demo);
  const { colors, reduceMotion } = useTheme();
  return (
    <Stack.Navigator
      initialRouteName={profileId || demo ? 'Sessions' : 'Welcome'}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: reduceMotion ? 'fade' : 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Sessions" component={SessionsScreen} />
      <Stack.Screen name="Projects" component={ProjectsScreen} />
      <Stack.Screen name="Conversation" component={ConversationScreen} />
      <Stack.Screen name="Connect" component={ConnectScreen} />
      <Stack.Screen
        name="ServerDetails"
        component={ServerDetailsScreen}
        options={{ animation: reduceMotion ? 'fade' : 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="Appearance"
        component={AppearanceScreen}
        options={{ animation: reduceMotion ? 'fade' : 'slide_from_right' }}
      />
    </Stack.Navigator>
  );
}
