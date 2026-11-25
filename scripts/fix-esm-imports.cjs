const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist-esm');

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
      (match, prefix, quote, specifier) => {
        if (path.extname(specifier)) return match;
        return prefix + quote + specifier + '.js' + quote;
      }
    );
    if (fixed !== source) fs.writeFileSync(file, fixed);
  }
}

if (!fs.existsSync(root)) {
  throw new Error('ESM build output not found: ' + root);
}
visit(root);
