/**
 * Prop-contract check.
 *
 * Why: the admin key card called `setBusy?.(p.id, true)` while the parent passed
 * `setBusy={...}` to it and the component never destructured that prop. Optional chaining
 * does not protect against an *undeclared* identifier, so the click threw ReferenceError
 * before the PUT was sent — indistinguishable from "the save button does nothing", and
 * invisible in server logs because no request is ever made.
 *
 * The rule is deliberately narrow so it can stay fatal: report only when a component uses a
 * bare identifier that its own scope cannot reach AND a caller passes that exact name as a
 * prop to that component. That combination has no legitimate reading — it is a missing
 * destructure.
 */
import fs from 'node:fs';
import path from 'node:path';

const GLOBALS = new Set(['console', 'window', 'document', 'process', 'Math', 'JSON', 'Date', 'Promise', 'Array',
  'Object', 'String', 'Number', 'Boolean', 'Error', 'TypeError', 'Set', 'Map', 'WeakMap', 'Buffer', 'fetch',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'encodeURIComponent', 'decodeURIComponent',
  'parseInt', 'parseFloat', 'isNaN', 'structuredClone', 'crypto', 'require', 'React', 'Blob', 'File', 'FileReader',
  'FormData', 'Headers', 'Response', 'Request', 'ReadableStream', 'TextEncoder', 'TextDecoder', 'URL',
  'URLSearchParams', 'AbortController', 'AbortSignal', 'localStorage', 'sessionStorage', 'atob', 'btoa', 'Intl',
  'Image', 'navigator', 'Float32Array', 'Uint8Array', 'Uint8ClampedArray', 'Int32Array', 'ArrayBuffer',
  'DataView', 'Infinity', 'NaN', 'undefined', 'arguments', 'globalThis', 'location', 'history', 'performance',
  'requestAnimationFrame', 'global', 'exports', 'module']);

const NAME = '[A-Za-z_$][\\w$]*';

/** comments and string/template bodies become blanks; newlines are kept so line numbers stay true */
function scrub(src) {
  const out = src.split('');
  const blank = (a, b) => {
    for (let i = a; i < b && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === '//' || two === '/*') {
      const nl = src.indexOf('\n', i);
      const end = two === '//' ? (nl < 0 ? n : nl) : Math.min(n, src.indexOf('*/', i + 2) + 2);
      blank(i, end);
      i = end;
      continue;
    }
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

function bindingsOf(text, into = new Set()) {
  const pats = [
    new RegExp(`\\b(?:const|let|var)\\s+(${NAME})`, 'g'),
    new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]*)\\}`, 'g'),
    new RegExp(`\\b(?:const|let|var)\\s*\\[([^\\]]*)\\]`, 'g'),
    new RegExp(`\\bfunction\\s+(${NAME})`, 'g'),
    new RegExp(`\\bclass\\s+(${NAME})`, 'g'),
    new RegExp(`\\bcatch\\s*\\(\\s*(${NAME})`, 'g'),
    new RegExp(`\\bimport\\s+(${NAME})`, 'g'),
    new RegExp(`\\bimport\\s*\\{([^}]*)\\}`, 'g'),
    new RegExp(`\\bimport\\s*\\*\\s+as\\s+(${NAME})`, 'g'),
    new RegExp(`\\(([^()]*)\\)\\s*=>`, 'g'),
    new RegExp(`\\(([^()]*)\\)\\s*\\{`, 'g'),
    new RegExp(`\\(\\s*\\{([^}]*)\\}\\s*\\)`, 'g'),
  ];
  for (const re of pats) {
    for (const m of text.matchAll(re)) {
      for (const part of String(m[1] || '').split(',')) {
        let name = part.trim().replace(/^\.\.\./, '').replace(/:.*$/, '').replace(/=.*$/, '').replace(/[{}\[\]\s.]/g, '');
        if (name.includes('{')) name = name.replace(/[{}]/g, '').trim();
        if (new RegExp(`^${NAME}$`).test(name)) into.add(name);
      }
    }
  }
  return into;
}

function balanced(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return text.slice(openIdx + 1);
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(path.join(process.cwd(), 'src'));

const bodies = new Map(files.map((f) => [f, scrub(fs.readFileSync(f, 'utf8'))]));

// every prop name passed to every component anywhere in src/
const passedProps = new Map();
for (const body of bodies.values()) {
  for (const m of body.matchAll(new RegExp(`<(${NAME})((?:[^<>]|\n)*?)/?>`, 'g'))) {
    const comp = m[1];
    const attrs = m[2];
    if (!attrs || attrs.length > 4000) continue;
    if (!passedProps.has(comp)) passedProps.set(comp, new Set());
    const set = passedProps.get(comp);
    for (const a of attrs.matchAll(new RegExp(`(?:^|[\\s{(])(${NAME})=`, 'g'))) set.add(a[1]);
  }
}

const problems = [];
for (const [file, body] of bodies) {
  // module scope: bindings declared at the outermost indent of the file
  const moduleScope = bindingsOf(body.split('\n').map((l) => (/^\S/.test(l) || /^export\b/.test(l) ? l : '')).join('\n'));

  for (const m of body.matchAll(new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+(${NAME})\\s*\\(([^)]*)\\)\\s*\\{`, 'g'))) {
    const [name, params] = [m[1], m[2] || ''];
    if (/\.\.\./.test(params)) continue; // rest props are a legitimate catch-all
    const inner = balanced(body, m.index + m[0].length - 1);
    const scope = new Set([...moduleScope, ...bindingsOf(`function f(${params}) {}`), ...bindingsOf(inner)]);
    const passed = passedProps.get(name);
    if (!passed || !passed.size) continue;
    for (const use of inner.matchAll(new RegExp(`(?<![.\\w$])(${NAME})\\s*(?:\\?\\.)?\\(`, 'g'))) {
      const id = use[1];
      if (scope.has(id) || GLOBALS.has(id) || !passed.has(id)) continue;
      const line = body.slice(0, m.index).split('\n').length;
      problems.push(`${path.relative(process.cwd(), file)}:${line} — <${name}> receives \`${id}\` as a prop but does not destructure it; \`${id}()\` inside it throws ReferenceError`);
    }
  }
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.log('\x1b[31m  broken prop contracts:\x1b[0m');
  for (const p of unique) console.log('    ' + p);
  console.log(`\n  ${unique.length} finding(s). Fix: destructure the prop (add a no-op default when optional).`);
  process.exit(1);
}
console.log(`  ✓ every passed prop is destructured (${files.length} modules)`);
