const fs = require('node:fs');
const path = require('node:path');
const { buildBootstrap } = require('../build_bootstrap');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'build');

async function prepareApp() {
  const asar = await import('@electron/asar');
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source');
  if (sourceIndex !== -1 && !args[sourceIndex + 1]) throw new Error('--source requires an original app.asar path.');
  const resources = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources');
  const candidates = sourceIndex !== -1 ? [path.resolve(args[sourceIndex + 1])] : resources
    ? ['app.asar', 'app.asar.vanilla', 'app.asar.backup'].map(name => path.join(resources, name)) : [];
  let source;
  let metadata;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const pkg = JSON.parse(asar.extractFile(candidate, 'package.json').toString());
    if (pkg.name !== 'antigravity' || !pkg.main || pkg.acrylicGravity) continue;
    const utils = asar.extractFile(candidate, 'dist/utils.js').toString();
    if (utils.includes('Permanent Theme Hook')) continue;
    source = candidate;
    metadata = pkg;
    break;
  }
  if (!source) throw new Error('Original Antigravity app.asar not found. Use --source <path> to select an unmodified copy.');
  const appDir = path.join(OUTPUT, 'app');
  // Every generated output stays in this repository's build directory.
  if (path.dirname(appDir) !== OUTPUT || path.dirname(OUTPUT) !== ROOT) throw new Error('Invalid build path.');
  const bundle = buildBootstrap();
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });
  // Older installations renamed app.asar but kept app.asar.unpacked beside it.
  // Stage that pair locally so extraction never writes to the installed client.
  const staged = path.join(OUTPUT, 'original.asar');
  const stagedUnpacked = staged + '.unpacked';
  fs.rmSync(stagedUnpacked, { recursive: true, force: true });
  fs.copyFileSync(source, staged);
  const unpacked = [source + '.unpacked', path.join(path.dirname(source), 'app.asar.unpacked')]
    .find(candidate => fs.existsSync(candidate));
  const files = asar.listPackage(source).map(name => name.replace(/^[\\/]/, ''));
  const unpackedFiles = files.filter(name => {
    const stat = asar.statFile(source, name, false);
    return stat.unpacked && !stat.files;
  });
  if (unpackedFiles.length && !unpacked) throw new Error('The original app.asar.unpacked directory is missing.');
  if (unpacked) fs.cpSync(unpacked, stagedUnpacked, { recursive: true });
  asar.extractAll(staged, appDir);
  fs.rmSync(staged, { force: true });
  fs.rmSync(stagedUnpacked, { recursive: true, force: true });
  metadata.acrylicGravity = { originalMain: metadata.main, bootstrapPath: bundle };
  metadata.main = 'acrylicgravity.cjs';
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  fs.copyFileSync(path.join(__dirname, 'electron-theme.cjs'), path.join(appDir, metadata.main));
  fs.mkdirSync(path.join(appDir, 'dist'), { recursive: true });
  fs.copyFileSync(bundle, path.join(appDir, 'dist', 'bootstrap.js'));
  fs.writeFileSync(path.join(OUTPUT, 'install-source.json'), JSON.stringify({ source }, null, 2));
  if (args.includes('--asar')) {
    const patterns = unpackedFiles.map(name => `**/${name.replaceAll('\\', '/')}`);
    await asar.createPackageWithOptions(appDir, path.join(OUTPUT, 'app.asar.patched'), {
      unpack: patterns.length > 1 ? `{${patterns.join(',')}}` : patterns[0]
    });
    console.log('Generated build/app.asar.patched.');
  }
  console.log(`Prepared Antigravity ${metadata.version} from ${source}.`);
}

prepareApp().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
