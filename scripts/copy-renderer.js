const fs = require('fs');
const path = require('path');

const srcBase = path.join(__dirname, '..', 'src', 'renderer');
const distBase = path.join(__dirname, '..', 'dist', 'renderer');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.css')) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursive(srcBase, distBase);
console.log('Renderer assets copied.');
