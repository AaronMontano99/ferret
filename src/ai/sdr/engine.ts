/**
 * Lead SDR workflow runner — gathers real account context (CRM notes,
 * logged activity, stored research), calls Claude with the rep's
 * playbook, validates the structured answer, and persists it.
 *
 * Research strategy: the first card/email for an account (or any time
 * research is stale or the rep hits Refresh) runs WITH live web search
 * and returns fresh intel alongside the card in one pass. After that,
 * cards and emails reuse the stored intel with no web tools, which is
 * much faster.
 */
import { z } from 'zod';
import { runClaude } from '@/ai/providers/claude-cli-provider';
import { getAccount } from '@/data/accounts';
import { getIdentity, getSettings } from '@/data/settings';
import {
  getActivitiesForAccount,
  getHotListEntry,
  getCrmNotes,
  getIntel,
  getLatestDraft,
  isIntelStale,
  knownCompanyDisplayNames,
  saveDraft,
  saveIntel,
  saveLeadCandidates,
  type StoredIntel,
} from '@/data/sdr';
import {
  callCardSchema,
  debriefSchema,
  emailDraftSchema,
  hotListUpdateSchema,
  intelSchema,
  leadsResultSchema,
  toJsonSchema,
  type AccountIntel,
  type CallCard,
  type Debrief,
  type EmailDraft,
  type HotListUpdate,
} from './schemas';
import {
  callCardSystemPrompt,
  debriefSystemPrompt,
  emailSystemPrompt,
  hotListSystemPrompt,
  leadFinderSystemPrompt,
  reviseSystemPrompt,
  styleFixSystemPrompt,
  callStyleFixSystemPrompt,
  type RepContext,
} from './prompts';
import { lintEmail, normalizeEmail, normalizeSubject, type EmailStyleIssue } from '@/domain/email-style';
import { ymd } from '@/domain/hot-list';
import { lintCallCard, normalizeCallCard, stripDashesDeep, type CallStyleIssue } from '@/domain/call-style';
import { isTerritoryZip, territoryStatus } from '@/domain/territory';

const RESEARCH_TIMEOUT_MS = 8 * 60_000;
const WRITE_TIMEOUT_MS = 4 * 60_000;
const LEADS_TIMEOUT_MS = 20 * 60_000;

function repContext(): RepContext {
  const s = getSettings();
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const id = getIdentity();
  return { name: id.name, company: id.company, location: id.location, zips: id.zips, phone: s.phoneNumber, today };
}

function model(): string {
  return getSettings().claudeModel || 'sonnet';
}

/** Local calendar date (the rep's day), never the UTC date — after ~5pm Pacific those differ. */
function day(iso: string): string {
  return ymd(new Date(iso));
}

/** The full, honest picture of an account as Ferret knows it — the "user prompt" for every SDR task. */
export function buildAccountContext(accountId: string, intel: StoredIntel | null): string {
  const account = getAccount(accountId);
  if (!account) throw new Error('Account not found');

  const lines: string[] = ['ACCOUNT'];
  lines.push(`Name: ${account.name}`);
  if (account.domain) lines.push(`Website: ${account.domain}`);
  if (account.industry) lines.push(`Industry (on file): ${account.industry}`);
  if (account.address || account.zip) lines.push(`Address on file: ${[account.address, account.zip].filter(Boolean).join(', ')}`);
  if (account.phone) lines.push(`Phone on file: ${account.phone}`);

  const notes = getCrmNotes(accountId);
  lines.push('', "AARON'S CRM HISTORY AND NOTES (verbatim, newest pasted first)");
  if (notes.length === 0) lines.push('None. Treat as NET-NEW.');
  for (const n of notes) lines.push(`[pasted ${day(n.createdAt)}] ${n.content}`);

  const activities = getActivitiesForAccount(accountId);
  if (activities.length > 0) {
    lines.push('', 'ACTIVITY LOGGED IN SCOUT (newest first)');
    for (const a of activities.slice(0, 15)) {
      const head = `${day(a.occurredAt)} ${a.channel.replace('_', '-')}${a.contactName ? ` with ${a.contactName}` : ''}${a.outcome ? ` (${a.outcome})` : ''}`;
      lines.push(`- ${head}${a.crmNotes.length ? `: ${a.crmNotes.join('; ')}` : a.rawNotes ? `: ${a.rawNotes}` : ''}`);
    }
  }

  const hot = getHotListEntry(accountId);
  if (hot) {
    const { accountId: _id, accountName: _name, ...row } = hot;
    lines.push('', 'CURRENT HOT LIST ROW', JSON.stringify(row, null, 1));
  }

  if (intel) {
    lines.push('', `RESEARCH (live web, gathered ${day(intel.researchedAt)})`, JSON.stringify(intel.intel, null, 1));
  }

  return lines.join('\n');
}

