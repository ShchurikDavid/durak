// Build a source archive with an explicit allowlist: no accounts, keys, APKs or node_modules.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const stage = fs.mkdtempSync(path.join(artifacts, 'ubuntu-package-'));
for (const name of ['src', 'public', 'server.js', 'deploy', 'docs/ubuntu.md']) {
  fs.cpSync(path.join(root, name), path.join(stage, name), {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes('node_modules')
  });
}
for (const name of ['package.json', 'package-lock.json'])
  fs.copyFileSync(path.join(root, 'deploy/server', name), path.join(stage, name));
const archive = path.join(artifacts, 'durak-ubuntu-3.231.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', stage, '.']);
console.log(archive);
