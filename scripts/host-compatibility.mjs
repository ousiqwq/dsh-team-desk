import {readFile} from 'node:fs/promises';

// Adapter subprocesses use this status only for an unrecognized host component.
export const unsupportedHostStatus = 2;
export class UnsupportedHostBuild extends Error {}

export function reportHostError(error) {
  if (!(error instanceof UnsupportedHostBuild)) throw error;
  console.error(error.message);
  process.exitCode = unsupportedHostStatus;
}

export async function readHostFile(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new UnsupportedHostBuild('宿主缺少组件文件：' + file);
  }
}