function withInstruction(context: string, instruction: string | undefined, task: string): string {
  return [context, instruction ? `\nAARON'S INSTRUCTION FOR THIS ONE (highest priority)\n${instruction}` : '', `\n${task}`].join('\n');
}

function validate<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(`Claude's ${what} came back incomplete. Try again.`);
  return parsed.data;
}


const TITLE_WORDS = /^(president|owner|ceo|cfo|coo|cio|cto|founder|principal|partner|manager|director|controller|administrator|head|vp|unknown|tbd|n\/a|the)$/i;

function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  // A title in the name slot ("President") is not a name: fall back to "Hi,".
  return /^[A-Za-z][A-Za-z'-]*$/.test(first) && !TITLE_WORDS.test(first) ? first : '';
}

/** If the contact left, the email is the wrong move: call to find who replaced them. */
function applyPreSendCheck<T extends { recommendation?: string; recommendationReason?: string; preSendCheck?: { personCurrent: string; personEvidence: string } }>(email: T): T {
  if (email.preSendCheck?.personCurrent === 'left' && email.recommendation !== 'call_first') {
    return { ...email, recommendation: 'call_first', recommendationReason: `The contact appears to have left (${email.preSendCheck.personEvidence}). Call the front desk and ask who handles this now.` };
  }
  return email;
}

const simpleEmailSchema = z.object({ subject: z.string(), body: z.string() });

/**
 * Hard-coded style enforcement (src/domain/email-style.ts): normalize
 * deterministically, lint, and if anything is off do ONE targeted
 * rewrite. Keeps whichever version has fewer issues and reports what's
 * left so the UI can flag it — never loops.
 */
/** Warm = Aaron has history with this account (CRM notes or a logged touch). Cold = net-new. */
function isWarm(accountId: string): boolean {
  return getCrmNotes(accountId).length > 0 || getActivitiesForAccount(accountId).length > 0;
}

