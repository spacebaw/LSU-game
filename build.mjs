#!/usr/bin/env node
// Build: inline src/style.css and every JS module listed in src/manifest.json
// (in order) into src/index.template.html, producing ONE self-contained index.html.
// Usage: node build.mjs            → writes ./index.html
//        node build.mjs --check    → syntax-check every module (node --check) and build
//        node build.mjs --partial  → skip modules that don't exist yet (incremental verification)
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const args = new Set(process.argv.slice(2));

const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
const template = readFileSync(join(src, 'index.template.html'), 'utf8');
const css = existsSync(join(src, 'style.css')) ? readFileSync(join(src, 'style.css'), 'utf8') : '';

let js = '';
let failed = false;
for (const file of manifest.modules) {
  const path = join(src, 'js', file);
  if (!existsSync(path)) { if (args.has('--partial')) { console.warn(`skipping missing module: ${file}`); continue; } console.error(`MISSING module: ${file}`); failed = true; continue; }
  if (args.has('--check')) {
    try { execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' }); }
    catch (e) { console.error(`SYNTAX ERROR in ${file}:\n${e.stderr}`); failed = true; }
  }
  const code = readFileSync(path, 'utf8');
  if (/<\/script/i.test(code)) { console.error(`"</script" found in ${file}: would break inlining`); failed = true; }
  // Modules are joined with an explicit `;` on both sides so a file that ends in `})()` without a
  // semicolon can never turn the next IIFE into a call `(...)()(function(){...})()` (ARCHITECTURE D55).
  js += `\n;// ===== ${file} =====\n${code}\n;`;
}
if (failed) process.exit(1);
if (args.has('--check')) {
  // Cross-file syntax: `node --check` the concatenated script exactly as it will be inlined.
  const dir = mkdtempSync(join(tmpdir(), 'bsu-build-'));
  const tmp = join(dir, 'bundle.js');
  writeFileSync(tmp, js);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { console.error(`SYNTAX ERROR in the concatenated bundle (cross-file):\n${e.stderr}`); failed = true; }
  rmSync(dir, { recursive: true, force: true });
  if (failed) process.exit(1);
}

const bad = [/<script[^>]+src=/i, /<link[^>]+href=/i, /@import\s+url/i];
for (const re of bad) if (re.test(template) || re.test(css)) { console.error(`External reference forbidden: ${re}`); process.exit(1); }

const out = template
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);
if (!template.includes('/*__CSS__*/') || !template.includes('/*__JS__*/')) {
  console.error('template must contain /*__CSS__*/ and /*__JS__*/ markers'); process.exit(1);
}
writeFileSync(join(root, 'index.html'), out);
console.log(`built index.html: ${(out.length / 1024).toFixed(1)} KB, ${manifest.modules.length} modules`);
