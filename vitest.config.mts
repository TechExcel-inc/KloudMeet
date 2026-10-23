import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror tsconfig `paths` so tests can import modules that use `@/…`.
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
  test: {
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/.next/**', 'figma-design/**'],
  },
});
