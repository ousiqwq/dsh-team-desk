import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test, type TestContext} from 'node:test';

function host(t: TestContext, version: string, nativeExitCode = 0) {
  const root = mkdtempSync(join(tmpdir(), 'team-desk-install-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const pkg = join(root, 'node_modules', '@deepseek-ai', 'dsh');
  const marker = join(root, 'native-install');
  mkdirSync(join(pkg, 'lib'), {recursive: true});
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({version}));
  writeFileSync(join(pkg, 'lib', 'bin.js'),
    'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "called");process.exit(' + nativeExitCode + ');');
  const cli = (action: string) => spawnSync(process.execPath,
    [resolve('bin/team-desk.mjs'), action, '--host', root], {encoding: 'utf8'});
  return {cli, marker};
}

test('a different host can install when native adapters are unavailable', t => {
  const {cli, marker} = host(t, '0.2.9-rc.1');
  const check = cli('check');
  assert.equal(check.status, 2);
  assert.equal(existsSync(marker), false);
  const install = cli('install');
  assert.equal(install.status, 0, install.stderr);
  assert.match(install.stderr, /跳过不兼容的宿主适配/);
  assert.match(install.stdout, /0\/3/);
  assert.ok(existsSync(marker));
});

test('a failed DSH package installation still fails on a different host', t => {
  const {cli, marker} = host(t, '0.3.0', 2);
  assert.equal(cli('install').status, 1);
  assert.ok(existsSync(marker));
});

test('the reference host fails preflight before installation if its bundles are missing', t => {
  const {cli, marker} = host(t, '0.2.3-alpha.2');
  assert.equal(cli('install').status, 1);
  assert.equal(existsSync(marker), false);
});
