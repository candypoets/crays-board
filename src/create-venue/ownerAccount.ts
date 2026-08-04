import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

import { installStaffIdentity } from "@/account/account";

/**
 * Owner staff-account custody choices for Create Venue step 3 (CREATE-03).
 * Both paths install the signer through the shared account boundary; the raw
 * secret is never logged, stored in component state, or shown incidentally.
 */

/** Deliberate on-device account creation. Returns the new public identity. */
export async function createDeviceOwnerAccount(): Promise<string> {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  await installStaffIdentity(nip19.nsecEncode(secret));
  return pubkey;
}

/** Import an existing account from its nsec. Returns the public identity. */
export async function importOwnerAccount(nsec: string): Promise<string> {
  const identity = await installStaffIdentity(nsec.trim());
  return identity.pubkey;
}
