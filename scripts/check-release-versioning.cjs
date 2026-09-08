/* Run with: node scripts/check-release-versioning.cjs */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
// Compile project TypeScript for these isolated tests, without adding a runtime bundler.
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }, fileName: filename });
  module._compile(outputText, filename);
};
const { bumpVersion, parseVersion, APP_VERSION, APP_VERSION_MAX } = require('../src/version.ts');
const root = path.join(__dirname, '..');
const runCli = (...args) => execFileSync('node', [path.join(root, 'scripts/bump-version.mjs'), ...args], { encoding: 'utf8' }).trim();
const file = name => fs.readFileSync(path.join(root, name), 'utf8');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`✓ ${name}`); };

check('App version matches the release version everywhere', () => {
  const version = file('VERSION').trim();
  assert.match(version, /^\d+\.[0-9]\.[0-9]$/);
  // Версия приложения обязана совпадать с релизом: раньше VERSION и
  // desktop/package.json правились отдельно и расходились.
  assert.equal(JSON.parse(file('desktop/package.json')).version, version,
    'desktop/package.json разошёлся с VERSION');
  assert.equal(APP_VERSION, version, 'src/version.ts fallback разошёлся с VERSION');
  assert.equal(file('README.md').split('\n')[0], `# YawaChatHub ${version}`);
  assert.ok(file('CHANGELOG.md').includes(`## YawaChatHub v${version}`),
    `в CHANGELOG нет раздела v${version}`);
});

check('Bumping the version writes both files at once', () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yawa-version-'));
  fs.mkdirSync(path.join(dir, 'desktop'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'VERSION'), '1.0.9\n');
  fs.writeFileSync(path.join(dir, 'desktop/package.json'), JSON.stringify({ version: '1.0.9' }, null, 2));
  // Версия живёт ещё и в исходнике интерфейса — скрипт обязан обновить и её.
  fs.writeFileSync(path.join(dir, 'src/version.ts'),
    'export const APP_VERSION = (process.env.NEXT_PUBLIC_APP_VERSION || process.env.VITE_APP_VERSION || "").trim() || "1.0.9";\n');
  fs.copyFileSync(path.join(root, 'scripts/bump-version.mjs'), path.join(dir, 'scripts/bump-version.mjs'));
  const script = path.join(dir, 'scripts/bump-version.mjs');
  execFileSync('node', [script, '--apply'], { cwd: dir });
  assert.equal(fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim(), '1.1.0', 'перенос 1.0.9 → 1.1.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'desktop/package.json'), 'utf8')).version, '1.1.0');
  assert.ok(fs.readFileSync(path.join(dir, 'src/version.ts'), 'utf8').includes('|| "1.1.0"'),
    'запасная версия в src/version.ts тоже обновляется');
  execFileSync('node', [script, '--verify'], { cwd: dir });
  // Рассинхрон обязан приводить к ошибке, а не проходить молча.
  fs.writeFileSync(path.join(dir, 'VERSION'), '1.2.0\n');
  assert.throws(() => execFileSync('node', [script, '--verify'], { cwd: dir, stdio: 'pipe' }));
  fs.rmSync(dir, { recursive: true, force: true });
});

check('Patch counts up to 9, then carries into minor', () => {
  assert.equal(bumpVersion('1.0.0'), '1.0.1');
  assert.equal(bumpVersion('1.0.8'), '1.0.9');
  assert.equal(bumpVersion('1.0.9'), '1.1.0');
  assert.equal(bumpVersion('1.1.9'), '1.2.0');
});

check('Minor counts up to 9, then carries into major', () => {
  assert.equal(bumpVersion('1.8.9'), '1.9.0');
  assert.equal(bumpVersion('1.9.9'), '2.0.0');
  assert.equal(bumpVersion('2.0.9'), '2.1.0');
  assert.equal(bumpVersion('2.9.9'), '3.0.0');
  assert.equal(APP_VERSION_MAX, '1.9.9');
});

