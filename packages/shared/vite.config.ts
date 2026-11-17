import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: {
      types: 'src/types/index.ts',
      utils: 'src/utils.ts',
    },
    dts: true,
    exports: true,
  },
});
