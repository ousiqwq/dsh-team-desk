// src/host-support/title-receipt.ts
import { createHash as tdDigest } from "node:crypto";
import { existsSync as tdExists } from "node:fs";
import { join as tdJoin } from "node:path";
import { homedir as tdHome } from "node:os";

// src/host-support/session-title-input.ts
function teamTitleMessage(event, targetSession) {
  if (!event || typeof event !== "object") return;
  const e = event;
  const data = e.data, source = data?.source;
  if (e.type !== "user/message" || !Number.isSafeInteger(e.seq) || Number(e.seq) < 0 || source?.kind !== "agent-message" || source.form !== "relay" || typeof data?.id !== "string" || !data.id.startsWith("team-desk:") || !Array.isArray(data.content)) return;
  const text = data.content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  const firstBreak = text.indexOf("\n"), header = text.slice(0, firstBreak), prefix = "[Team Desk \u6210\u5458\u6D88\u606F ";
  if (firstBreak < 0 || !header.startsWith(prefix) || !header.endsWith("]")) return;
  try {
    const metadata = JSON.parse(header.slice(prefix.length, -1));
    if (!metadata || typeof metadata !== "object" || metadata.kind !== "request" || typeof metadata.id !== "string" || !metadata.id || data.id !== "team-desk:" + metadata.id || typeof metadata.sender !== "string" || !metadata.sender || metadata.sender !== source.senderSessionId || typeof metadata.target !== "string" || !metadata.target || targetSession !== void 0 && metadata.target !== targetSession) return;
    const body = text.slice(firstBreak + 1).trim();
    if (!body) return;
    return { seq: Number(e.seq), text: body };
  } catch {
    return;
  }
}

// src/host-support/title-receipt.ts
function receipt(target, sender, id, text) {
  const hash = tdDigest("sha256").update(JSON.stringify([target, sender, id, text])).digest("hex");
  const directory = tdJoin(process.env.DSH_HOME ?? tdJoin(tdHome(), ".dsh"), "team-title-sources", hash.slice(0, 2));
  return { directory, path: tdJoin(directory, hash.slice(2)) };
}
function tdVerifiedTask(event, target) {
  if (!target || event?.type !== "user/message" || event.data?.source?.kind !== "agent-message") return;
  const task = teamTitleMessage(event, target), data = event.data;
  if (task && data.content.length === 1 && tdExists(receipt(target, data.source.senderSessionId, data.id, data.content[0].text).path)) return task;
}
