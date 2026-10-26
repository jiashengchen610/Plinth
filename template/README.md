# my-design-system

Design tokens, guidelines and components, generated and maintained with Plinth.

| Path | What it is |
|---|---|
| `tokens/base.tokens.json` | Shared scales: radius, fonts, typography, shadows, motion (DTCG) |
| `brands/<id>/tokens.json` | Each brand's semantic colors, light and dark (DTCG) |
| `DESIGN.md`, `brands/<id>/DESIGN.md` | Design guidelines: shared, then per brand |
| `WRITING.md` | Voice, tone and interface copy rules |
| `src/components/<name>/` | Component, stories and spec |
| `src/styles/tokens.css` | Generated from the token files. Do not edit. |

```bash
npm install
npm run storybook   # browse components; switch brand and mode in the toolbar
npm test            # interaction and accessibility tests for every story
```
