#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const usage = 'dsh-team-desk install|adapt|check [--profile web] [--host <DSH host>] [--tarball <file.tgz>]';

function locateHost(explicit) {
  const valid = path => existsSync(join(path, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  if (explicit && valid(resolve(explicit))) return resolve(explicit);
  if (!explicit) {
    for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
      for (const name of ['dsh', 'dsh.cmd', 'dsh.exe']) {
        const entry = join(dir, name);
        if (!existsSync(entry)) continue;
        const parent = dirname(realpathSync(entry));
        // DSH release wrapper, npm global symlink, or Windows npm shim.
        for (const candidate of [join(parent, 'host'), resolve(parent, '../../../..'), parent]) {
          if (valid(candidate)) return candidate;
        }
      }
    }
  }
  throw new Error('找不到 DSH 宿主。请用 --host 指向含 node_modules/@deepseek-ai/dsh 的目录。');
}

function run(script, args, env = process.env) {
  const command = spawnSync(process.execPath, [script, ...args], {stdio: 'inherit', env});
  if (command.error) throw command.error;
  if (command.status !== 0) throw new Error('命令失败：' + [script, ...args].join(' '));
}

function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    profile: {type: 'string', default: 'web'}, host: {type: 'string'}, tarball: {type: 'string'},
    help: {type: 'boolean', short: 'h'}
  }});
  if (values.help) { console.log(usage); return; }
  const [action] = positionals;
  if (positionals.length !== 1 || !['install', 'adapt', 'check'].includes(action)) throw new Error(usage);
  const host = locateHost(values.host);
  const dsh = join(host, 'node_modules', '@deepseek-ai', 'dsh');
  if (JSON.parse(readFileSync(join(dsh, 'package.json'), 'utf8')).version !== '0.2.3-alpha.2') {
    throw new Error('此版本适用于 DSH 0.2.3-alpha.2。');
  }
  const scripts = join(root, 'scripts');
  function adapters(mode) {
    run(join(scripts, 'alpha-shared-header.mjs'), [host, mode]);
    run(join(scripts, 'team-mail-review.mjs'), [mode, host]);
    run(join(scripts, 'alpha-legacy-titles.mjs'), [mode, host]);
  }
  adapters('--check');
  if (action === 'check') return;
  if (action === 'install') {
    const filename = pkg.name + '-' + pkg.version + '.tgz';
    const archive = values.tarball || (existsSync(filename) ? filename : undefined);
    if (archive && !existsSync(resolve(archive))) throw new Error('安装包不存在：' + archive);
    const source = archive ? resolve(archive) : pkg.name + '@' + pkg.version;
    const bin = join(dirname(host), 'pm', 'node_modules', '.bin');
    const env = existsSync(bin) ? {...process.env, PATH: bin + delimiter + process.env.PATH} : process.env;
    run(join(dsh, 'lib', 'bin.js'), ['plugin', '--profile', values.profile, 'add', source], env);
  }
  adapters('--apply');
  console.log('Team Desk 宿主适配已就绪。重启 DSH 后生效。');
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