check('Versions with a two-digit minor or patch are rejected', () => {
  for (const bad of ['1.0.10', '1.10.0', '3.2.25', '1.0', 'v1.0.0', '', '1.0.0.0']) {
    assert.throws(() => bumpVersion(bad), undefined, bad);
  }
  const parsed = parseVersion('12.9.9');
  assert.deepEqual({ major: parsed.major, minor: parsed.minor, patch: parsed.patch }, { major: 12, minor: 9, patch: 9 });
});

check('CLI matches the app implementation on the whole line', () => {
  for (let version = '1.0.0', i = 0; i < 110; version = bumpVersion(version), i++) {
    assert.equal(runCli(version), bumpVersion(version), version);
  }
  assert.equal(runCli('--read'), file('VERSION').trim());
  assert.ok(runCli('--check', '1.9.9').includes('2.0.0'));
});

check('A rejected version makes the CLI fail instead of tagging a bad number', () => {
  assert.throws(() => runCli('3.2.25'));
  assert.throws(() => runCli('--check', '1.0.10'));
});

check('The repository ships every file the release pipeline needs', () => {
  const required = [
    '.github/workflows/release.yml',
    '.github/workflows/ci.yml',
    '.gitignore',
    'VERSION',
    'CHANGELOG.md',
    'README.md',
    'scripts/bump-version.mjs',
    'scripts/changelog.sh',
    'scripts/prepare-icon.mjs',
    'desktop/build/icon.ico',
    'desktop/build/icon.png',
    // Иконки рантайма: лежат внутри electron/**, поэтому попадают в asar.
    'desktop/electron/assets/tray-16.png',
    'desktop/electron/assets/tray-24.png',
    'desktop/electron/assets/tray-32.png',
    'desktop/electron/assets/app-256.png',
    'desktop/package.json',
    'desktop/package-lock.json',
    'vite.config.ts',
  ];
  for (const name of required) {
    assert.ok(fs.existsSync(path.join(root, name)), `missing ${name}`);
  }
  // electron-builder требует именно эти иконки.
  assert.equal(JSON.parse(file('desktop/package.json')).build.win.icon, 'build/icon.ico');
  assert.equal(JSON.parse(file('desktop/package.json')).build.nsis.artifactName, 'YawaChatHub-Setup.exe');
  assert.equal(JSON.parse(file('desktop/package.json')).build.portable.artifactName, 'YawaChatHub.exe');
  // Игнорируется только мусор сборки — иконки и исходники остаются в репозитории.
  const ignored = file('.gitignore');
  for (const keep of ['desktop/build', 'scripts', '.github', 'VERSION']) {
    assert.ok(!new RegExp(`^/?${keep}/?$`, 'm').test(ignored), `${keep} must not be git-ignored`);
  }
});

check('The release workflow matches the original pipeline except for versioning', () => {
  const workflow = file('.github/workflows/release.yml');
  // Три job-а оригинала: build → tag → release.
  assert.ok(/\n  build:/.test(workflow) && /\n  tag:/.test(workflow) && /\n  release:/.test(workflow));
  assert.ok(workflow.includes('runs-on: windows-latest'), 'exe собирается на Windows-раннере');
  assert.ok(workflow.includes("branches: [main, master]"));
  assert.ok(workflow.includes('tags: ["v*"]'));
  assert.ok(workflow.includes("if: \"!contains(github.event.head_commit.message, '[skip ci]')\""));
  assert.ok(workflow.includes('npx electron-builder --win --publish never'));
  assert.ok(workflow.includes('CSC_IDENTITY_AUTO_DISCOVERY: "false"'));
  assert.ok(workflow.includes('continue-on-error: true'));
  assert.ok(workflow.includes('node scripts/prepare-icon.mjs'));
  assert.ok(workflow.includes('npm install'), 'npm install, не npm ci — lockfile может отставать');
  assert.ok(workflow.includes('actions/download-artifact@v4'));
  assert.ok(workflow.includes('softprops/action-gh-release@v2'));
  assert.ok(workflow.includes("git ls-remote --exit-code --tags origin \"refs/tags/$TAG\""), 'дубль тега пропускается');
  assert.ok(workflow.includes('bash scripts/changelog.sh'));
  // Ветки версии — единственное осознанное отличие от оригинала.
  assert.ok(workflow.includes('node scripts/bump-version.mjs --check'));
  assert.ok(workflow.includes('node scripts/bump-version.mjs "${LATEST#v}"'), 'перенос 1.0.9 → 1.1.0 считает CLI');
  assert.ok(workflow.includes('node scripts/bump-version.mjs --set "$NEXT"'),
    'после релиза VERSION и версия приложения обновляются одной командой');
  assert.ok(workflow.includes('node scripts/bump-version.mjs --verify'),
    'сборка падает, если версия приложения разошлась с релизом');
  assert.ok(workflow.includes('tr -d'), 'VERSION читается без пробелов');
  assert.ok(workflow.includes('[skip ci]'), 'коммит бампа не перезапускает workflow');
  assert.ok(!/v?3\.\d\.\d/.test(workflow), 'в workflow нет старых версий 3.x');
});

