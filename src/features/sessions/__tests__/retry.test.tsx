import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as navigation from '@react-navigation/native';

import { SessionsScreen } from '../SessionsScreen';
import { ThemeProvider } from '../../../design/theme';
import { controller } from '../../../core/app-controller';
import { store } from '../../../core/state/store';

jest.mock('@react-navigation/native', () => {
  const navigate = jest.fn();
  return {
    useNavigation: () => ({ navigate, goBack: jest.fn() }),
    useRoute: () => ({ params: undefined }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ReactModule = require('react') as typeof React;
      ReactModule.useEffect(() => callback(), [callback]);
    },
    __navigate: navigate,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../core/app-controller', () => ({
  controller: {
    reconnect: jest.fn(async () => undefined),
    refreshSessions: jest.fn(async () => ({ ok: true })),
    startInventoryPolling: jest.fn(),
    stopInventoryPolling: jest.fn(),
    formatChecked: jest.fn(() => '01:50'),
    restoreIntent: jest.fn(async () => null),
    openSession: jest.fn(async () => undefined),
  },
}));

function setConnection(state: 'offline' | 'pair_again'): void {
  const current = store.get();
  store.setState({
    profileId: 'A',
    connection: {
      ...current.connection,
      state,
      serverLabel: 'Test server',
      lastCheckedAt: Date.now() - 1_000,
    },
    inventory: {
      ...current.inventory,
      sessions: [],
      error: null,
      loading: false,
    },
  });
}

describe('Sessions recovery controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setConnection('offline');
  });

  it('Offline Retry now calls the controller reconnect action', async () => {
    await render(
      <ThemeProvider preference="light">
        <SessionsScreen />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByTestId('sessions-retry'));
    expect(controller.reconnect).toHaveBeenCalledTimes(1);
    const navigate = (navigation as unknown as { __navigate: jest.Mock }).__navigate;
    expect(navigate).not.toHaveBeenCalledWith('ServerDetails');
  });

  it('Pair again opens server details rather than pretending to reconnect', async () => {
    setConnection('pair_again');
    await render(
      <ThemeProvider preference="light">
        <SessionsScreen />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Pair again' }));
    expect(controller.reconnect).not.toHaveBeenCalled();
    const navigate = (navigation as unknown as { __navigate: jest.Mock }).__navigate;
    expect(navigate).toHaveBeenCalledWith('ServerDetails');
  });
});
