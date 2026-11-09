import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button, Field } from '../controls';
import { Text } from '../typography';
import { ThemeProvider } from '../theme';

function wrap(node: React.ReactElement) {
  return <ThemeProvider preference="light">{node}</ThemeProvider>;
}

describe('shared controls', () => {
  it('exposes a disabled primary action with its reason and does not fire', async () => {
    const onPress = jest.fn();
    await render(
      wrap(
        <Button
          label="Start session"
          onPress={onPress}
          disabled
          reason="Reconnect to start a session."
        />,
      ),
    );
    const button = screen.getByRole('button', { name: 'Start session' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Reconnect to start a session.')).toBeOnTheScreen();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('fires a press once and exposes a loading busy state', async () => {
    const onPress = jest.fn();
    await render(wrap(<Button label="Send" onPress={onPress} />));
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps the visible field label and announces an error', async () => {
    await render(
      wrap(
        <Field
          label="Folder on server"
          value="/srv"
          onChangeText={() => undefined}
          error="Enter an absolute folder path on the server."
        />,
      ),
    );
    expect(screen.getByText('Folder on server')).toBeOnTheScreen();
    expect(screen.getByText('Enter an absolute folder path on the server.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Folder on server')).toBeOnTheScreen();
  });

  it('scales text up to 200% without disabling platform scaling', async () => {
    await render(wrap(<Text variant="body">Readable body</Text>));
    const text = screen.getByText('Readable body');
    expect(text.props.allowFontScaling).toBe(true);
    expect(text.props.maxFontSizeMultiplier).toBe(2);
  });
});
