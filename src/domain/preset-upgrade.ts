import {createHash} from 'node:crypto';
import {defaultPresets} from './preset-library.ts';
import type {State, TeamPreset} from './types.ts';

// SHA-256 of verbatim role text from previously shipped built-in presets, by preset and seat.
// A user edit (including whitespace), a different seat or a copied preset ID is never inferred.
const shipped: Record<string, readonly string[]> = {
  "reverse-analysis/dynamic": [
    "485f611c1be9a19e6e51aceb1406b5b171897ab36c1c53bd5bc5da060e0863d6",
    "5db33216f3e04ad892fe1f24ad38d2ad463d41bcb750d77c812a4c2a27c574c8",
    "5fd817f52b54edf7ead29c511ad1f26a62f057f52a627aecee5f6c53d61526d0",
    "7373fabdcb90e45a2308724811b101dfb80b37097dcee16047e72c3e9a8caa37"
  ],
  "reverse-analysis/lead": [
    "0bb6a64005872ccc2c5dd415f4ebf716058481cf45a1e119cd17e0f5d8df384e",
    "44b4df6b0495333f8bf1b39daca8a90ef0eb0358839ec075679ce8914ca8a4f8",
    "b8ebd17047280725695407f516e725397151f5afa346a9e3fb724d3b23832be6",
    "eaa3cdcfaed383465a0662e32c4a4a85719295e5f30359bffac74314297a5f00"
  ],
  "reverse-analysis/static": [
    "25a74a3b7d97a82a3de63aff206e704ecb2f106eef9984c50b89bed039c49112",
    "30861f016c314d1e0bbafe96a2952e48e2b14065e13a05fe0461919b8371a923",
    "5f5f31e0ec16ebe1972f2bc4f4f84865dfa33f573566c0de01762eff558ebe6b",
    "d9bfadb97e428df0cd22341e7f3d7c504c898a11b34104a9857f1e6fcedcc54f"
  ],
  "reverse-supervised/dynamic": [
    "9f2a336d15a78a84011b1a390e6f1086929c3b1482f16e238358d19018a9c6b8"
  ],
  "reverse-supervised/static": [
    "73bed45a4359be4e8d845f1f213b9a314c530b5e34e7db506b52123fdf16515d"
  ],
  "reverse-supervised/supervisor": [
    "3cb6f43b43ea5d19536b234b2559d2050c13be6a087136d11a123c03847b604f",
    "2111f4ec7bf836573da6808c7d252bc006a6cd0b5c7bd55db43d132da4ba95c1",
    "dd49086503a0ee33bcab7a7fee3aebbb0acd53e488acb0b5e50a91e2975f0957"
  ],
  "reverse-supervised/work": [
    "dc96dae55e9a112fb1abecd64799f63a2901901eb0881d012dadb23a93856041",
    "ca08326e654f295fbb0f34700a9d8be4dc7e65d99200bf827d22240cc5386189",
    "a76a72205e68048971700f992a91ad11a93bbea92160ebb66c9eda5ba1bcb4eb"
  ],
  "work-review/review": [
    "1bbe9ccd5d521f71cc6bc310406b5a3e8ce353680861df27b63768d9829b302e",
    "4f0c608ca15a4dd505f07b131ae36431a6b20628d44ce6e2c56f55cbb757455f",
    "69325efc3e7bd397586e0bf22bbc8ec403cb927b9ac30bf149d423ff1a4edb9e",
    "6c13d834d36f544c8ce885ba116f040bc2b5a48752cc93be8e053578e69d18ba",
    "708bd667c4b5b53f0a0d4ddf44ca7e51869a88169397d1da75e49884a1ce1af9"
  ],
  "work-review/work": [
    "02cf8ab096a2feb147ecee51cf8367f8199a994f7441f41022cf96b9ac26b2d4",
    "10d5ad15d4d632408beb7b98bac0e74113eb5e9914b99d345c484299e75b4cd2",
    "17e9324ae395bc1fe46dfc4a7f452d92c14107c6bd75c6e80ff477c1dd92fcc1",
    "4c1dd8cdb357231d670df072959b509739c9a84d298f393c8133f2a28df989fb",
    "89bcd19d1f1fcbd99e322e473d513a49babe1568c74998d566e8fdc96eca1fff"
  ]
};

const replacements = new Map(defaultPresets().flatMap(preset =>
 preset.members.map(seat => [preset.id+'/'+seat.key, seat.prompt] as const)));

function replacement(presetId:string, slot:string, text:string|undefined):string|undefined {
 const key = presetId+'/'+slot;
 const next = replacements.get(key);
 if (!text || !next || text === next) return;
 const digest = createHash('sha256').update(text).digest('hex');
 return shipped[key]?.includes(digest) ? next : undefined;
}

function upgradeSnapshot(preset:TeamPreset):boolean {
 let changed = false;
 for (const seat of preset.members) {
  const next = replacement(preset.id, seat.key, seat.prompt);
  if (next) { seat.prompt = next; changed = true; }
 }
 return changed;
}

/** Startup migration of the library, applied snapshots, pending edits and explicitly bound live members. */
export function upgradeBuiltinDuties(state:State, now=Date.now()):void {
 const revisions = new Map<string, number>();
 for (const preset of state.presets) {
  if (!upgradeSnapshot(preset)) continue;
  revisions.set(preset.id, preset.revision);
  preset.revision++;
  preset.updatedAt = now;
 }
 function upgradeCopy(preset:TeamPreset):boolean {
  if (!upgradeSnapshot(preset)) return false;
  if (revisions.get(preset.id) === preset.revision) {
   preset.revision++;
   preset.updatedAt = now;
  }
  return true;
 }
 for (const team of state.teams) {
  if (team.pending) upgradeCopy(team.pending.preset);
  const cfg = team.configuration;
  if (!cfg) continue;
  let changed = upgradeCopy(cfg.preset);
  for (const [slot, sessionId] of Object.entries(cfg.bindings)) {
   const seat = team.members.find(m => m.sessionId === sessionId);
   if (!seat || (seat.slot && seat.slot !== slot)) continue;
   const next = replacement(cfg.preset.id, slot, seat.prompt);
   if (next) { seat.prompt = next; changed = true; }
  }
  if (changed) cfg.contextRevision++;
 }
}
