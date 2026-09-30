// Builds dist/ for the claude.ai Artifact preview. The viewer supplies <html>, <head> and <body> itself,
// and allows no service worker or Firebase connection, so the preview keeps the page's title, stylesheet
// and body, and starts the app without sync. Like the hosted app, it starts empty.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const title = html.match(/<title>.*?<\/title>/)[0];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].trim();

mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/index.html', root), `${title}
<link rel="stylesheet" href="css/app.css">
<script type="module" src="entry.js"></script>
${body}
`);
writeFileSync(new URL('dist/entry.js', root), `import { start } from './js/app.js';
start();
`);
console.log('dist/index.html and dist/entry.js written');
