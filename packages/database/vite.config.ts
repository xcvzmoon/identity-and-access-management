import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: {
      index: 'src/index.ts',
      schema: 'src/schema/index.ts',
    },
    dts: true,
    exports: true,
  },
});
