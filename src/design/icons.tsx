import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { useTheme } from './theme';

export interface IconProps {
  size?: number;
  color?: string;
  /** Accessible name. Omit for decorative icons next to visible text. */
  label?: string;
}

function useStroke(color?: string) {
  const { colors } = useTheme();
  return color ?? colors.ink;
}

const STROKE = 1.65;

export function BackIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path
        d="M19 12H5M11 18l-6-6 6-6"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function ChevronRightIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path
        d="M9 5l7 7-7 7"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path
        d="M5 9l7 7 7-7"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function MoreIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      {[6, 12, 18].map((cx) => (
        <Circle key={cx} cx={cx} cy={12} r={1.35} fill={stroke} />
      ))}
    </Svg>
  );
}

export function SearchIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Circle cx={11} cy={11} r={6} stroke={stroke} strokeWidth={STROKE} fill="none" />
      <Line x1={15.5} y1={15.5} x2={20} y2={20} stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
    </Svg>
  );
}

export function CloseIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path
        d="M6 6l12 12M18 6L6 18"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export function PlusIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path d="M12 5v14M5 12h14" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Stop is a solid small square inside the 48 target. */
export function StopIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Rect x={7} y={7} width={10} height={10} rx={2} fill={stroke} />
    </Svg>
  );
}

export function SendIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path
        d="M12 19V5M6 11l6-6 6 6"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function LinkIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path
        d="M10.5 13.5a4 4 0 006 .5l2-2a4 4 0 10-5.66-5.66l-1.2 1.2M13.5 10.5a4 4 0 00-6-.5l-2 2a4 4 0 105.66 5.66l1.2-1.2"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function LinkOffIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path
        d="M10.5 13.5a4 4 0 006 .5l2-2a4 4 0 00-.9-6.2M13.5 10.5a4 4 0 00-6-.5l-2 2a4 4 0 000 5.66M4 4l16 16"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function FolderIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path
        d="M3.5 8.5A2 2 0 015.5 6.5h3l1.8 2h6.2a2 2 0 012 2v6.5a2 2 0 01-2 2h-11a2 2 0 01-2-2v-10z"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function CheckIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path
        d="M5 12.5l4.5 4.5L19 7"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Open work mark: two offset squares, used for Working and plan current. */
export function WorkIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Rect x={4.5} y={4.5} width={10} height={10} rx={1.5} stroke={stroke} strokeWidth={STROKE} fill="none" />
      <Path
        d="M9.5 19.5h9a1 1 0 001-1v-9"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

/** Blocked glyph: padlock. */
export function LockIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Rect x={5.5} y={10.5} width={13} height={8.5} rx={2} stroke={stroke} strokeWidth={STROKE} fill="none" />
      <Path d="M8.5 10.5V8a3.5 3.5 0 117 0v2.5" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function CopyIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Rect x={8.5} y={8.5} width={10} height={10} rx={2} stroke={stroke} strokeWidth={STROKE} fill="none" />
      <Path d="M15 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v7.5A1.5 1.5 0 006 15h2.5" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function ArrowUpRightIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Path d="M7 17L17 7M9 7h8v8" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function InfoIcon({ size = 24, color, label }: IconProps) {
  const stroke = useStroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={label} accessible={!!label}>
      <Circle cx={12} cy={12} r={8} stroke={stroke} strokeWidth={STROKE} fill="none" />
      <Line x1={12} y1={11} x2={12} y2={16.5} stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
      <Circle cx={12} cy={7.75} r={1} fill={stroke} />
    </Svg>
  );
}

/** Static JCode halftone ring mark. Never used as a loading indicator. */
export function JCodeMark({
  size = 22,
  color,
  style,
}: {
  size?: number;
  color?: string;
  style?: StyleProp<ImageStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Image
      accessibilityIgnoresInvertColors
      source={require('../../assets/mark/jcode-mark.png')}
      style={[{ width: size, height: size, tintColor: color ?? colors.ink }, style]}
      resizeMode="contain"
    />
  );
}
