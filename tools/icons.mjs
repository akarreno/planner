// Draws the app icon in every variant from one drawing, with headless Chromium (Playwright).
//   icons/                 the web app's Home Screen icons (a web app gets one icon, so it uses the dark one)
//   design/icon/*.png      light, dark and tinted 1024 px versions for a future native app
//   design/icon/*.svg      the icon's layers, for Xcode's Icon Composer (background color is set there)
// Run: node tools/icons.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

// The artwork on a 100 × 100 grid: two dim lines above a red "now" rule, two bright lines below.
// Each line is a short time block and a longer text block.
const ROWS = [[27, 26, 0.55], [41, 36, 0.55], [63, 30, 1], [77, 20, 1]];
const bar = (x, y, w, fill, opacity) => `<rect x="${x}" y="${y}" width="${w}" height="7" rx="3.5" fill="${fill}" fill-opacity="${opacity}"/>`;
const lines = ink => ROWS.map(([y, w, a]) => bar(24, y, 13, ink, a) + bar(41, y, w, ink, a * 0.62)).join('');
const now = red => `<rect x="20" y="54.5" width="60" height="3" fill="${red}"/><circle cx="21" cy="56" r="4.2" fill="${red}"/>`;
const svg = (body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${bg ? `<rect width="100" height="100" fill="${bg}"/>` : ''}${body}</svg>`;

const VARIANTS = {
  light: svg(lines('#ffffff') + now('#ff5f5a'), '#2b58d4'),
  dark: svg(lines('#8ba6ff') + now('#ff5f5a'), '#12151b'),
  tinted: svg(lines('#ffffff') + now('#ffffff'), '#000000'),   // iOS colors a grayscale icon with the chosen tint
};

const root = new URL('../', import.meta.url);
writeFileSync(new URL('design/icon/lines.svg', root), svg(lines('#ffffff')));
writeFileSync(new URL('design/icon/now.svg', root), svg(now('#ff5f5a')));

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(markup, size, path) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
  writeFileSync(new URL(path, root), await page.screenshot({ type: 'png' }));
}
for (const [name, markup] of Object.entries(VARIANTS)) await png(markup, 1024, `design/icon/AppIcon-${name}.png`);
const WEB = VARIANTS.dark;
await png(WEB, 512, 'icons/icon-512.png');
await png(WEB, 192, 'icons/icon-192.png');
await png(WEB, 180, 'icons/apple-touch-icon.png');
await browser.close();
console.log('icons written');
