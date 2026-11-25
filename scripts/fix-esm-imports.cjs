const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist-esm');

function resolveSpecifier(file, specifier) {
  if (path.extname(specifier)) return specifier;

  const target = path.resolve(path.dirname(file), specifier);
  if (fs.existsSync(target + '.js')) {
    return specifier + '.js';
  }
  if (fs.existsSync(path.join(target, 'index.js'))) {
    return path.posix.join(specifier.replace(/\\/g, '/'), 'index.js');
  }

  throw new Error(\`Cannot resolve ESM import "\${specifier}" from \${path.relative(root, file)}\`);
}

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(file);
      continue;
    }
    if (!entry.isFile() || !file.endsWith('.js')) continue;

    const source = fs.readFileSync(file, 'utf8');
    const fixed = source.replace(
      /(\bfrom\s*|\bimport\s*\()(['"])(\.{1,2}\/[^'"]+)\2/g,
      (match, prefix, quote, specifier) =>
        prefix + quote + resolveSpecifier(file, specifier) + quote
    );
    if (fixed !== source) fs.writeFileSync(file, fixed);
  }
}

if (!fs.existsSync(root)) {
  throw new Error('ESM build output not found: ' + root);
}
visit(root);
