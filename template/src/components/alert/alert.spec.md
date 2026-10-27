# Alert

## Parts
- Root (role alert) with an optional leading icon
- Title
- Description

## States
Variants: default, destructive, success, warning, info.

## Props
`variant`; all div attributes.

## Tokens
alert-<variant>-background, -foreground, -border, -icon, -description; alert-radius.

## Accessibility
role alert announces it when it appears; do not use it for content that is there from the start and never changes (use a plain region). The icon is decorative; the title carries the meaning.
