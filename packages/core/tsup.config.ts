import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/query.ts', 'src/types.ts', 'src/llm-query.ts', 'src/retention.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['sql.js', 'better-sqlite3'],
  platform: 'node',
  target: 'node22',
});