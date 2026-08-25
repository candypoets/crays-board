# Crays Board UI/UX improvement proposal

This package focuses on the three most representative staff workflows: Home, Orders, and Event check-in. The proposals preserve the existing Crays identity and product truth while making the tablet experience faster to scan during live service.

## Review first

- [Overview contact sheet](./overview.png) — all four proposal states at a glance
- [Home proposal](./proposals/01-home-proposal.png) — decision-first venue overview
- [Orders proposal](./proposals/02-orders-proposal.png) — four-stage service board
- [Check-in ready](./proposals/03-check-in-ready-proposal.png) — focused door mode
- [Check-in accepted](./proposals/04-check-in-accepted-proposal.png) — high-salience, reversible result
- [Check-in feedback GIF](./motion/check-in-feedback.gif) — 4.5-second ready → accepted → ready loop
- [Image-generated exploration](./exploration/imagegen-concept-board.png) — divergent visual concept used before the precise layouts

Editable SVG sources sit beside every proposal PNG.

## Direction

The interface becomes a “night-shift signal board”: deep burgundy holds venue context, blush is the working canvas, and vivid pink appears only where staff need to locate or act. Semantic blue, coral, amber, green, and red communicate named states rather than decoration.

The core shift is from showing everything as equally important to showing the next operational decision:

- Home leads with “3 need a decision,” then keeps tonight’s hand-off and quick actions in reach.
- Orders uses the canonical New → Accepted → Preparing → Ready topology on tablets.
- Check-in removes global navigation during the door task and gives the scanner, progress, result, manual fallback, and undo action one stable composition.

## Findings from the captured app

1. **The product exposes infrastructure instead of venue context.** Relay addresses such as `10.0.2.2:39167` and the raw `kind:27236` placeholder are useful for diagnostics but slow staff down in normal service.
2. **Home uses only a shallow strip of a large tablet.** Four summaries and four actions compete in one row while most of the canvas is empty; urgent orders do not dominate.
3. **Orders is a phone-shaped list on a tablet.** It hides the service ladder, gives elapsed time modest weight, and leaves most of the landscape width unused.
4. **Check-in’s largest region is visually empty.** Manual protocol entry appears more concrete than scanning, and the success message is detached from the scanner’s focal area.
5. **Venue and operator context are weak.** The current rail is primarily text links; staff moving between venues need a stronger selected venue, service state, active destination, and order count.
6. **The fresh Welcome capture shows a contrast regression.** “Create venue” renders nearly white on the blush canvas. This is outside the three-screen proposal, but should be treated as a release-blocking visual defect.

## Screen improvements

### Home

- Replaces the generic summary row with one continuous live-service strip.
- Promotes actionable orders into a dense lane with oldest-first timing and one next action per row.
- Makes tonight’s event a true hand-off surface with doors, attendance, and direct check-in.
- Keeps quick actions secondary and compact instead of giving them the same weight as live risk.
- Hides relay language behind diagnostics and uses the venue name and service state in normal UI.

### Orders

- Restores the committed four-lane tablet model: New, Accepted, Preparing, Ready.
- Keeps count, elapsed time, item, pickup context, and next valid action visible without opening detail.
- Uses named states and labels in addition to color.
- Keeps cancellation and secondary actions in a low-salience overflow/secondary target.
- Explains delayed movement in human language: the card moves after the venue confirms the change.

### Event check-in

- Introduces a focused door mode with no persistent app rail.
- Keeps event name, door state, and attendance visible while scanning.
- Makes manual entry a durable fallback but removes raw protocol syntax from the first view.
- Turns successful entry into a large scanner-area state, then returns automatically to scanning.
- Adds an explicit undo path for operator mistakes and keeps a recent-entry record on screen.

## Mobbin references

Mobbin was used for interaction evidence, not visual copying:

- [Square order status screen](https://mobbin.com/screens/6fb72903-0b5a-4f0d-9018-1e3f4395ea9e) — useful contextual status change and immediate confirmation; the modal status picker was not carried over because one-step service transitions should stay faster.
- [Square “Marking as ready” flow](https://mobbin.com/flows/9f4c44a0-8b2e-4e5f-b296-a26679db019a) — informed visible acknowledgement after a state change.
- [Posh ticket scanner](https://mobbin.com/screens/2b6dd42a-7f2b-45a2-a27d-ebd7f88976b4) — informed persistent progress and a strong scanning focal area.
- [Luma guest check-in flow](https://mobbin.com/flows/74bc6276-56b0-44b9-9a2b-cd8ed27f650f) — informed immediate success feedback and a reversible check-in.
- [Eventbrite event dashboard](https://mobbin.com/screens/0470acb6-b4d1-4b88-a6b7-915d026eed75) — informed keeping event context and the next recommended action close together.

The Crays service strip, burgundy venue rail, order ageing treatment, focused door mode, and final compositions are original to this proposal.

## Capture provenance

- `baseline/00-welcome-current.png` was captured from the current Android build on 2026-08-11 with `npm run qa:welcome` after rebuilding the development client to include `expo-crypto`. The scenario passed.
- The current relay-backed runs could not provision their temporary venue because the shared coordinator rejected the repo fixture signer. An isolated coordinator accepted the signer but its direct-port relay failed readiness. Its temporary state was removed and shared infrastructure was not changed.
- `baseline/01-home-maestro-2026-08-04.png`, `02-orders-maestro-2026-08-03.png`, and the two check-in baselines are the latest successful saved Maestro artifacts for those flows. Current source, `PRODUCT.md`, and `DESIGN.md` were also reviewed so the proposal does not rely on screenshots alone.

## Validation

- Proposal PNGs: 1600 × 1000.
- Touch controls are designed around 48dp minimum targets.
- Essential state is expressed with text and shape as well as color.
- Key text pairs meet WCAG AA in the proposal: ink/paper 16.27:1, muted/paper 5.94:1, white/pink-dark actions 5.88:1, and semantic text on its soft surface is at least 4.60:1. Vivid pink remains available for non-text focus and selection signals.
- The GIF is 800 × 500, 36 frames, 4.51 seconds, and approximately 108 KB.
- No application source files were changed; this folder is a design-only handoff.
