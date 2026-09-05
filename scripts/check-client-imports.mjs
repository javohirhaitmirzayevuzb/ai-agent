/**
 * Client-import guard.
 *
 * Why: the admin card imported a key helper from src/lib/crypto.js, which does
 * `import crypto from 'node:crypto'`. Webpack cannot put that in a browser bundle, the
 * client chunk failed to build, and the page 500'd / the controls silently stopped
 * working — while the API itself stayed healthy. Anything reachable from a 'use client'
 * module must be browser-safe, so this walks the import graph and says so.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'src');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(ROOT);

const NODE_BUILTIN = /(?:^|from\s+|import\s*\(\s*|require\(\s*)['"](node:[^'"]+|crypto|fs|path|os|http|https|zlib|stream|util|url|buffer|net|tls|dns)['"]/;

function resolveFrom(fromFile, spec) {
  if (!spec.startsWith('@/')) return null;
  const base = path.join(ROOT, spec.slice(2));
  for (const cand of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

const cache = new Map();
const read = (f) => {
  if (!cache.has(f)) cache.set(f, fs.readFileSync(f, 'utf8'));
  return cache.get(f);
};

const isClient = (f) => /^\s*'use client'/.test(read(f));
const importsOf = (f) => [...read(f).matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] || m[2]);

const problems = [];
const memo = new Map();

function nodeDeps(f, seen = new Set(), chain = []) {
  // memo only for complete subtrees; a cycle returns nothing but must not poison the memo
  if (memo.has(f)) return memo.get(f);
  const cycling = seen.has(f);
  if (cycling) return [];
  seen.add(f);
  const src = read(f);
  const hits = [];
  for (const line of src.split('\n')) {
    if (NODE_BUILTIN.test(line)) hits.push({ file: f, via: chain, spec: line.trim().slice(0, 90) });
  }
  for (const spec of importsOf(f)) {
    if (spec.startsWith('node:') || NODE_BUILTIN.test(`'${spec}'`)) {
      hits.push({ file: f, via: chain, spec });
      continue;
    }
    const next = resolveFrom(f, spec);
    if (next) hits.push(...nodeDeps(next, seen, [spec, ...chain]));
  }
  memo.set(f, hits);
  return hits;
}

for (const f of files.filter(isClient)) {
  for (const spec of importsOf(f)) {
    const target = resolveFrom(f, spec);
    if (!target) continue;
    for (const hit of nodeDeps(target, new Set(), [spec])) {
      problems.push(
        `${path.relative(process.cwd(), f)} ('use client') → ${spec} → … → ${path.relative(process.cwd(), hit.file)} uses \`${hit.spec}\``
      );
    }
  }
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.log('\x1b[31m  node-only modules reachable from a client component:\x1b[0m');
  for (const p of unique) console.log('    ' + p);
  console.log('\n  The browser bundle cannot build. Move the shared logic into a dependency-free module (see src/lib/keyFormat.js).');
  process.exit(1);
}
console.log(`  ✓ no client component reaches a node builtin (${files.filter(isClient).length} client modules traced)`);
