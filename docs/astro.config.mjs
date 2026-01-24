import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { visit } from 'unist-util-visit';

const base = '/dex';

/** Rehype plugin to prefix internal links with base path */
function rehypeBaseLinks() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'a' && node.properties?.href?.startsWith('/')) {
        node.properties.href = base + node.properties.href;
      }
    });
  };
}

export default defineConfig({
  site: 'https://dcramer.github.io',
  base,
  integrations: [mdx()],
  markdown: {
    shikiConfig: {
      theme: 'vitesse-black',
    },
    rehypePlugins: [rehypeBaseLinks],
  },
});
