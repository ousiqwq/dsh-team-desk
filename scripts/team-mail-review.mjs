import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readFile, writeFile, rename, rm, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const originalHash = 'c516e8803facb9c8484f10c81037859826f1b1d0fef098d933ea23b38fd780b3';
const anchor = '\t\t\tif (!accepting || lifecycle.signal.aborted) return { kind: "cancel" };\n';
// Keep the native seam limited even if another extension ever registers this service name.
const mailNames = ['team_members','team_read_messages','team_wait','team_ack_message','team_send_message','team_protocol','team_task'];
const teamNames = [...mailNames,'team_shared','team_reference','team_resource','team_control','team_native','team_git'];
function reviewGate(names) {
  const candidate = names.map(name=>'exec.name === '+JSON.stringify(name)).join(' || ');
  return '\t\t\tif (' + candidate + ') {\n'
    + '\t\t\t\tlet internal = false;\n'
    + '\t\t\t\ttry { internal = ctx.get("teamDeskMail")?.isInternal(exec) === true; } catch {}\n'
    + '\t\t\t\tif (internal) return next();\n\t\t\t}\n';
}
const mailGate = reviewGate(mailNames);
const teamGate = reviewGate(teamNames);
const hash = value => createHash('sha256').update(value).digest('hex');

const helper = readFileSync(new URL('../scripts/team-review-history.mjs',import.meta.url),'utf8')
  .replace('export function createTeamReviewHistory(', 'function createTeamReviewHistory(');
const initAnchor = '\tconst history = [];';
const init = '\n\tlet teamFact;\n\ttry { const verify = agent.ctx.get("teamDeskMail")?.reviewNotices?.(session.id);'
  + ' if (verify) teamFact = createTeamReviewHistory(session.id, verify); } catch {}';
const userAnchor = '} else history.push(...filteredUserEntries(event.seq, event.data.source, event.data.content, prompts, session));';
const userProjection = ` } else {
        const entries = filteredUserEntries(event.seq, event.data.source, event.data.content, prompts, session);
        let compact;
        if (teamFact) {
          try { compact = teamFact(entries.length === 1 ? entries[0] : { source: event.data.source }, event.data.id, event.seq); } catch {}
        }
        if (compact) history.push(compact);
        else history.push(...entries);
      }`;

export function teamMailReviewer(source, restore = false) {
  const original = source.replace(anchor + teamGate, anchor).replace(anchor + mailGate, anchor)
    .replace(helper+'\n','').replace(initAnchor+init,initAnchor).replace(userProjection,userAnchor);
  if (![originalHash,'5e2ccc5495defb9b533fdc5888e5a9487396a9dedd298125874e203679785464'].includes(hash(original)) || [anchor,initAnchor,userAnchor].some(key=>original.split(key).length!==2))
    throw Error('Unrecognized DSH Auto reviewer build. Its review policy has been left intact.');
  const mailOnly = original.replace(anchor, anchor + mailGate);
  const withHistory = (source) => helper+'\n'+source
    .replace(initAnchor, initAnchor+init).replace(userAnchor,userProjection);
  const full = withHistory(original.replace(anchor,anchor+teamGate));
  if (![original, mailOnly, withHistory(mailOnly), full].includes(source)) throw Error('Incomplete or modified DSH review adapter.');
  return restore ? original : full;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
    && process.argv[1].endsWith('team-mail-review.mjs')) {
  const [action, runtime] = process.argv.slice(2);
  if (!['--check', '--apply', '--restore'].includes(action) || !runtime)
    throw Error('Usage: node scripts/team-mail-review.mjs --check|--apply|--restore RUNTIME');
  const pkg = join(resolve(runtime), 'node_modules/@deepseek-ai/dsh-experimental-auto-review');
  const manifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
  if (manifest.name !== '@deepseek-ai/dsh-experimental-auto-review' || !['0.2.2-rc.2','0.2.3-alpha.2'].includes(manifest.version))
    throw Error('Unsupported Auto reviewer package.');
  const path = join(pkg, 'lib/index.js');
  const before = await readFile(path, 'utf8');
  const after = teamMailReviewer(before, action === '--restore');
  if (action !== '--check' && after !== before) {
    const tmp = path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(tmp, after, {mode: (await stat(path)).mode, flag: 'wx'});
      if (await readFile(path, 'utf8') !== before) throw Error('DSH reviewer changed during preparation.');
      await rename(tmp, path);
    } finally { await rm(tmp, {force: true}); }
  }
  const current = action === '--check' ? before : after;
  console.log(current.includes(teamGate) ? 'Team coordination and review-history adapter present' : current.includes(initAnchor+init) ? 'Team mailbox and review-history adapter present' : current.includes(mailGate) ? 'Team mailbox adapter only' : 'Original DSH Auto reviewer');
}
