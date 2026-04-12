#!/usr/bin/env node

import { globby } from 'globby';
import fs from 'node:fs/promises';
import path from 'node:path';

const DRY_RUN = process.env.DRY_RUN === '1';

function ensureImport(src, what, from, opts = { typeOnly: true }) {
  const importRegex = new RegExp(
    `import\\s+${opts.typeOnly ? 'type\\s+' : ''}\\{[^}]*\\b${what}\\b[^}]*\\}\\s+from\\s+['"]${from}['"];?`,
    'm'
  );
  if (importRegex.test(src)) return src;

  const fromRegex = new RegExp(
    `import\\s+(${opts.typeOnly ? 'type\\s+' : ''})\\{([^}]*)\\}\\s+from\\s+['"]${from}['"];?`,
    'm'
  );
  if (fromRegex.test(src)) {
    return src.replace(fromRegex, (m, typeKw, names) => {
      const trimmed = names.trim();
      if (new RegExp(`\\b${what}\\b`).test(trimmed)) return m;
      const prefix = typeKw ? 'type ' : '';
      return `import ${prefix}{ ${trimmed ? trimmed + ', ' : ''}${what} } from '${from}';`;
    });
  }

  const firstImport = src.match(/^import .*;?$/m);
  const insertLine = `import ${opts.typeOnly ? 'type ' : ''}{ ${what} } from '${from}';`;
  if (firstImport) return src.replace(firstImport[0], `${firstImport[0]}\n${insertLine}`);
  return `${insertLine}\n${src}`;
}

function fixRenderPropParamTypes(src) {
  // Matches: {({ index, style, data? }) => ...}
  // Inserts: : ListChildComponentProps<any>
  const pattern = /(=\s*\{)\s*\(\{\s*index\s*,\s*style(\s*,\s*data)?\s*\}\)\s*=>/g;
  return src.replace(pattern, (m, openBrace, hasData) => {
    const type = ': ListChildComponentProps<any>';
    return `${openBrace}({ index, style${hasData || ''} }${type}) =>`;
  });
}

function fixItemKeyIndexType(src) {
  // Matches itemKey={(index) => ...} or itemKey={(index , data) => ...}
  const pattern = /(itemKey=\{\()\s*([a-zA-Z_$][\w$]*)\s*(,|\))\s*/g;
  return src.replace(pattern, (m, open, name, commaOrClose) => {
    if (/:/.test(m)) return m; // already typed
    return `${open}${name}: number${commaOrClose} `;
  });
}

async function processFile(file) {
  let src = await fs.readFile(file, 'utf8');
  const original = src;

  if (
    !/from\s+['"]react-window['"]/.test(src) &&
    !/<\s*(FixedSizeList|VariableSizeList)\b/.test(src)
  ) {
    return false;
  }

  // Ensure imports
  src = ensureImport(src, 'ListChildComponentProps', 'react-window', { typeOnly: true });
  if (/\bstyle\b/.test(src)) {
    src = ensureImport(src, 'CSSProperties', 'react', { typeOnly: true });
  }

  // Fix anonymous render props & itemKey index typing
  src = fixRenderPropParamTypes(src);
  src = fixItemKeyIndexType(src);

  if (src !== original) {
    if (DRY_RUN) {
      console.log(`[dry-run] would modify: ${file}`);
      return true;
    }
    await fs.copyFile(file, `${file}.bak`);
    await fs.writeFile(file, src, 'utf8');
    console.log(`✔ fixed: ${file}`);
    return true;
  }
  return false;
}

(async () => {
  const roots = ['src'];
  const exts = ['ts', 'tsx'];
  const files = await globby(
    roots.map((r) => `${r}/**/*.{${exts.join(',')}}`),
    { gitignore: true }
  );

  let changed = 0;
  for (const f of files) {
    const rel = path.relative(process.cwd(), f);
    try {
      const did = await processFile(rel);
      if (did) changed++;
    } catch (e) {
      console.error(`✖ error in ${rel}:`, e.message);
    }
  }

  console.log(`\nDone. Files changed: ${changed}`);
  if (DRY_RUN) {
    console.log('Dry-run enabled; set DRY_RUN=0 (or unset) to apply changes.');
  } else {
    console.log('Backups (.bak) created next to modified files.');
  }
})();
