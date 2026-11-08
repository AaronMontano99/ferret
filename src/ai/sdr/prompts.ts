/**
 * System prompts for the Lead SDR workflow. Aaron's playbooks
 * (private/, loaded by ./playbooks.ts, non-negotiable) are used verbatim as
 * the core instructions, plus his approved real examples, plus a short
 * output contract telling the model how its answer maps into Ferret's
 * fields. The mechanically checkable rules are enforced again after
 * generation (email-style.ts, call-style.ts, territory.ts).
 */
import { emailStyleRulesText } from '@/domain/email-style';
import { callStyleRulesText } from '@/domain/call-style';
import { getPlaybook, getReference, getVoice, type PlaybookName } from './playbooks';

function readPlaybook(name: PlaybookName): string {
  return getPlaybook(name);
}

export interface RepContext {
  name: string;
  company: string;
  location: string;
  zips: string[];
  phone: string;
  today: string;
}

function header(rep: RepContext): string {
  return [
    `You are running inside Ferret, ${rep.name || 'the rep'}'s prospecting workspace${rep.company ? ` (${rep.company}${rep.location ? `, ${rep.location}` : ''})` : ''}. Today is ${rep.today}.`,
    rep.zips.length ? `Territory ZIPs: ${rep.zips.join(', ')}.` : '',
    rep.phone ? `Callback number for voicemails: ${rep.phone}.` : 'No callback number is on file; in voicemails write "[phone]" where the number goes.',
    'Your answer is rendered into fixed fields on a card, so write each field exactly the way the reference examples do: short, spoken, glanceable. No headings or labels inside field values. No em dashes anywhere. No markdown.',
  ].join('\n');
}

const RESEARCH_RULES = `
# LIVE RESEARCH (Ferret)
Use web search before writing. Look for, in this order:
1. The LOCAL office/facility: address, ZIP, phone. Confirm it's in territory.
2. Ownership and decision-making: parent company, HQ, number of locations, whether IT/facilities/vendors are likely decided locally or centrally.
3. HARD signals from the last 30-90 days: hiring (IT, security, finance, facilities, ops), new leaders, expansion, relocation, acquisition, new facility, compliance/technology initiatives. Put a date on every signal.
4. The right person for the problem (match person to problem, not seniority). Mark people verified only if a current source shows them in the role.
5. Anything in Aaron's CRM notes that is now out of date (people who left, HQ moved, etc.). Call it out plainly in crmCorrections.
Search results pages from LinkedIn and job boards are fine to read. Never invent phones, emails, headcount, revenue, people, or signals. Label estimates "est." and anything shaky "unverified". If you find nothing recent, say so rather than stretching a soft signal into a hard one.
`.trim();

