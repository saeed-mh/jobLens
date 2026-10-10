import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Render our small, controlled Markdown policy without a remote library or script.
export async function writePrivacyPage(root) {
  const source = await readFile(path.join(root, 'PRIVACY.md'), 'utf8');
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const inline = value => escape(value)
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const body = source.trim().split(/\r?\n\s*\r?\n/).map(block => {
    if (block.startsWith('# ')) return `<h1>${inline(block.slice(2))}</h1>`;
    if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
    return `<p>${inline(block.replace(/\r?\n/g, ' '))}</p>`;
  }).join('\n');
  const folder = path.join(root, 'dist/privacy');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'privacy.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Job Lens privacy policy</title><link rel="stylesheet" href="../styles.css"></head><body class="options"><main class="card">${body}</main></body></html>\n`);
}
