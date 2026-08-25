# Image-generation record

The built-in image-generation tool was used for the divergent concept board at [`exploration/imagegen-concept-board.png`](./exploration/imagegen-concept-board.png). The four local baseline screenshots were reference images: Welcome supplied the brand world, while Home, Orders, and Check-in supplied product content and density. The output was treated as exploration; final screen text and layout were rebuilt as editable SVGs so labels remain exact.

## Prompt

```text
Use case: ui-mockup
Asset type: original UI design exploration board for a tablet-first React Native hospitality operations app
Input images: Image 1 is the current Crays Board brand and welcome visual language; Image 2 is the current Home content baseline; Image 3 is the current Orders content baseline; Image 4 is the current Event check-in baseline. Use them as product/content references, not pixel-edit targets.
Primary request: Create one polished landscape concept board showing three separate 16:10 tablet screens side by side: Home, Orders, and Event check-in. Make it feel authored for Crays Board: a calm service desk behind a lively after-dark venue.
Scene/backdrop: presentation board on deep burgundy with three clearly separated app screen frames.
Style/medium: realistic shippable product UI, not concept art; tablet-native Material 3 structure with a persistent venue rail on Home and Orders, and a focused distraction-free door mode for Check-in.
Composition/framing: Home uses an operational headline, an unbroken live-service strip, a dense order attention lane, tonight's event, and concise quick actions. Orders uses four horizontally readable lanes New, Accepted, Preparing, Ready with strong elapsed-time hierarchy and one next-step action per card. Check-in uses a large dark scanner viewport, persistent event/progress context, manual fallback, and immediate success feedback.
Color palette: Crays dark night #160A11, vivid pink #F50A48, coral #FF7668, paper blush #FFF7F8, ink #2B1420, plus restrained semantic mint/amber/red.
Materials/textures: flat operational surfaces, 14–16px corners, subtle borders, almost no shadow; no glass.
Text (verbatim where visible): "Crays Board", "3 orders need a decision", "New", "Accepted", "Preparing", "Ready", "Event check-in", "1 of 2 checked in", "Scan guest pass", "Manual entry", "Entry accepted".
Constraints: keep every screen practical at 1600×1000, minimum 48dp controls, legible high-contrast typography, no fabricated revenue metrics, no protocol or relay jargon, no desktop-only tables, no decorative gradient text, no logos other than the simple Crays sparkle mark, no watermark. Do not copy the Mobbin references; synthesize original layouts from the product constraints and captured content.
```

Mode: built-in image generation. No CLI/API fallback was used.
