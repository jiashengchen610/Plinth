# Dialog

## Parts
- Root
- Trigger
- Overlay (backdrop)
- Content (role dialog, portal) with close button (x icon)
- Header, Title, Description, Footer, Close

## States
Closed, open, opening, closing.

## Props
Radix Dialog props: `open`, `defaultOpen`, `onOpenChange`, `modal`. Content: `showCloseButton`.

## Tokens
dialog-overlay; dialog-content-background, -foreground, -border; dialog-description-foreground; dialog-radius; dialog-shadow; layer-dialog; duration-slow; ease-enter.

## Accessibility
Focus moves into the dialog and stays there; Escape and the close button close it; focus returns to the trigger. Labelled by the Title, described by the Description.
