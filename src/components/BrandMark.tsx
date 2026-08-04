import Svg, { Path } from "react-native-svg";

export function BrandMark({ size = 34, color = "#F50A48" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" accessibilityLabel="Crays">
      <Path
        fill={color}
        d="M20 1.5c1.7 9.8 8.7 16.8 18.5 18.5C28.7 21.7 21.7 28.7 20 38.5 18.3 28.7 11.3 21.7 1.5 20 11.3 18.3 18.3 11.3 20 1.5Z"
      />
    </Svg>
  );
}
