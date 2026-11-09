import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
} from 'react';
import { Platform, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { fonts } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import type { Palette } from '../../design/tokens';
import {
  ASCII_MONO_ADVANCE,
  type AsciiLayerId,
  type AsciiPaint,
  type AsciiScene,
} from './asciiTorus';
import { useAsciiWelcome } from './useAsciiWelcome';

const LAYER_MATERIAL: Record<
  AsciiLayerId,
  { color: keyof Palette; opacity: number }
> = {
  field: { color: 'muted', opacity: 0.3 },
  noise: { color: 'muted', opacity: 0.5 },
  ringDim: { color: 'brand', opacity: 0.4 },
  ringMid: { color: 'brand', opacity: 0.75 },
  ringBright: { color: 'ink', opacity: 1 },
  type: { color: 'ink', opacity: 1 },
};

export interface AsciiWelcomeHandle {
  skip: () => void;
  togglePause: () => void;
}

export interface AsciiMotionState {
  opening: boolean;
  paused: boolean;
}

interface AsciiWelcomeProps {
  scene: AsciiScene | null;
  reduceMotion: boolean;
  onMotionState?: (state: AsciiMotionState) => void;
}

/**
 * Full-screen character field. One Text block per glyph layer, never one per
 * character. The idle turn only replaces the layers that cover the torus band,
 * so the rest of the raster stays mounted and untouched.
 *
 * The animation clock lives here, not in the screen. Only this component
 * re-renders on a frame; the welcome copy, actions and theme preview stay
 * untouched. The screen receives one callback when the coarse motion state
 * changes from opening to idle or paused to playing.
 */
export const AsciiWelcome = forwardRef<AsciiWelcomeHandle, AsciiWelcomeProps>(
  function AsciiWelcome({ scene, reduceMotion, onMotionState }, ref) {
    const welcome = useAsciiWelcome(scene, reduceMotion);

    useImperativeHandle(
      ref,
      () => ({ skip: welcome.skip, togglePause: welcome.togglePause }),
      [welcome.skip, welcome.togglePause],
    );

    useEffect(() => {
      onMotionState?.({ opening: welcome.opening, paused: welcome.paused });
    }, [onMotionState, welcome.opening, welcome.paused]);

    if (!scene || !welcome.paint) return null;
    return <AsciiField scene={scene} paint={welcome.paint} />;
  },
);

const AsciiField = React.memo(function AsciiField({
  scene,
  paint,
}: {
  scene: AsciiScene;
  paint: AsciiPaint;
}) {
  const { colors } = useTheme();
  const layerStyle = useMemo<TextStyle>(
    () => ({
      position: 'absolute',
      left: scene.originX,
      width: scene.cols * scene.cellW + 1,
      fontFamily: fonts.mono,
      fontSize: scene.cellW / ASCII_MONO_ADVANCE,
      lineHeight: scene.cellH,
      includeFontPadding: false,
      textAlignVertical: 'top',
      letterSpacing: 0,
      ...(Platform.OS === 'web'
        ? ({ whiteSpace: 'pre' } as unknown as TextStyle)
        : null),
    }),
    [scene.cellH, scene.cellW, scene.cols, scene.originX],
  );

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.clip]}
      pointerEvents="none"
      testID="welcome-ascii"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      {paint.layers.map((layer) => {
        const material = LAYER_MATERIAL[layer.id];
        const color = colors[material.color];
        return (
          <Text
            key={`${layer.id}-${layer.top}`}
            allowFontScaling={false}
            selectable={false}
            style={[
              layerStyle,
              {
                top: scene.originY + layer.top * scene.cellH,
                color,
                opacity:
                  layer.id === 'type'
                    ? material.opacity * paint.typeOpacity
                    : material.opacity,
              },
            ]}
          >
            {layer.lines.join('\n').replace(/ /g, '\u00A0')}
          </Text>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
