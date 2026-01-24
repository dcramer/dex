import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://dcramer.github.io',
  base: '/dex',
  integrations: [mdx()],
  markdown: {
    shikiConfig: {
      theme: 'vitesse-black',
    },
  },
});
