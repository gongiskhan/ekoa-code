---
name: left-nav-shell
description: The canonical app shell for the app base - top bar, left nav, content area, assistant mount
---

# Left-Nav Shell

This is the shell `frontend/src/App.jsx` already implements. It is a reference for how it fits together, not something to rebuild.

```
+----------------------------------------------------------+
| TopBar  (h: 48px, bg: var(--color-surface), shadow-sm)   |
|  [App Name]                              [Current User]   |
+----------------------------------------------------------+
|              |                                           |
| LeftNav      | Content                                   |
| (w: 220px,   |  (max-width: 1200px, padding: space-8)    |
|  bg:         |                                           |
|  surface,    |  <ErrorBoundary>                          |
|  border-     |    <ActivePage>                           |
|  right:      |      <Header />                           |
|  border)     |      <DataView /> | <EmptyState />        |
|              |    </ActivePage>                          |
|  [Início]    |  </ErrorBoundary>                         |
|  [ ... ]     |                                           |
|              |                                           |
+----------------------------------------------------------+
| <div id="ekoa-assistant-root">  (empty until a later slice) |
+----------------------------------------------------------+
```

## Structure

- **TopBar (48px)** - app name on the left (`--text-lg`, `var(--color-text)`), the current user on the right (`--text-sm`, `var(--color-text-muted)`).
- **LeftNav (220px desktop, wraps on mobile <768px)** - one button per registered page. The active button gets `var(--color-primary)` text and a `var(--color-surface-muted)` tint.
- **Content area** - flex-grow, scrolls vertically, `padding: var(--space-8)`, max-width 1200px (centered when wider). Wrapped in `<ErrorBoundary>`.
- **Assistant mount** - the empty `#ekoa-assistant-root` node the platform assistant runtime fills in a later slice.

## Responsive

- `<768px`: LeftNav becomes a horizontal, wrapping row above the content.
- `>=768px`: Full LeftNav at 220px on the left.

## Navigation

Pages live in the `PAGES` array in `App.jsx` (`{ id, label, component }`); the shell renders the active one from local state. Add pages by extending that array - do not replace the nav. Add a router only if the app needs deep-linkable URLs.

## Regions every page should include

1. **Header** with the page title.
2. **Empty state** when a collection is empty (`empty-state` recipe).
3. **Error boundary** around any data-rendering subtree (`ErrorBoundary`, already at the page root).
