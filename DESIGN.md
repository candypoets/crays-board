<!-- impeccable:design-schema 1 -->

# Crays Board — design direction

## Product mode

Operate. This is a fast, state-rich tool for hosts, venue managers, kitchen staff, and community operators working during service. Familiar controls, immediate status legibility, and reliable touch targets take priority over decorative novelty.

## Thesis

Crays Board is the calm control surface behind a lively Crays venue: a pale service desk set against an after-dark burgundy rail. It should feel social and warm without becoming casual about money, permissions, or guest service.

## Owned world

The product extends the established Crays identity rather than borrowing the Nuts admin appearance. It keeps Crays pink, coral, ink, and blush, then gives them operational jobs:

- deep burgundy is the back-of-house navigation and venue context;
- paper blush is the working surface;
- Crays pink marks primary actions, current location, and urgent live state;
- coral marks attention and hand-off moments;
- mint, amber, and red are reserved for semantic state.

The visual metaphor is a night-shift signal board: live information forms an unbroken service strip, while focused work sits in clean lanes below it.

## Structure

- Large tablet: persistent 232 dp venue rail, context header, wide work canvas.
- Compact tablet: 88 dp icon rail with labels only where space permits.
- Phone: compact venue header and a five-destination bottom bar; secondary destinations live behind More.
- Home: operational headline, continuous live-service strip, then asymmetric work regions for orders and schedule.
- Orders: horizontally readable status lanes following the canonical order state machine.
- Forms: single-column on phone; grouped two-column sections on tablet; sticky or persistent primary action where useful.

## Typography

Use the platform system sans throughout. Hierarchy comes from weight, size, spacing, and selective uppercase labels—not a novelty display face. Numbers that drive service may be large, but labels and controls stay compact and stable.

## Shape and material

- Operational panels use 14–18 dp corners, subtle borders, and flat fills.
- Pills are reserved for status, filters, and genuinely compact actions.
- Primary controls share a consistent 14 dp radius and minimum 48 dp touch height.
- Shadows are sparse and shallow; hierarchy should come mainly from surface contrast and spacing.
- Dense views use dividers and lanes rather than wrapping every row in a card.

## Motion

Motion communicates state only: 150–220 ms selection, reveal, and status transitions. Respect reduced motion. No staged page-load animation.

## Accessibility

- Minimum 48 × 48 dp touch targets for primary touch controls.
- Text and essential state meet WCAG AA contrast.
- State is expressed with text and iconography, never color alone.
- Layout supports dynamic type without clipping core actions.
- All workflows remain usable in portrait and landscape, with phone-sized compositions treated as first-class.

## Voice

Direct, hospitable, and specific: “3 orders need a decision,” “Doors open in 42 min,” and “Invite a host.” Avoid generic dashboard filler, technical relay language in normal workflows, and punitive error copy.

## Anti-patterns

- Do not copy Nuts Cash emerald/neutral admin styling.
- Do not turn the operator app into a scaled-up guest app.
- Do not decorate inactive navigation with saturated Crays colors.
- Do not hide order state, venue context, or permission consequences behind ambiguous gestures.
- Do not rely on hover, tiny controls, or desktop-only tables.
