// Ambient declaration for global (side-effect) CSS imports, e.g.
//   import "./globals.css";   (app/layout.tsx)
//
// TypeScript 6 enables `noUncheckedSideEffectImports` by default, and Next 16
// only ships declarations for CSS Modules (`*.module.css` / `.scss` / `.sass`)
// via its editor plugin — not for bare global stylesheets, and the plugin does
// not apply during `tsc` / `next build`. Without this, the production build
// fails with TS2882 on the globals.css import. CSS Modules keep their typed
// class maps because Next's more specific `*.module.css` declaration wins.
declare module "*.css";
