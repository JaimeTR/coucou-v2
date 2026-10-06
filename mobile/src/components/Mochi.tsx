// Mochi, drawn in code (no images), like on the desktop: a soft blob and two eyes.

import Svg, { Circle, Ellipse, Path } from "react-native-svg";

export type Mood = "idle" | "happy" | "alert";

export function Mochi({ size = 96, mood = "idle", color = "#9DB1F2" }: { size?: number; mood?: Mood; color?: string }) {
  const eyeY = mood === "alert" ? 58 : 62;
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" accessibilityLabel="Mochi">
      <Ellipse cx={60} cy={108} rx={34} ry={5} fill="#000" opacity={0.25} />
      <Path
        d="M60 14c24 0 42 16 42 42 0 28-14 46-42 46S18 84 18 56c0-26 18-42 42-42z"
        fill={color}
      />
      {mood === "happy" ? (
        <>
          <Path d="M40 62q6-8 12 0" stroke="#0B0C0E" strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M68 62q6-8 12 0" stroke="#0B0C0E" strokeWidth={4} strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <Circle cx={46} cy={eyeY} r={mood === "alert" ? 6 : 5} fill="#0B0C0E" />
          <Circle cx={74} cy={eyeY} r={mood === "alert" ? 6 : 5} fill="#0B0C0E" />
        </>
      )}
      <Path d="M54 78q6 5 12 0" stroke="#0B0C0E" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.7} />
    </Svg>
  );
}
