import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/server.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['@actis/core'],
  platform: 'node',
  target: 'node22',
});