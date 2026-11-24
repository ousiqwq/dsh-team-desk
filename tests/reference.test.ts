import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {defaultPresets, validatePreset} from '../src/domain/preset-library.ts';

test('fresh teams use exactly the three portable presets in the package', async () => {
  const presets = defaultPresets();
  const names = (await readdir('examples/presets')).sort();
  assert.deepEqual(names, presets.map(p => p.id + '.json').sort());
  for (const preset of presets) {
    const portable = JSON.parse(await readFile('examples/presets/' + preset.id + '.json', 'utf8'));
    validatePreset(portable);
    assert.deepEqual(preset, portable);
    assert.ok(preset.members.every(member => !member.key.startsWith('session-')));
  }
});
