import "@/polyfills/text-encoding";

import * as Crypto from "expo-crypto";

import { signActiveEvent } from "@/account/account";
import type { VenueSelection } from "@/venue/VenueContext";

import {
  buildInviteRequestBody,
  buildNip98Template,
  buildRedeemUrl,
  inviteEndpoints,
  nip98AuthorizationHeader,
  parseInviteResponse,
  type InviteConfig,
  type InviteServiceResponse,
} from "./invites";

/**
 * Impure half of invite creation (PRD §8.8, INVITE-02): one NIP-98-authorized
 * POST to the selected venue's `/invites` service, the authorization event
 * bound to the exact URL, POST method, and SHA-256 of the exact body. The
 * caller owns repeat-tap safety (one intent in flight at a time); a mutation
 * is confirmed only by a real service response — never presented before.
 */
export type CreatedInvite = {
  response: InviteServiceResponse;
  /** Full guest redeem URL (crays-rn /invite entry path) for QR/share/copy. */
  redeemUrl: string;
};

export async function createInvite(venue: VenueSelection, config: InviteConfig): Promise<CreatedInvite> {
  const body = buildInviteRequestBody(config);
  const { requestUrl, authUrl } = inviteEndpoints(venue.serviceUrl);

  const payloadHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, body, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  const signed = await signActiveEvent(buildNip98Template(authUrl, payloadHash));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response;
  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        authorization: nip98AuthorizationHeader(JSON.stringify(signed)),
        "content-type": "application/json",
      },
      body,
      signal: controller.signal,
    });
  } catch {
    throw new Error("The venue invite service did not answer. Check the connection and try again.");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("The venue service rejected this staff key for invite creation.");
  }
  if (!response.ok) {
    throw new Error(`The venue invite service could not create the invite (HTTP ${response.status}). Try again.`);
  }

  let parsed: InviteServiceResponse;
  try {
    parsed = parseInviteResponse(await response.json());
  } catch (error) {
    throw error instanceof Error ? error : new Error("The invite service returned an unreadable response.");
  }

  // Honest result: the confirmed terms must match the configured ones before
  // anything is rendered as a successful invite.
  if (parsed.maxRedemptions !== config.maxRedemptions) {
    throw new Error("The invite service confirmed a different redemption limit than requested.");
  }
  if ((parsed.badgeExpiresAt === null) !== (config.membershipDurationSeconds === null)) {
    throw new Error("The invite service confirmed a different membership duration than requested.");
  }

  return {
    response: parsed,
    redeemUrl: buildRedeemUrl({
      serviceUrl: venue.serviceUrl,
      relayUrl: venue.relayUrl,
      token: parsed.token,
    }),
  };
}
