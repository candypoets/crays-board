import { useWindowDimensions } from "react-native";

export type Breakpoint = "phone" | "compact" | "tablet";

/** PRD §6: <600dp phone, 600–839dp compact tablet, ≥840dp full tablet. */
export function breakpointForWidth(width: number): Breakpoint {
  if (width >= 840) return "tablet";
  if (width >= 600) return "compact";
  return "phone";
}

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return breakpointForWidth(width);
}
