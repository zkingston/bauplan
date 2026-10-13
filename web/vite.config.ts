import { networkInterfaces } from 'node:os';
import { defineConfig, type Plugin } from 'vite';

// The dev server listens only on the Tailscale address. Off the tailnet, it uses localhost.
const tailscale = networkInterfaces().tailscale0?.find((a) => a.family === 'IPv4')?.address;

/** The production build removes the solutions from the levels. */
const noSolutions: Plugin = {
  name: 'no-solutions',
  apply: 'build',
  enforce: 'pre',
  transform(code, id) {
    if (!/\/data\/puzzles\/[^/]+\.json$/.test(id)) return;
    const puzzle = JSON.parse(code);
    delete puzzle.solution;
    return JSON.stringify(puzzle);
  },
};

/**
 * The production build is one HTML file. The scripts and the styles go into the page, and other
 * assets go into the scripts as data URLs.
 */
const singleFile: Plugin = {
  name: 'single-file',
  apply: 'build',
  enforce: 'post',
  config: () => ({
    base: './',
    build: {
      assetsDir: '',
      assetsInlineLimit: () => true,
      chunkSizeWarningLimit: Infinity,
      cssCodeSplit: false,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  }),
  generateBundle(_, bundle) {
    const page = bundle['index.html'];
    if (page?.type !== 'asset') return;
    let html = String(page.source);
    // The tag that loads a file, with its other attributes.
    const tag = (el: string, attr: string, file: string) =>
      new RegExp(`<${el}([^>]*?) ${attr}="[^"]*${file.replaceAll('.', '\\.')}"([^>]*)>`);
    for (const [file, out] of Object.entries(bundle)) {
      if (out.type === 'chunk') {
        // A script cannot contain its own end tag. The one file has no other files to preload.
        const code = out.code
          .trim()
          .replace(/"?__VITE_PRELOAD__"?/g, 'void 0')
          .replace(/<(\/script>|!--)/g, '\\x3C$1');
        html = html.replace(
          new RegExp(tag('script', 'src', file).source + '</script>'),
          (_, a, b) => `<script${a}${b}>${code}</script>`,
        );
      } else if (file.endsWith('.css')) {
        html = html.replace(
          tag('link', 'href', file),
          (_, a, b) => `<style${a}${b}>${String(out.source).trim()}</style>`,
        );
      } else continue;
      delete bundle[file];
    }
    page.source = html;
  },
};

export default defineConfig({
  plugins: [noSolutions, singleFile],
  server: { host: tailscale ?? 'localhost', allowedHosts: ['.ts.net'] },
});
