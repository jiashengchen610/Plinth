# Breadcrumb

## Parts
- Breadcrumb (nav, named "Breadcrumb")
- List (ol)
- Item (li)
- Link: a page above this one
- Page: the current page (aria-current)
- Separator: a chevron by default
- Ellipsis: pages left out of a long trail

## States
Link: default, hover, focus-visible. Page: current.

## Props
Plain element props. `BreadcrumbLink` takes `asChild` to render a router link.

## Tokens
breadcrumb-list-foreground, breadcrumb-list-font, breadcrumb-link-foreground-hover, breadcrumb-page-foreground;
duration-fast; ring.

## Accessibility
A nav landmark named "Breadcrumb", an ordered list, and the current page marked with aria-current. Separators are
hidden from screen readers.
