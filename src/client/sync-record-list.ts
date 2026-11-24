import type {Message} from '../domain/types.ts';
import type {SyncDeliveryHint, SyncSummary} from '../domain/sync-summary.ts';
import type {SyncMessageSource} from './sync-message.ts';

export interface FileReceipt {
 message: SyncMessageSource;
 summary?: SyncSummary | undefined;
 hint?: SyncDeliveryHint | undefined;
}

export interface FileEntry {
 id: string;
 index: number;
 receipt: FileReceipt;
 originals: SyncMessageSource[];
}

/** Keep the first visible position and every distinct delivery of the same immutable change. */
export function fileEntries(receipts: readonly FileReceipt[]): FileEntry[] {
 const entries = new Map<string, FileEntry>();
 for (const receipt of receipts) {
  const ids = receipt.summary?.recordIds ?? receipt.hint?.recordIds ?? [];
  ids.forEach((id, index) => {
   const existing = entries.get(id);
   if (!existing) entries.set(id, {id, index, receipt, originals: [receipt.message]});
   else if (!existing.originals.some(m => m.id === receipt.message.id)) existing.originals.push(receipt.message);
  });
 }
 return [...entries.values()];
}

export function fileReceipt(row: {message: SyncMessageSource; stored: Message | undefined; hint?: SyncDeliveryHint | undefined}): FileReceipt {
 return {message: row.message, summary: row.stored?.syncSummary, hint: row.hint};
}
