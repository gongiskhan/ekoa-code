import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * web/ unit test config (ch12 W5, FC-307). Runs the ported frontend unit estate under
 * web/__tests__ (jsdom + Testing Library) plus any src/** tests. The transport-mocking tests
 * mock the NEW typed client (web/lib/api). framer-motion and zustand ship ESM that calls React
 * hooks during render, so they are inlined to resolve the SAME React as the renderer (else their
 * hooks read from a null React); react/react-dom are deduped for the same reason.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
    globals: true,
    include: ['__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'e2e/**'],
    passWithNoTests: true,
    css: false,
    server: {
      deps: {
        // Inline these so the react/react-dom aliases below reach them. node_modules packages are
        // externalized (Node-resolved) by default, which would let @testing-library/react resolve
        // the root react@18 (mismatched with root react-dom@19) instead of web's react@19 - the
        // "Invalid hook call". Inlining routes them through vite's aliased resolution.
        inline: [
          'framer-motion',
          'zustand',
          '@testing-library/react',
          '@testing-library/dom',
          '@testing-library/user-event',
        ],
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
    // One react@19 + react-dom@19 workspace-wide (api's unused react was aligned to 19 so the
    // whole tree hoists a single copy); dedupe keeps it that way for the Testing Library renderer.
    dedupe: ['react', 'react-dom'],
  },
});
