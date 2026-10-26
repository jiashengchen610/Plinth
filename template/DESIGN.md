# Shared design guidelines

Applies to every brand. Brand files under brands/<id>/DESIGN.md add or replace sections.

## Layout

- Use the spacing scale only (multiples of 4px through Tailwind utilities).
- One primary action per view; secondary actions use outline or ghost buttons.
- Body text stays under 75 characters per line.

## Components

- Build new UI from existing components first; create a new component only when none fits.
- Every component has a spec (<name>.spec.md) and one story per variant and state.

## Do's and Don'ts

- Do use semantic tokens (bg-primary, text-muted-foreground), never raw values.
- Do keep text contrast at 4.5:1 or more in every brand and mode.
- Don't give every surface the same radius and shadow; vary them by hierarchy.
- Don't put an all-caps label above every heading.
- Don't number sections (01, 02, 03) unless the content is a real sequence.
- Don't accent a single word in a headline with a different color or weight.
