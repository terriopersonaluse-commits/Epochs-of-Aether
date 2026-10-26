// Bundles the game into a single self-contained dist/index.html.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const result = await build({
  entryPoints: ['src/ui/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
});

const js = result.outputFiles[0].text;
const css = await readFile('src/ui/styles.css', 'utf8');
const template = await readFile('src/ui/index.html', 'utf8');
const body = template
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js.replace(/<\/script/gi, '<\\/script'));

// index.html: a complete standalone page (GitHub Pages, opening the file directly).
const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#10151c">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:border-box}[hidden]{display:none!important}</style>
${body}
</html>
`;

await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', page);
// fragment.html: the same page without the document shell, for hosts that wrap it themselves.
await writeFile('dist/fragment.html', body);
console.log(`dist/index.html written (${(page.length / 1024).toFixed(1)} KB)`);
