import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAppStore } from '../core/state/store';
import { SessionsScreen } from '../features/sessions/SessionsScreen';
import { ConversationScreen } from '../features/conversation/ConversationScreen';
import { ConnectScreen } from '../features/connect/ConnectScreen';
import { ServerDetailsScreen } from '../features/server/ServerDetailsScreen';
import { useTheme } from '../design/theme';

export type RootStackParamList = {
  Sessions: undefined;
  Conversation: { sessionId: string };
  Connect: undefined;
  ServerDetails: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const profileId = useAppStore((state) => state.profileId);
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      initialRouteName={profileId ? 'Sessions' : 'Connect'}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="Sessions" component={SessionsScreen} />
      <Stack.Screen name="Conversation" component={ConversationScreen} />
      <Stack.Screen name="Connect" component={ConnectScreen} />
      <Stack.Screen
        name="ServerDetails"
        component={ServerDetailsScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}
