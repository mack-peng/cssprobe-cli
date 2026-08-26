const { execSync } = require('child_process');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

// 1. Compile TypeScript
console.log('Compiling TypeScript...');
execSync('npx tsc', { cwd: projectRoot, stdio: 'inherit' });

// 2. Bundle collector.ts as IIFE (browser-side script)
console.log('Bundling collector (IIFE)...');
const collectorEntry = path.join(projectRoot, 'src', 'engine', 'collector.ts');
const collectorOut = path.join(distDir, 'collector-bundle.js');

esbuild.buildSync({
  entryPoints: [collectorEntry],
  bundle: true,
  format: 'iife',
  globalName: '__cssprobe_cli',
  target: 'es2020',
  outfile: collectorOut,
  sourcemap: false,
  minify: false,
  // Don't bundle playwright or node builtins — collector is browser-only
  platform: 'browser',
});

// Verify the bundle exposes the collect function
const bundleContent = fs.readFileSync(collectorOut, 'utf-8');
if (!bundleContent.includes('collect')) {
  console.error('WARNING: collector bundle may not expose collect() correctly');
}

// 3. Bundle daemon entry point
console.log('Bundling daemon entry...');
const daemonEntry = path.join(projectRoot, 'src', 'daemon', 'daemonEntry.ts');
const daemonOut = path.join(distDir, 'daemonEntry.js');

esbuild.buildSync({
  entryPoints: [daemonEntry],
  bundle: true,
  format: 'cjs',
  target: 'node18',
  outfile: daemonOut,
  sourcemap: false,
  minify: false,
  platform: 'node',
  external: ['playwright-core'],
});

// 4. Generate help.json
console.log('Generating help.json...');
execSync('npx tsx scripts/generate-help.ts', { cwd: projectRoot, stdio: 'inherit' });

// 4. Clean up .js.map files (not needed for distribution)
function walkSync(dir, base = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(dir, base))) {
    const full = base ? path.join(base, entry) : entry;
    if (fs.statSync(path.join(dir, full)).isDirectory())
      files.push(...walkSync(dir, full));
    else
      files.push(full);
  }
  return files;
}
for (const entry of walkSync(distDir)) {
  if (entry.endsWith('.js.map'))
    fs.unlinkSync(path.join(distDir, entry));
}

console.log('Build complete.');