async function enforceEmailStyle<T extends { subject: string; body: string; ctaType?: 'meeting' | 'question' }>(
  email: T,
  contactName: string,
  context: string,
  warm?: boolean
): Promise<{ email: T; styleIssues: EmailStyleIssue[] }> {
  const id = getIdentity();
  const clean = (e: T): T => ({ ...e, subject: normalizeSubject(e.subject), body: normalizeEmail(e.body, firstName(contactName), id.name, id.company) });
  let best = clean(email);
  const cta = email.ctaType ?? 'meeting';
  let issues = lintEmail(best.subject, best.body, cta, { warm });
  if (issues.length === 0) return { email: best, styleIssues: [] };

  try {
    const result = await runClaude({
      model: model(),
      systemPrompt: styleFixSystemPrompt(repContext()),
      prompt: [
        context,
        '',
        'EMAIL TO FIX',
        `Subject: ${best.subject}`,
        '',
        best.body,
        '',
        'FLAGGED ISSUES (fix all of these)',
        ...issues.map((i) => `- ${i.detail}`),
      ].join('\n'),
      jsonSchema: toJsonSchema(simpleEmailSchema),
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    const fixed = simpleEmailSchema.safeParse(result.data);
    if (fixed.success) {
      const candidate = clean({ ...best, subject: fixed.data.subject, body: fixed.data.body });
      const candidateIssues = lintEmail(candidate.subject, candidate.body, cta, { warm });
      if (candidateIssues.length < issues.length) {
        best = candidate;
        issues = candidateIssues;
      }
    }
  } catch {
    // The rewrite is best-effort; the normalized first draft still stands, with its issues surfaced.
  }
  return { email: best, styleIssues: issues };
}

/** Territory is computed from the ZIP/address, never taken on the model's word; text is de-dashed. */
function normalizeIntel(intel: AccountIntel): AccountIntel {
  const clean = stripDashesDeep(intel);
  const computed = territoryStatus(clean.localOffice.zip, clean.localOffice.address, getIdentity().zips);
  return { ...clean, localOffice: { ...clean.localOffice, inTerritory: computed === 'unknown' ? clean.localOffice.inTerritory : computed } };
}

/**
 * Hard-coded call rules (src/domain/call-style.ts): normalize, force
 * SKIP for an out-of-territory office, lint, and do ONE targeted
 * rewrite if anything fails. Keeps the version with fewer issues.
 */
async function enforceCallCardStyle(card: CallCard, context: string, intel: AccountIntel | null): Promise<{ card: CallCard; styleIssues: CallStyleIssue[] }> {
  const phone = getSettings().phoneNumber;
  const territory = (c: CallCard): CallCard => {
    if (intel?.localOffice.inTerritory !== 'no' || c.priority === 'SKIP') return c;
    const where = intel.localOffice.zip || intel.localOffice.address;
    return { ...c, priority: 'SKIP', take: `Outside territory (${where}). ${c.take}` };
  };
  let best = territory(normalizeCallCard(card, phone));
  const id = getIdentity();
  let issues = lintCallCard(best, id);
  if (issues.length === 0) return { card: best, styleIssues: [] };

  try {
    const result = await runClaude({
      model: model(),
      systemPrompt: callStyleFixSystemPrompt(repContext()),
      prompt: [context, '', 'CALL CARD TO FIX', JSON.stringify(best, null, 1), '', 'FLAGGED ISSUES (fix all of these)', ...issues.map((i) => `- ${i.detail}`)].join('\n'),
      jsonSchema: toJsonSchema(callCardSchema),
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    const fixed = callCardSchema.safeParse(result.data);
    if (fixed.success) {
      const candidate = territory(normalizeCallCard(fixed.data, phone));
      const candidateIssues = lintCallCard(candidate, id);
      if (candidateIssues.length < issues.length) {
        best = candidate;
        issues = candidateIssues;
      }
    }
  } catch {
    // Best-effort; the normalized first card stands, with its issues surfaced.
  }
  return { card: best, styleIssues: issues };
}

export interface GenerateOptions {
  instruction?: string;
  /** Force a fresh live web research pass even if stored intel is recent. */
  refreshResearch?: boolean;
}

export interface CardResult {
  draftId: string;
  card: CallCard;
  styleIssues: CallStyleIssue[];
  intel: AccountIntel | null;
  researched: boolean;
  durationMs: number;
}

export async function generateCallCard(accountId: string, options: GenerateOptions = {}): Promise<CardResult> {
  const stored = getIntel(accountId);
  const research = options.refreshResearch || isIntelStale(stored);
  const rep = repContext();

  if (research) {
    const schema = z.object({ intel: intelSchema, card: callCardSchema });
    const result = await runClaude({
      model: model(),
      systemPrompt: callCardSystemPrompt(rep, true),
      prompt: withInstruction(buildAccountContext(accountId, null), options.instruction, 'Research this account live, then return the intel and the call card.'),
      jsonSchema: toJsonSchema(schema),
      webSearch: true,
      timeoutMs: RESEARCH_TIMEOUT_MS,
    });
    const out = validate(schema, result.data, 'call card');
    const intel = normalizeIntel(out.intel);
    saveIntel(accountId, intel, result.model);
    const styled = await enforceCallCardStyle(out.card, buildAccountContext(accountId, getIntel(accountId)), intel);
    const draftId = saveDraft(accountId, 'call_card', styled.card, options.instruction ?? null, result.model);
    return { draftId, card: styled.card, styleIssues: styled.styleIssues, intel, researched: true, durationMs: result.durationMs };
  }

  const result = await runClaude({
    model: model(),
    systemPrompt: callCardSystemPrompt(rep, false),
    prompt: withInstruction(buildAccountContext(accountId, stored), options.instruction, 'Return the call card.'),
    jsonSchema: toJsonSchema(callCardSchema),
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  const raw = validate(callCardSchema, result.data, 'call card');
  const styled = await enforceCallCardStyle(raw, buildAccountContext(accountId, stored), stored?.intel ?? null);
  const draftId = saveDraft(accountId, 'call_card', styled.card, options.instruction ?? null, result.model);
  return { draftId, card: styled.card, styleIssues: styled.styleIssues, intel: stored?.intel ?? null, researched: false, durationMs: result.durationMs };
}

export interface EmailResult {
  draftId: string;
  email: EmailDraft;
  styleIssues: EmailStyleIssue[];
  intel: AccountIntel | null;
  researched: boolean;
  durationMs: number;
}

export async function generateEmail(accountId: string, options: GenerateOptions = {}): Promise<EmailResult> {
  const stored = getIntel(accountId);
  const research = options.refreshResearch || isIntelStale(stored);
  const rep = repContext();

  if (research) {
    const schema = z.object({ intel: intelSchema, email: emailDraftSchema });
    const result = await runClaude({
      model: model(),
      systemPrompt: emailSystemPrompt(rep, true),
      prompt: withInstruction(buildAccountContext(accountId, null), options.instruction, 'Research this account live, then return the intel and the email.'),
      jsonSchema: toJsonSchema(schema),
      webSearch: true,
      timeoutMs: RESEARCH_TIMEOUT_MS,
    });
    const out = validate(schema, result.data, 'email');
    const intel = normalizeIntel(out.intel);
    saveIntel(accountId, intel, result.model);
    const styled = await enforceEmailStyle(applyPreSendCheck(out.email), out.email.contact.name, buildAccountContext(accountId, getIntel(accountId)), isWarm(accountId));
    const draftId = saveDraft(accountId, 'email', styled.email, options.instruction ?? null, result.model);
    return { draftId, email: styled.email, styleIssues: styled.styleIssues, intel, researched: true, durationMs: result.durationMs };
  }

  const result = await runClaude({
    model: model(),
    systemPrompt: emailSystemPrompt(rep, false),
    prompt: withInstruction(buildAccountContext(accountId, stored), options.instruction, 'Return the email.'),
    jsonSchema: toJsonSchema(emailDraftSchema),
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  const raw = validate(emailDraftSchema, result.data, 'email');
  const styled = await enforceEmailStyle(applyPreSendCheck(raw), raw.contact.name, buildAccountContext(accountId, stored), isWarm(accountId));
  const draftId = saveDraft(accountId, 'email', styled.email, options.instruction ?? null, result.model);
  return { draftId, email: styled.email, styleIssues: styled.styleIssues, intel: stored?.intel ?? null, researched: false, durationMs: result.durationMs };
}

/** "Turn this into 3 paragraphs" — edits the latest draft per Aaron's instruction without re-researching. */
export async function reviseDraft(
  accountId: string,
  kind: 'call_card' | 'email',
  instruction: string
): Promise<{ draftId: string; data: CallCard | EmailDraft; styleIssues: (EmailStyleIssue | CallStyleIssue)[] }> {
  const latest = getLatestDraft(accountId, kind);
  if (!latest) throw new Error('Nothing to revise yet. Generate one first.');
  const schema = kind === 'email' ? emailDraftSchema : callCardSchema;
  const result = await runClaude({
    model: model(),
    systemPrompt: reviseSystemPrompt(repContext(), kind),
    prompt: [
      buildAccountContext(accountId, getIntel(accountId)),
      '',
      `CURRENT ${kind === 'email' ? 'EMAIL' : 'CALL CARD'}`,
      JSON.stringify(latest.data, null, 1),
      '',
      `AARON'S CHANGE REQUEST\n${instruction}`,
    ].join('\n'),
    jsonSchema: toJsonSchema(schema),
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  let data = validate(schema as z.ZodType<CallCard | EmailDraft>, result.data, kind === 'email' ? 'email' : 'call card');
  let styleIssues: (EmailStyleIssue | CallStyleIssue)[] = [];
  const reviseContext = buildAccountContext(accountId, getIntel(accountId));
  if (kind === 'email') {
    const email = data as EmailDraft;
    const styled = await enforceEmailStyle(email, email.contact.name, reviseContext, isWarm(accountId));
    data = styled.email;
    styleIssues = styled.styleIssues;
  } else {
    const styled = await enforceCallCardStyle(data as CallCard, reviseContext, getIntel(accountId)?.intel ?? null);
    data = styled.card;
    styleIssues = styled.styleIssues;
  }
  const draftId = saveDraft(accountId, kind, data as never, instruction, result.model);
  return { draftId, data, styleIssues };
}

export async function coachNotes(accountId: string, notes: string, channel: string): Promise<Debrief> {
  const result = await runClaude({
    model: model(),
    systemPrompt: debriefSystemPrompt(repContext()),
    prompt: [
      buildAccountContext(accountId, getIntel(accountId)),
      '',
      `CALL CARD AARON WAS WORKING FROM`,
      JSON.stringify(getLatestDraft(accountId, 'call_card')?.data ?? 'none', null, 1),
      '',
      `TODAY (for next-touch dates): ${ymd(new Date())}`,
      '',
      `AARON'S RAW NOTES (${channel.replace('_', '-')}, just now)`,
      notes,
    ].join('\n'),
    jsonSchema: toJsonSchema(debriefSchema),
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  const debrief = stripDashesDeep(validate(debriefSchema, result.data, 'debrief'));
  if (debrief.followUpEmail.body.trim()) {
    const styled = await enforceEmailStyle(debrief.followUpEmail, debrief.contactName, notes, true);
    debrief.followUpEmail = styled.email;
  }
  return debrief;
}

export interface FindLeadsInput {
  zips: string[];
  industries: string[];
  count: number;
  focus?: string;
}

export async function findLeads(input: FindLeadsInput): Promise<{ runId: string; saved: number; returned: number; notes: string }> {
  const exclusions = knownCompanyDisplayNames();
  const prompt = [
    `Get me today's leads.`,
    `ZIPs: ${input.zips.join(', ')}`,
    input.industries.length ? `Industries to focus on: ${input.industries.join(', ')}` : 'Industries: any ICP industry from the playbook.',
    `How many: up to ${input.count} (fewer is fine; never pad).`,
    input.focus ? `Extra focus from Aaron: ${input.focus}` : '',
    '',
    `EXCLUSION LIST (already in Ferret or already suggested, never return these):`,
    exclusions.length ? exclusions.join('; ') : 'none',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const result = await runClaude({
    model: model(),
    systemPrompt: leadFinderSystemPrompt(repContext()),
    prompt,
    jsonSchema: toJsonSchema(leadsResultSchema),
    webSearch: true,
    timeoutMs: LEADS_TIMEOUT_MS,
  });
  const out = validate(leadsResultSchema, result.data, 'lead list');
  // Territory is non-negotiable: anything without a verified in-territory ZIP is dropped here, whatever the model said.
  const zips = getIdentity().zips;
  const inTerritory = out.leads.filter((l) => isTerritoryZip(l.zip, zips) || isTerritoryZip(l.address, zips)).map((l) => stripDashesDeep(l));
  const dropped = out.leads.length - inTerritory.length;
  const runId = crypto.randomUUID();
  const saved = saveLeadCandidates(runId, inTerritory);
  const notes = [out.notes, dropped > 0 ? `Dropped ${dropped} outside your ZIPs.` : ''].filter(Boolean).join(' ');
  return { runId, saved, returned: out.leads.length, notes };
}

/** "Should this be on my Hot List?" — builds the Qualified-IN row from existing notes/activity/research, no web search. */
export async function assessHotList(accountId: string): Promise<HotListUpdate> {
  const result = await runClaude({
    model: model(),
    systemPrompt: hotListSystemPrompt(repContext()),
    prompt: `${buildAccountContext(accountId, getIntel(accountId))}\n\nToday is ${ymd(new Date())}. Return the Hot List assessment.`,
    jsonSchema: toJsonSchema(hotListUpdateSchema),
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  return stripDashesDeep(validate(hotListUpdateSchema, result.data, 'hot list row'));
}
