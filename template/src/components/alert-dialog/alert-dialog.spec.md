# Alert dialog

## Parts
- Trigger
- Overlay
- Content (role alertdialog), default or small
- Header, Media (an icon tile), Title, Description
- Footer: Cancel (a Button, outline by default) and Action (a Button)

## States
Closed, open; default or small size; with or without media.

## Props
Radix AlertDialog props: `open`, `defaultOpen`, `onOpenChange`. `AlertDialogContent`: `size` ("default" or "sm").
Action and Cancel take Button `variant` and `size`.

## Tokens
alert-dialog-radius, -shadow, -overlay, -content-background, -content-foreground, -content-border,
-footer-background, -footer-border, -title-font, -description-font, -description-foreground, -media-background,
-media-foreground, -media-radius (fits inside); layer-dialog; duration-normal; ease-enter.

## Accessibility
Announced as an alert dialog with its title and description. Focus moves to Cancel and stays inside; Escape and
Cancel close it; clicking outside does not. Use it only for a decision that cannot be undone; name the action
("Delete account"), not "OK".
