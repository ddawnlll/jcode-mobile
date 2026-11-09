import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../../design/theme';
import { MessageImage } from '../markdown/MessageImage';
import type { MessageImage as MessageImageData } from '../../../core/protocol/frames';

function image(uri: string): MessageImageData {
  return { media_type: 'image/png', data: '', uri, alt: 'Diagram' };
}

function wrap(node: React.ReactElement) {
  return <ThemeProvider preference="light">{node}</ThemeProvider>;
}

describe('MessageImage', () => {
  it('requires a tap before loading a protocol-relative URL', async () => {
    await render(wrap(<MessageImage image={image('//example.test/diagram.png')} />));
    expect(screen.getByText('External image · tap to load')).toBeOnTheScreen();
    expect(screen.getByTestId('message-image-load')).toBeOnTheScreen();
  });

  it('does not render unsupported URI schemes', async () => {
    await render(wrap(<MessageImage image={image('javascript:alert(1)')} />));
    expect(screen.getByText('Image source not supported')).toBeOnTheScreen();
    expect(screen.queryByTestId('message-image-load')).toBeNull();
  });

  it('renders an embedded image without a confirmation step', async () => {
    await render(
      wrap(<MessageImage image={image('data:image/png;base64,iVBORw0KGgo=')} />),
    );
    expect(screen.getByTestId('message-image')).toBeOnTheScreen();
  });
});
