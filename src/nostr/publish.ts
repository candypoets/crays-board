import type { WorkerMessage } from "@candypoets/nipworker";
import { usePublish } from "@candypoets/nipworker/hooks";
import { isConnectionStatus } from "@candypoets/nipworker/utils";
import type { EventTemplate } from "nostr-tools";

export type PublishResult = { relayUrl: string; status: string };

/**
 * Resolve only after one target relay explicitly confirms the write
 * (venue-commerce-nip §6.8: a status write succeeds only after an affirmative
 * acknowledgement; a timeout is never presented as confirmed state).
 *
 * Ported from crays-rn src/nostr/publish.ts.
 */
export function publishEvent(
  template: EventTemplate,
  relays: string[],
  operation: string,
  timeoutMs = 12_000,
): Promise<PublishResult> {
  if (!relays.length) return Promise.reject(new Error("No relay is available for this action."));
  return new Promise((resolve, reject) => {
    let settled = false;
    let stop: (() => void) | undefined;
    const finish = (result?: PublishResult, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stop?.();
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const timeout = setTimeout(
      () => finish(undefined, new Error("The venue relay did not confirm this action. Check the connection and try again.")),
      timeoutMs,
    );
    stop = usePublish(
      `${operation}_${Date.now().toString(36)}`,
      template,
      (message: WorkerMessage) => {
        const status = isConnectionStatus(message);
        const value = status?.status()?.toString().toLowerCase() ?? "";
        const relayUrl = status?.relayUrl() ?? "";
        if (value === "ok" || value === "true" || value.startsWith("true ")) {
          finish({ relayUrl, status: value });
        } else if (value.startsWith("false") || value.startsWith("error")) {
          finish(undefined, new Error("The venue relay rejected this action. This key may not have staff access here."));
        }
      },
      { trackStatus: true, defaultRelays: relays },
    );
  });
}
