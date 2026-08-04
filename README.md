# Crays Board

Tablet-first React Native operator dashboard for Crays hospitality and community venues.

## Run

```sh
npm install
npm run start
```

Use `npm run android` for a development build or press `a` from the Expo development server when a compatible Android emulator is running.

The current build is an interactive UI prototype. Data in `src/data/sample.ts` is presentation-only and is intentionally isolated so relay/coordinator adapters can replace it.

## Target layouts

- Large tablet (840 dp and above): full venue rail and wide working canvas.
- Compact tablet (600–839 dp): icon rail and adaptive task layouts.
- Phone (below 600 dp): compact venue header and five-destination bottom bar.

Product requirements are documented in [PRD.md](./PRD.md), and the committed visual system is in [DESIGN.md](./DESIGN.md).
