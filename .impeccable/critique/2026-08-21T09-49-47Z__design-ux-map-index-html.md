---
target: 31-screen Crays Board UX map screenshot review
total_score: 16
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
timestamp: 2026-08-21T09-49-47Z
slug: design-ux-map-index-html
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2 | Status text is strong, but post-action scroll positions hide context. |
| 2 | Match System / Real World | 2 | Hospitality language is mixed with raw relay hosts and protocol identity. |
| 3 | User Control and Freedom | 2 | Some safe exits exist, but undo and recovery paths are inconsistent. |
| 4 | Consistency and Standards | 1 | Navigation, action treatments, tabs, and compact layouts visibly diverge. |
| 5 | Error Prevention | 2 | Confirmation exists for cancellation; other consequential changes need clearer guardrails. |
| 6 | Recognition Rather Than Recall | 2 | Labels help, but clipped venue/event context forces memory. |
| 7 | Flexibility and Efficiency | 1 | No visible bulk actions, role presets, or expert accelerators. |
| 8 | Aesthetic and Minimalist Design | 1 | Calm palette, but card overuse, whitespace, clipping, and weak hierarchy dominate. |
| 9 | Error Recovery | 2 | Errors are readable but often lack a strong next action. |
| 10 | Help and Documentation | 1 | Inline hints exist, but contextual operational help is absent. |
| **Total** | | **16/40** | **Poor — major correction required before service use.** |

## Design Specificity Verdict

Crays Board is structurally product-specific but visually under-resolved. The pink/blush/burgundy identity, venue operations, order states, memberships, and check-in clearly belong to Crays. The execution still resembles a themed admin prototype: generic tall cards, oversized headings, raw service IPs, weak primary actions, and inconsistent compact layouts obscure the intended “night-shift signal board.”

The deterministic scan found one `flat-type-hierarchy` warning at `design/ux-map/index.html:16`. It applies to the UX-map wrapper, not typography inside the PNG captures, and is low-value for this app critique. Headless browser inspection confirmed all 31 images load. It also found that the canvas itself becomes nearly unusable at phone width because its nine-column world scales every screen to roughly 29×65 px beneath a tall HUD.

## Overall Impression

The product language and state semantics are promising. The largest opportunity is to establish one robust compact operational shell: correct navigation, stable gutters, visible primary actions, and state changes that never displace the operator's context.

## What's Working

- Status semantics combine text and color: New, Accepted, Served, Published, Available, Expiring soon, and check-in outcomes remain understandable without color alone.
- High-stakes copy is specific. The cancel-order dialog names the consequence; camera-unavailable copy provides manual entry.
- The calm Crays palette is recognizable and appropriate for a warm back-of-house tool.

## Priority Issues

### P1 — Bottom navigation is visually collapsed

Across every AppShell capture, `HomeOrdersMenuEventsMore` is concatenated at the lower left instead of becoming five equal destinations. It cannot credibly provide 48 dp touch targets and overlaps content in People.

**Fix:** Use a real five-cell compact navigation bar with icon plus label, explicit active state, safe-area padding, and matching bottom content inset. Keep expanded widths on a rail/drawer.

**Suggested command:** `$impeccable adapt`

### P1 — Compact states clip, overlap, or preserve misleading scroll positions

Representative failures: `20-menu-edited.png`, the four post-action Check-in captures, `40-people-assigned.png`, `40-people-list.png`, and `80-home-summary.png`. Titles, metadata, and confirmations collide or leave the viewport after mutations.

**Fix:** Use one shrinkable phone column with consistent gutters; allow title/metadata wrapping; reserve header-action width; add bottom insets; and deliberately restore or anchor scroll after state changes. Test default and enlarged text.

**Suggested command:** `$impeccable adapt`

### P1 — Primary operational actions lack contrast and hierarchy

Create venue, Create event, Open venue, Check in, and positive order progression are invisible or insufficiently prominent in the captures. A service operator should never have to infer the next state transition.

**Fix:** Standardize a 48 dp vivid-pink filled primary action with AA text and 14 dp radius. Give each live order state one explicit positive action; keep Decline/Cancel secondary and separated. Put phone actions in a sticky lower thumb-zone region where appropriate.

**Suggested command:** `$impeccable layout`

### P1 — Operational density and prioritization are too weak

Home exposes eight local choices, role editing shows six simultaneous permission switches, and most dense data is wrapped in tall cards. Orders lack a dominant urgency lane or bulk progression path.

**Fix:** Replace repeated cards with compact rows/lanes, group secondary actions behind progressive disclosure, add role presets, and prioritize wait time and required decisions over decorative whitespace.

**Suggested command:** `$impeccable distill`

### P2 — Venue identity and QA capture chrome obscure product truth

Raw `10.0.2.2` relay hosts are more persistent than the human venue name. The floating gear is development-client chrome, not app UI; the Invite share tray is Android system UI; `70-create-venue-home.png` captures an intermediate connecting state. These artifacts make the UX map unreliable as a clean design baseline.

**Fix:** Lead with venue name and role; move connection details into diagnostics. Add clean capture mode, wait for stable terminal screen states, reset intentional scroll where required, and separately label OS handoff screenshots.

**Suggested command:** `$impeccable polish`

## Cognitive Load

Seven of eight checks fail; grouping is the only consistent pass. More-than-four decision points include the five global destinations, eight Home choices, five People rows, six role permissions, and Menu search plus four filters. The interface needs progressive disclosure and clearer task priority, not more decoration.

## Persona Red Flags

**Alex — power user:** No visible keyboard shortcuts, bulk order/menu actions, or role presets. One-at-a-time workflows will be slow during service.

**Sam — accessibility-dependent user:** Critical CTA contrast is weak, the bottom bar cannot plausibly expose distinct targets, and default-size clipping implies Dynamic Type failures. Screen-reader context after state changes is at risk.

**Casey — distracted mobile operator:** The thumb zone is occupied by a broken bar, urgent actions sit high or disappear, and post-check-in scroll shifts hide the event identity.

**Morgan — floor manager:** Raw hosts do not answer “which venue am I operating?”, order urgency is not prioritized, and missing/weak positive order actions risk incorrect guest-facing fulfillment truth.

## Minor Observations

- Large phone titles consume too much operational viewport.
- Settings' fixed four-tab row has no safe fallback for Dynamic Type or translation.
- Status capitalization and action styling vary.
- Edit, Refresh, Assign role, and availability actions often resemble ordinary text.
- Empty Orders and Payments states leave excess space without useful next actions.
- Protocol terms such as pubkey/npub and raw relay addresses should stay behind diagnostics.
- The canvas wrapper itself needs a phone-aware overview/list mode; its default reset scale is not inspectable on mobile.

## Questions to Consider

- If a new order arrives during a loud service rush, where is the one unmistakable action to accept it?
- Why is a relay IP more persistent than the venue name?
- Should a successful check-in ever hide the event name and expected/checked-in context?
- What would the phone experience gain if half the cards became compact operational rows?
