const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'storage']);
const EXTENSIONS = new Set([
  '.js',
  '.json',
  '.html',
  '.css',
  '.md',
  '.yml',
  '.yaml',
  '.env.example'
]);

const PATTERNS = [
  /\uFFFD/,
  /[涓锛璁鎴绋妗]/,
  /鈥|鈫|銆|鍙|鐢|澶|寮|姝|妫|濈|棰|浠/
];

function shouldScan(filePath) {
  const base = path.basename(filePath);
  if (base === '.env') return false;
  if (base === 'scan-mojibake.js') return false;
  if (base === '.env.example') return true;
  return EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (shouldScan(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

const findings = [];
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (PATTERNS.some((pattern) => pattern.test(line))) {
      findings.push({
        file: path.relative(ROOT, file),
        line: index + 1,
        text: line.trim().slice(0, 160)
      });
    }
  });
}

if (findings.length) {
  console.error(`Potential mojibake found: ${findings.length}`);
  for (const item of findings.slice(0, 200)) {
    console.error(`${item.file}:${item.line}: ${item.text}`);
  }
  if (findings.length > 200) {
    console.error(`... ${findings.length - 200} more`);
  }
  process.exitCode = 1;
} else {
  console.log('No common mojibake patterns found.');
}
