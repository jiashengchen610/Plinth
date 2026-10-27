# my-design-system

Design tokens, guidelines and components, generated and maintained with Plinth.

| Path | What it is |
|---|---|
| `tokens/base.tokens.json` | Shared scales: radius, fonts, typography, shadows, motion (DTCG) |
| `brands/<id>/tokens.json` | Each brand's semantic colors, light and dark (DTCG) |
| `DESIGN.md`, `brands/<id>/DESIGN.md` | Design guidelines: shared, then per brand |
| `WRITING.md` | Voice, tone and interface copy rules |
| `src/components/<name>/` | Component, stories and spec |
| `src/foundations/` | Storybook pages for the tokens and guidelines (Introduction, Colors, Typography, Shape, Guidelines). Managed by Plinth; `tokens.generated.json` is regenerated from the tokens |
| `src/styles/tokens.css`, `src/styles/fonts.css` | Generated from the token files (CSS variables; Google Fonts imports). Do not edit. |
| `exports/<brand>/DESIGN.md` | Complete DESIGN.md per brand (Google format), written at publish for other AI tools |
| `design-system.json` | Name, context, brands, accepted check exceptions |

```bash
npm install
npm run storybook   # browse components; switch brand and mode in the toolbar
npm run typecheck   # TypeScript
npm test            # interaction and accessibility tests for every story
```
