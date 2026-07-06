---
name: left-nav-shell
description: The canonical app shell for app-auth-persistent — top bar, left nav, content area
---

# Left-Nav Shell

```
+----------------------------------------------------------+
| TopBar  (h: 48px, bg: var(--color-surface), shadow.sm)   |
|  [App Name]                          [User · Logout]     |
+----------------------------------------------------------+
|              |                                           |
| LeftNav      | Content                                   |
| (w: 220px,   |  (max-width: 1200px, padding: spacing.lg) |
|  bg:         |                                           |
|  surface,    |  <Page>                                   |
|  border-     |    <Header />                             |
|  right:      |    <ErrorBoundary>                        |
|  border)     |      <DataView />                         |
|              |    </ErrorBoundary>                       |
|  [Home]      |    <EmptyState if empty />                |
|  [Contacts]  |  </Page>                                  |
|  [Settings]  |                                           |
|              |                                           |
+----------------------------------------------------------+
```

## Structure

- **TopBar (48px)** — app name on the left (typography.h2, color var(--color-text)), optional user widget on the right.
- **LeftNav (220px desktop, drawer mobile)** — vertical list of nav links. Each link has a 16px icon (lucide-react) + label (typography.body). Active link gets var(--color-primary) text and a soft background tint.
- **Content area** — flex-grow, scrolls vertically, padding var(--spacing-lg), max-width 1200px on wide screens (centered if wider).

## Responsive

- `<768px`: LeftNav collapses behind a hamburger button in the TopBar. Tap-to-toggle drawer.
- `768-1024px`: LeftNav narrows to 64px (icons only). Tooltips on hover.
- `>1024px`: Full LeftNav at 220px.

## Routing

Use React Router. The base ships `App.jsx` with the shell already wired around `<Routes>`. Add page routes inside.

## Variants

- **Dense** (default): paddings spacing.md, typography.body.
- **Comfortable** (set via prop on `<Shell density="comfortable">`): paddings spacing.lg, typography.body but with larger line-height.