check('CI workflow checks the renderer build on every push and PR', () => {
  const ci = file('.github/workflows/ci.yml');
  assert.ok(ci.includes('branches-ignore: [main, master]'));
  assert.ok(ci.includes('pull_request:'));
  assert.ok(ci.includes('npm run build'));
  assert.ok(ci.includes('npm run build:renderer'));
});

check('Build icons referenced by electron-builder exist and are valid', () => {
  const ico = fs.readFileSync(path.join(root, 'desktop/build/icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0, 'reserved must be 0');
  assert.equal(ico.readUInt16LE(2), 1, 'ICO type must be icon');
  const count = ico.readUInt16LE(4);
  assert.deepEqual([...Array(count)].map((_, i) => {
    const entry = 6 + i * 16;
    const size = ico[entry] === 0 ? 256 : ico[entry];
    const start = ico.readUInt32LE(entry + 12);
    const length = ico.readUInt32LE(entry + 8);
    assert.equal(ico[entry + 4], 1, 'planes');
    assert.equal(ico.readUInt16LE(entry + 6), 32, 'bit count');
    // Кадры со сжатием PNG — формат Vista+, как в prepare-icon.ps1.
    assert.deepEqual([...ico.subarray(start, start + 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `entry ${size} must be PNG`);
    // PNG хранится в big-endian, в отличие от полей каталога ICO.
    assert.ok(ico.readUInt32BE(start + 16) === size, `entry ${size} width`);
    assert.ok(ico.readUInt32BE(start + 20) === size, `entry ${size} height`);
    assert.ok(start + length <= ico.length, `entry ${size} fits in file`);
    return size;
  }), [16, 24, 32, 48, 64, 128, 256]);
  const png = fs.readFileSync(path.join(root, 'desktop/build/icon.png'));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
});

check('CHANGELOG lists the current version first and keeps the 1.0.0 history', () => {
  const changelog = file('CHANGELOG.md');
  const version = file('VERSION').trim();
  assert.ok(changelog.includes('## YawaChatHub v1.0.0'), 'история релизной линии сохраняется');
  assert.ok(!/\bv3\.\d/.test(changelog.replace(/^>.*$/gm, '')), 'old 3.x line is not reused');
  // Свежий раздел должен идти первым, иначе релиз возьмёт старый текст.
  assert.equal(changelog.indexOf(`## YawaChatHub v${version}`), changelog.indexOf('## '));
});

check('release-changelog.mjs inserts a section and never duplicates it', () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yawa-changelog-'));
  const notes = path.join(dir, 'notes.md');
  const target = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(notes, '## YawaChatHub v1.0.1\n\n**Дата:** 2026-09-07\n\n### Изменения\n\n- Что-то новое.\n');
  fs.writeFileSync(target, '# Ченжлог YawaChatHub\n\nВступление.\n\n## YawaChatHub v1.0.0\n\n- Первый выпуск.\n');
  const script = path.join(root, 'scripts/release-changelog.mjs');
  execFileSync('node', [script, '1.0.1', notes, target]);
  let merged = fs.readFileSync(target, 'utf8');
  assert.ok(merged.indexOf('## YawaChatHub v1.0.1') < merged.indexOf('## YawaChatHub v1.0.0'));
  assert.equal(merged.match(/^## YawaChatHub v1\.0\.1$/gm)?.length, 1);
  execFileSync('node', [script, '1.0.1', notes, target]);
  assert.equal(fs.readFileSync(target, 'utf8'), merged, 'second run leaves the file unchanged');
  // A curated section is kept as is.
  fs.writeFileSync(target, '# Ченжлог\n\n## YawaChatHub v1.0.2\n\nГотовый текст.\n');
  execFileSync('node', [script, '1.0.2', notes, target]);
  assert.equal(fs.readFileSync(target, 'utf8'), '# Ченжлог\n\n## YawaChatHub v1.0.2\n\nГотовый текст.\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

check('changelog.sh reuses the curated section instead of generating one', () => {
  const version = file('VERSION').trim();
  const notes = execFileSync('bash', [path.join(root, 'scripts/changelog.sh'), version], { cwd: root, encoding: 'utf8' });
  assert.ok(notes.startsWith(`## YawaChatHub v${version}`));
  assert.ok(notes.trim().split('\n').length > 3, 'в разделе есть содержательный текст');
});

check('Tray icons are packaged into the app bundle, not left outside it', () => {
  const pkg = JSON.parse(file('desktop/package.json'));
  const patterns = pkg.build.files;
  // Именно из-за этого значок в трее был пустым: рантайм читал ../build/icon.ico,
  // а каталог build/ в сборку не входит.
  const packaged = (rel) => patterns.some((p) => rel.startsWith(p.replace('/**/*', '').replace('/**', '')));
  assert.ok(packaged('electron/assets/tray-16.png'), 'иконки трея обязаны попадать в сборку');
  assert.ok(!packaged('build/icon.ico'), 'build/ в сборку не входит — рантайм не должен на него полагаться');

  const main = file('desktop/electron/main.js');
  assert.ok(!/\.\.", "build"/.test(main), 'рантайм больше не читает иконку из build/');
  assert.ok(main.includes('assets'), 'иконки берутся из electron/assets');
  // nativeImage не умеет SVG: такой «запасной вариант» давал пустой значок.
  assert.ok(!main.includes('image/svg+xml'), 'SVG не годится для nativeImage');

  for (const name of ['tray-16.png', 'tray-24.png', 'tray-32.png']) {
    const png = fs.readFileSync(path.join(root, 'desktop/electron/assets', name));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${name} должен быть PNG`);
    const expected = Number(name.match(/(\d+)/)[1]);
    assert.equal(png.readUInt32BE(16), expected, `${name}: ширина`);
    assert.equal(png.readUInt32BE(20), expected, `${name}: высота`);
  }
});

check('Windows shortcut and taskbar identity are configured', () => {
  const pkg = JSON.parse(file('desktop/package.json'));
  const { nsis, win, appId } = pkg.build;
  assert.equal(nsis.shortcutName, 'YawaChatHub');
  assert.equal(nsis.createDesktopShortcut, true);
  assert.equal(nsis.createStartMenuShortcut, true);
  assert.equal(nsis.uninstallDisplayName, 'YawaChatHub');
  assert.equal(nsis.installerIcon, 'build/icon.ico');
  assert.equal(win.icon, 'build/icon.ico');
  // Windows связывает ярлык с окном по AppUserModelID: значения обязаны совпадать.
  assert.ok(file('desktop/electron/main.js').includes(`setAppUserModelId("${appId}")`));
});

check('Docs describe the version scheme without old numbers', () => {
  for (const name of ['README.md', 'desktop/BUILD.md', 'PUSH_GUIDE.md']) {
    assert.ok(file(name).includes('1.0.0'), `${name} mentions the new start`);
  }
  assert.match(file('README.md'), /1\.9\.9/, 'README explains the 1.9.9 → 2.0.0 carry');
  assert.ok(file('README.md').includes('version:bump'), 'README describes how to bump the version');
});

console.log(`\n${passed} release-versioning checks passed.`);