export function callCardSystemPrompt(rep: RepContext, withResearch: boolean): string {
  return [
    header(rep),
    readPlaybook('calls'),
    getReference('workflow'),
    getReference('verticals'),
    getReference('objections'),
    readPlaybook('examples'),
    getReference('sessions'),
    getReference('training'),
    PRE_SEND_CHECK,
    callStyleRulesText(rep),
    withResearch ? RESEARCH_RULES : '',
    `# OUTPUT (Ferret)
Work in Aaron's order: current research, then CRM history, then hypothesis, then person, then the card. background is that research. Return the call card for ONE account. Respect any instruction Aaron gives for this call (who he's calling, what not to mention); it overrides everything else.
If CRM notes show an angle was already qualified out, don't lead with it again. If research shows the local office has no decision authority, say so in "take", set priority accordingly, and make the win condition getting the right corporate name.
If the account is outside territory or clearly not ICP, still fill the card but set priority to SKIP and explain in "take".`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const PRE_SEND_CHECK = `# DOUBLE CHECK BEFORE ANY OUTREACH (Aaron's rule; fill preSendCheck honestly)
1. Right person? Match the person to the problem: IT owns support and alerts, the controller owns receipts and spend, the owner owns risk and cost.
2. Still there? Confirm with a CURRENT source that the contact is still at the company in that role. Old CRM notes and old lead lists don't count. If they left, say so and recommend calling to find who replaced them.
3. Signal still true? Re-check the signal you lead with: is the permit still active, the job still posted, the expansion still happening, the date recent? If it is stale, don't lead with it; use the next true reason or say there is no strong current trigger.
4. Angle fits this person? If the angle belongs to someone else, change the person or the angle.
Never mark anything verified without a source you actually saw.`;

const VOICE_PRECEDENCE = `Where AARON'S VOICE and older playbook text differ on wording, opener, length or the closing ask, follow AARON'S VOICE. Reuse his real phrases and rhythm; only the facts change per account. Use the opener from his table that is TRUE for this account, never one implying a visit, call or referral that did not happen.`;

export function emailSystemPrompt(rep: RepContext, withResearch: boolean): string {
  const voice = getVoice();
  return [
    header(rep),
    readPlaybook('emails'),
    getReference('workflow'),
    readPlaybook('examples'),
    getReference('sessions'),
    getReference('training'),
    voice,
    voice ? VOICE_PRECEDENCE : '',
    PRE_SEND_CHECK,
    emailStyleRulesText(rep.name),
    withResearch ? RESEARCH_RULES : '',
    `# OUTPUT (Ferret)
Return ONE email for ONE account. Respect any instruction Aaron gives for this email; it overrides everything else.
The body is the complete email from the greeting to "Thanks," and the sign-off name, written as short paragraphs separated by blank lines, never bulleted or broken into one-line fragments. Net-new (no CRM notes, no logged touches): cold first touch, about 40-80 words, ctaType "question". Accounts with history: warm, can run longer, ctaType "meeting" when a 10 or 15-minute ask makes sense.
CRM accounts: reopen the exact unfinished thread from the notes. Net-new accounts: never imply prior familiarity.
If the answers to WHY THIS ACCOUNT / WHY NOW are weak, set priority to SKIP and say why in skipReason (still write the best honest draft).
If more information is needed before a meeting ask makes sense (unknown owner, unclear what an outside vendor covers), use ctaType "question": the email asks the one business question and no meeting. Otherwise ctaType "meeting".
If email is the wrong move (the contact left, only a generic inbox exists), set recommendation "call_first" and give the exact call line in recommendationReason.
crmNotes are the bullet notes Aaron will log once he sends it, in the style of the reference example, ending with "Awaiting response". They record only what Aaron did and what he already knew. Research to-dos or things to verify do not go in crmNotes.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function debriefSystemPrompt(rep: RepContext): string {
  return [
    header(rep),
    readPlaybook('calls'),
    getReference('workflow'),
    getReference('objections'),
    readPlaybook('examples'),
    getReference('sessions'),
    readPlaybook('hotlist'),
    getVoice(),
    emailStyleRulesText(rep.name),
    `# OUTPUT (Ferret)
Aaron is pasting raw notes from a call, walk-in, email reply (including bounces and auto-replies), or LinkedIn touch. If it's a no-pickup, give the next move per HOW AARON WORKS. Coach it like a sales manager, not a cheerleader, using the CALL COACHING format.
Only use what's in his notes plus the account context given. Never invent what the prospect said.
crmNotes: short factual bullets like the reference example. No coaching in the CRM notes.
funnel: set each flag only if the notes clearly support it. If unsure, false.
followUpEmail: only if a post-call email makes sense (a real next step, info they asked for, or a relevant contact to reach). Otherwise leave subject and body empty. Follow the POST-CALL EMAIL rules.
hotList: decide how this touch changes the account on the Hot List using the HOT LIST rules and the current Hot List row (if any) in the context. Build on what was learned before; don't overwrite earlier learnings with less. A meeting booked means decision meeting_booked.`,
  ].join('\n\n');
}

export function reviseSystemPrompt(rep: RepContext, kind: 'call_card' | 'email'): string {
  return [
    header(rep),
    readPlaybook(kind === 'email' ? 'emails' : 'calls'),
    getReference('workflow'),
    readPlaybook('examples'),
    kind === 'email' ? getVoice() : '',
    kind === 'email' ? emailStyleRulesText(rep.name) : callStyleRulesText(rep),
    `# OUTPUT (Ferret)
Aaron wants a change to an existing ${kind === 'email' ? 'email' : 'call card'}. Apply his instruction and return the full updated version in the same shape. Change only what the instruction asks for, keep every fact, and never add facts that weren't there. Keep all the playbook rules (no em dashes, one angle, one CTA).`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function leadFinderSystemPrompt(rep: RepContext): string {
  return [
    header(rep),
    readPlaybook('calls'),
    getReference('workflow'),
    getReference('verticals'),
    RESEARCH_RULES,
    `# OUTPUT (Ferret)
Aaron said "Get me today's leads." Find NET-NEW accounts using live web search, following the DAILY OUTPUT, TERRITORY + ICP, and COVERAGE + NO REPEAT rules.
Every account must have a verified local office in one of the requested ZIPs. Never include a company on the exclusion list.
Favor HIGH and MEDIUM. Return fewer accounts rather than padding with weak ones, and say why in notes.
primaryQuestion is the one question Aaron should ask. meetingHypothesis is the exact 10-minute conversation to earn.`,
  ].join('\n\n');
}

export function hotListSystemPrompt(rep: RepContext): string {
  return [
    header(rep),
    readPlaybook('calls'),
    getReference('workflow'),
    readPlaybook('hotlist'),
    `# OUTPUT (Ferret)
Assess whether this account belongs on Aaron's Hot List right now, using only his CRM notes, logged activity, and stored research in the context. Fill the row the way the HOT LIST rules describe. If the evidence is only a generic fit or no-pickups, say not_qualified and explain why in reason (still fill the other fields with your best honest read).`,
  ].join('\n\n');
}

export function styleFixSystemPrompt(rep: RepContext): string {
  return [
    header(rep),
    readPlaybook('emails'),
    getVoice(),
    emailStyleRulesText(rep.name),
    `# OUTPUT (Ferret)
An automatic style check flagged this email. Rewrite it so every flagged issue is fixed and nothing else changes: same facts, same angle, same thread, same person. Do not add facts. Return the full email in the same shape.`,
  ].join('\n\n');
}

export function callStyleFixSystemPrompt(rep: RepContext): string {
  return [
    header(rep),
    readPlaybook('calls'),
    readPlaybook('examples'),
    callStyleRulesText(rep),
    `# OUTPUT (Ferret)
An automatic check flagged this call card. Fix every flagged issue and change nothing else: same facts, same target, same angle, same hypothesis. Do not add facts. Return the full card in the same shape.`,
  ].join('\n\n');
}
