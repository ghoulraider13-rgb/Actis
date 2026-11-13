import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/server.ts', 'src/mcp/server.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['@actis/core', './mcp/server.js'],
  platform: 'node',
  target: 'node22',
});