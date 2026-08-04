#!/usr/bin/env node
// Invites scenario verifier. Independent truth per venue-commerce-nip §11 and
// PRD §8.8 — never from rendered UI alone:
//   1. The venue invite service enforces the NIP-98 binding exactly: probes
//      with a wrong u tag, wrong method tag, wrong payload hash, or an
//      unauthorized signer are all rejected, so the invite the app created
//      could only exist bound to the exact URL/method/payload (INVITE-02).
//   2. A correctly bound probe invite decodes to claims with the exact
//      requested expiry/duration/max, and its HMAC signature verifies against
//      the relay's invite secret — this service instance mints exact invites.
//   3. Relay truth: invite creation is a scoped HTTP side effect — no
//      invite-related event (no extra kind 8 award) appears on the relay.
//   4. Device truth: exactly one [crays-board-invite] marker (INVITE-03
//      double-tap idempotency) with the created invite's exact unsigned
//      claims, and no raw token anywhere in it.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { assert, emulatorUrl, getRelaySecrets, loadKeys, makePool, nip98Header, readState } from './relay-lib.mjs';

const state = readState();
if (!state?.base_url || !state?.invite_token || !state?.award_id) {
  throw new Error('run .qa/relay-bootstrap-invites.mjs first');
}
const keys = loadKeys();
const stranger = keys.users[0];
if (!stranger) throw new Error('keys.json exposes no fixture users');
const endpoint = `${state.base_url}/invites`;
const nowSeconds = () => Math.floor(Date.now() / 1000);

const postInvites = (header, body) =>
  fetch(endpoint, {
    method: 'POST',
    headers: { authorization: header, 'content-type': 'application/json' },
    body,
  });

// 1. Service identity.
const infoResponse = await fetch(`${state.base_url}/community/info`);
assert(infoResponse.ok, 'invite service answers /community/info');
const info = await infoResponse.json();
assert(info.relay_url === state.relay_url, 'service advertises the exact venue relay');
assert(/^30009:[0-9a-f]{64}:.+$/i.test(info.required_badge || ''), 'service advertises the required badge');

// 2. NIP-98 binding enforcement (INVITE-02): exact URL, method, payload, signer.
const probeBody = JSON.stringify({ expires_in_seconds: 3600, badge_expires_in_seconds: 604800, max_redemptions: 3 });

const wrongUrl = await postInvites(nip98Header(`${state.base_url}/invites-other`, 'POST', probeBody, keys.admin.priv), probeBody);
assert(wrongUrl.status === 401, 'NIP-98 with a wrong u tag is rejected');
const wrongMethod = await postInvites(nip98Header(endpoint, 'GET', probeBody, keys.admin.priv), probeBody);
assert(wrongMethod.status === 401, 'NIP-98 with a wrong method tag is rejected');
const wrongPayload = await postInvites(nip98Header(endpoint, 'POST', '{"different":true}', keys.admin.priv), probeBody);
assert(wrongPayload.status === 401, 'NIP-98 with a wrong payload hash is rejected');
const unauthorized = await postInvites(nip98Header(endpoint, 'POST', probeBody, stranger.priv), probeBody);
assert(unauthorized.status === 401, 'NIP-98 from an unauthorized signer is rejected');

