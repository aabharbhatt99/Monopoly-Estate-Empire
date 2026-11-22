// Assembles dist-artifact/estate-empire.html: the whole game inlined into one page body.
// Usage: npm run build:artifact
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

execSync('npx vite build --config vite.artifact.config.ts', { stdio: 'inherit' });

const js = readFileSync('dist-artifact/game.js', 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const css = readFileSync('dist-artifact/game.css', 'utf8').replace(/<\/style/gi, '<\\/style');

const html = `<title>Estate Empire</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@700;800;900&display=swap" rel="stylesheet">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;

writeFileSync('dist-artifact/estate-empire.html', html);
console.log(`\nWrote dist-artifact/estate-empire.html (${(html.length / 1024).toFixed(0)} KB)`);
