const fs = require('fs');
const path = require('path');

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) clean(p);
  }
}

function clean(file) {
  let lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines = lines.filter((line) => {
    const t = line.trim();
    if (t.includes('═══')) return false;
    if (t.includes('鈺')) return false;
    if (/^\*\/\s*$/.test(t)) return false;
    if (/^\/\*[^*]*$/.test(t) && t.length < 80) return false;
    return true;
  });
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

walk(path.join(__dirname, '../app/home'));
console.log('cleaned');
