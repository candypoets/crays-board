# Agent Device journeys

The native `.ad` scripts in `flows/` are the canonical public-UI journeys for
Crays Board. They are plain text, versioned with the app, and can be handed to
another agent without translating selectors into a framework-specific YAML
format.

Run journeys through the repository wrappers so each flow gets the correct
fixture, development client, coordinator, evidence directory, independent
relay verifier, and teardown:

```sh
npm run qa:welcome
npm run qa:people
npm run qa:all:phone
npm run qa:all:tablet
```

`qa:all:*` reuses a running emulator and skips reinstalling the development
APK when its SHA-256 already matches the current build. It still checks the
device dimensions, APK bytes, coordinator identity, Metro environment, Jest,
types, lint, and relay truth before evidence can become canonical.

## Repairing a changed flow

Agent Device reports the exact divergent step and ranked selector candidates.
For a flow whose fixture is already active, an agent can repair interactively:

```sh
npx agent-device replay e2e/flows/40-people.tablet.ad \
  --device "crays samsung tab" --keep-session --save-script=/tmp/people-repaired.ad
```

On divergence, use the reported `--from` and `--plan-digest` values to resume
without replaying completed steps. Review the repaired file, copy intentional
changes back to `e2e/flows/`, then run its `npm run qa:<scenario>` wrapper. Do
not commit fixture secrets or private keys; the wrapper keeps relay seeding out
of the saved plan and injects only variables that the selected flow references.

Jest is deliberately not replaced by Agent Device. Jest checks deterministic
folding and protocol logic quickly; `.ad` checks the public UI; `.qa` verifiers
independently check relay/service state. A release-quality result requires all
three layers.
