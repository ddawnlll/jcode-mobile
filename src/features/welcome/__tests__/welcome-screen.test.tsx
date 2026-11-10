import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../../design/theme';
import { WelcomeScreen } from '../WelcomeScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useIsFocused: () => true,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('../../../core/state/store', () => {
  const state: { appearance: 'system' | 'light' | 'night'; profileId: string | null } = {
    appearance: 'system',
    profileId: null,
  };
  return {
    useAppStore: (selector: (value: typeof state) => unknown) => selector(state),
    __setMockProfileId: (value: string | null) => {
      state.profileId = value;
    },
  };
});

jest.mock('../../../core/app-controller', () => ({
  controller: {
    setThemeFamily: jest.fn(async () => undefined),
    setAppearance: jest.fn(async () => undefined),
    enterDemo: jest.fn(),
  },
}));

type MockStore = { __setMockProfileId: (value: string | null) => void };

function mockStore(): MockStore {
  return jest.requireMock('../../../core/state/store') as MockStore;
}

function renderWelcome() {
  return render(
    <ThemeProvider>
      <WelcomeScreen />
    </ThemeProvider>,
  );
}

async function skipOpening() {
  await fireEvent.press(screen.getByTestId('welcome-skip'));
  await waitFor(() => expect(screen.queryByTestId('welcome-skip')).toBeNull());
}

describe('WelcomeScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockStore().__setMockProfileId(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the full-screen welcome and reveals pairing, preview and theme controls', async () => {
    await renderWelcome();

    expect(screen.getByRole('header')).toBeTruthy();
    expect(screen.getByTestId('welcome-skip')).toBeTruthy();
    expect(screen.queryByTestId('welcome-ascii', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('theme-tidal')).toBeTruthy();
    expect(screen.getByTestId('appearance-system')).toBeTruthy();
    expect(screen.getByText('JCode Mobile 0.2.2 · preview UI')).toBeTruthy();

    await skipOpening();

    expect(screen.getByTestId('welcome-connect')).toBeTruthy();
    expect(screen.getByTestId('welcome-preview')).toBeTruthy();
    expect(screen.getByTestId('welcome-motion')).toBeTruthy();
  });

  it('skips the opening, reveals the actions and toggles pause and play', async () => {
    await renderWelcome();
    await skipOpening();

    await fireEvent.press(screen.getByTestId('welcome-motion'));
    await waitFor(() => expect(screen.getByLabelText('Play animation')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('welcome-motion'));
    await waitFor(() => expect(screen.getByLabelText('Pause animation')).toBeTruthy());
  });

  it('keeps a saved server pointed at Sessions instead of pairing', async () => {
    mockStore().__setMockProfileId('server-1');
    await renderWelcome();
    await skipOpening();

    expect(screen.getByTestId('welcome-sessions')).toBeTruthy();
    expect(screen.queryByTestId('welcome-connect')).toBeNull();
    expect(screen.getByTestId('welcome-preview')).toBeTruthy();
  });
});
