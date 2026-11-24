import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class SnapshotCommitError extends Error { readonly committed=true; }
/** Atomic replacement. A failed directory sync after rename is an uncertain durability outcome. */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  let committed=false;
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    await rename(temp, path); committed=true;
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch(error) {
    if(committed)throw new SnapshotCommitError('Snapshot replaced but directory sync failed; durability is uncertain',{cause:error});
    throw error;
  } finally { await rm(temp,{force:true}).catch(()=>{}); }
}

export async function readJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function string(value: unknown, name: string, max = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value;
}

/** Narrow snapshot contract for failure injection and future store replacement. */
export interface SnapshotStore {read(path:string):Promise<unknown|undefined>;write(path:string,value:unknown):Promise<void>;}
export const snapshotStore:SnapshotStore={read:readJson,write:writeJson};
