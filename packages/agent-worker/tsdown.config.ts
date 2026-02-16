import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/interface/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
})
