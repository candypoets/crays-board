import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

/**
 * Active venue selection. Everything here is public, non-secret data; the
 * staff secret lives in account custody only. The selection is persisted so a
 * relaunch restores the venue without a new deep link.
 */
export type VenueSelection = {
  relayUrl: string;
  serviceUrl: string;
  /** Staff/admin pubkey operating this device at the venue. */
  pubkey: string;
};

type VenueContextValue = {
  venue: VenueSelection | null;
  /** True while the persisted selection is being restored on launch. */
  restoring: boolean;
  setVenue: (venue: VenueSelection | null) => void;
};

const STORAGE_KEY = "crays.board.venue";

const VenueContext = createContext<VenueContextValue>({
  venue: null,
  restoring: true,
  setVenue: () => {},
});

function isValidSelection(value: unknown): value is VenueSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.relayUrl === "string" &&
    /^wss?:\/\//.test(candidate.relayUrl) &&
    typeof candidate.serviceUrl === "string" &&
    /^https?:\/\//.test(candidate.serviceUrl) &&
    typeof candidate.pubkey === "string" &&
    /^[0-9a-f]{64}$/i.test(candidate.pubkey)
  );
}

export function VenueProvider({ children }: PropsWithChildren) {
  const [venue, setVenueState] = useState<VenueSelection | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        if (!cancelled && stored) {
          const parsed: unknown = JSON.parse(stored);
          if (isValidSelection(parsed)) setVenueState(parsed);
        }
      } catch {
        // A corrupt selection is treated as absent; the next seed rewrites it.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setVenue = useCallback((next: VenueSelection | null) => {
    setVenueState(next);
    if (next) {
      void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
    } else {
      void SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
    }
  }, []);

  const value = useMemo(() => ({ venue, restoring, setVenue }), [venue, restoring, setVenue]);
  return <VenueContext.Provider value={value}>{children}</VenueContext.Provider>;
}

export function useVenue(): VenueContextValue {
  return useContext(VenueContext);
}
