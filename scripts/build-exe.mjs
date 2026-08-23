// Packages the built CLI into a standalone .exe using Node's Single Executable
// Application (SEA) feature, so it can run on machines without Node installed.
import { execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outName = process.platform === 'win32' ? 'rool-dev.exe' : 'rool-dev';
const outPath = path.join(root, 'dist', outName);
const blobPath = path.join(root, 'dist', 'sea-prep.blob');

if (!existsSync(path.join(root, 'dist', 'index.cjs'))) {
    console.error('dist/index.cjs not found. Run "npm run build" first.');
    process.exit(1);
}

mkdirSync(path.dirname(outPath), { recursive: true });

console.log('Generating SEA blob...');
execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], {
    cwd: root,
    stdio: 'inherit',
});

console.log(`Copying Node binary -> ${outName}`);
copyFileSync(process.execPath, outPath);
if (process.platform !== 'win32') {
    chmodSync(outPath, 0o755);
}

// macOS requires the signature to be removed before injecting; harmless elsewhere.
if (process.platform === 'darwin') {
    execFileSync('codesign', ['--remove-signature', outPath], { stdio: 'inherit' });
}

console.log('Injecting application blob into executable...');
// Invoke postject's CLI script directly with node, rather than shelling out to the
// npm .cmd/.sh shim — avoids Windows-only shell-quoting pitfalls entirely.
const postjectCli = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
const postjectArgs = [
    postjectCli,
    outPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (process.platform === 'win32') {
    postjectArgs.push('--overwrite');
}
execFileSync(process.execPath, postjectArgs, { cwd: root, stdio: 'inherit' });

if (process.platform === 'darwin') {
    execFileSync('codesign', ['--sign', '-', outPath], { stdio: 'inherit' });
}

console.log(`\nDone: ${outPath}`);