// 3. Positive probe: exact binding succeeds and mints exact, verifiable claims.
const positive = await postInvites(nip98Header(endpoint, 'POST', probeBody, keys.admin.priv), probeBody);
assert(positive.ok, 'NIP-98 bound to the exact URL/method/payload is accepted');
const probe = await positive.json();
assert(probe.max_redemptions === 3, 'probe invite carries the exact requested max redemptions');
const [payloadPart, signaturePart] = (probe.token || '').split('.');
assert(Boolean(payloadPart && signaturePart), 'probe invite token has the signed payload.signature shape');
const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
assert(claims.v === 1 && typeof claims.nonce === 'string' && claims.nonce.length > 0, 'probe token claims shape (v, nonce)');
assert(claims.badge === info.required_badge, 'probe invite is bound to the venue required badge');
assert(claims.max === 3, 'probe invite claims carry the exact max redemptions');
const probeNow = nowSeconds();
assert(Math.abs(claims.exp - (probeNow + 3600)) <= 120, 'probe claim expiry is exactly 1 hour out');
assert(Math.abs(claims.badge_exp - (probeNow + 604800)) <= 120, 'probe membership duration is exactly 7 days out');
const secrets = await getRelaySecrets(state.id, keys);
assert(/^[0-9a-f]{64}$/i.test(secrets.invite_secret || ''), 'relay exposes its invite secret to the coordinator admin');
// The invite service (strfry-badge-node crates/invite) HMACs with the raw
// string bytes of INVITE_SECRET (`required_env(...)?.into_bytes()`), not the
// hex-decoded bytes — the key encoding must match exactly.
const expectedSignature = createHmac('sha256', Buffer.from(secrets.invite_secret, 'utf8'))
  .update(payloadPart)
  .digest('base64url');
assert(signaturePart === expectedSignature, 'invite token HMAC verifies against the relay invite secret');

// 4. Relay truth: creation wrote nothing to the relay — exactly the seeded
// fixture award exists, no invite-related kind 8.
const pool = makePool();
const awards = await pool.querySync([state.relay_url], { kinds: [8], limit: 100 });
pool.close([state.relay_url]);
assert(awards.length === 1 && awards[0].id === state.award_id, 'no invite-related award written to the relay');

// 5. Device truth: exactly one invite marker with exact claims, no raw token.
const log = execFileSync('adb', ['logcat', '-d'], { maxBuffer: 64 * 1024 * 1024 }).toString();
const markerPayloads = (marker) =>
  log
    .split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => {
      const start = line.indexOf(marker) + marker.length;
      let payload = line.slice(start).trim();
      if (payload.startsWith("'")) payload = payload.slice(1);
      if (payload.endsWith("'")) payload = payload.slice(0, -1);
      try {
        return JSON.parse(payload);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);

const invites = markerPayloads('[crays-board-invite]');
assert(invites.length === 1, `exactly one [crays-board-invite] marker after the double-tap (${invites.length} found)`);
const marker = invites[0];
assert(marker.max === 5, 'marker reports the configured 5 max redemptions');
assert(
  typeof marker.badge_exp === 'number' && marker.badge_exp - marker.exp === 7776000 - 604800,
  'marker expiries differ by exactly 90 days minus 7 days',
);
const verifyNow = nowSeconds();
assert(marker.exp > verifyNow, 'marker claim expiry is still in the future');
assert(marker.exp <= verifyNow + 604800 + 120, 'marker claim expiry falls inside the configured 7-day window');
assert(marker.service === emulatorUrl(state.base_url).replace(/^https?:\/\//, ''), 'marker names the exact venue service host');
assert(typeof marker.nonce === 'string' && marker.nonce.length > 0, 'marker carries the invite nonce');

// The marked invite is a distinct, newly minted invite — not the bootstrap
// smoke token and not this verifier's probe.
const smokeNonce = JSON.parse(Buffer.from(state.invite_token.split('.')[0], 'base64url').toString('utf8')).nonce;
assert(marker.nonce !== smokeNonce, 'marked invite is not the bootstrap smoke token');
assert(marker.nonce !== claims.nonce, 'marked invite is not the verifier probe token');

// Forbidden: no raw token in the marker — no token key, neither known token
// as substring, and no token-shaped (payload.signature) value at all.
const serialized = JSON.stringify(marker);
assert(!('token' in marker), 'marker has no token field');
assert(!serialized.includes(state.invite_token), 'marker does not contain the bootstrap smoke token');
assert(!serialized.includes(probe.token), 'marker does not contain the probe token');
assert(!/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(serialized), 'marker carries no token-shaped value');

console.log('CRAYS BOARD INVITE VERIFY PASS');
