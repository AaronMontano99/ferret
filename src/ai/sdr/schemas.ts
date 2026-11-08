import { z } from 'zod';

/**
 * Output shapes for the Lead SDR workflow. Field names mirror the
 * rep's own playbook headings (src/ai/sdr/playbooks/*.md) so the UI
 * can render them as the same glanceable card he already uses.
 *
 * Every field is required (empty string / empty array when unknown)
 * rather than optional — structured output is more reliable that way,
 * and the UI simply hides empty fields.
 */

export const PRIORITY = z.enum(['HIGH', 'MEDIUM', 'LOW', 'SKIP']);
export type Priority = z.infer<typeof PRIORITY>;

const source = z.object({
  label: z.string().describe('Short name of the source, e.g. "Company site: local office page"'),
  url: z.string(),
});

export const signalSchema = z.object({
  signal: z.string().describe('What changed or what is true, one line, no fluff'),
  date: z.string().describe('When it happened or was published (e.g. "Aug 2026"), or "" if undated'),
  strength: z.enum(['HARD', 'SOFT']),
  sourceUrl: z.string(),
});
export type Signal = z.infer<typeof signalSchema>;

export const intelSchema = z.object({
  summary: z.string().describe('1-2 lines: what the LOCAL operation actually does. No company history.'),
  localOffice: z.object({
    address: z.string(),
    zip: z.string(),
    inTerritory: z.enum(['yes', 'no', 'unknown']),
    phone: z.string(),
  }),
  parentCompany: z.string().describe('Parent/owner if any, or ""'),
  headquarters: z.string().describe('HQ city if different from the local office, or ""'),
  locations: z.string().describe('Number/spread of locations if known, or ""'),
  employees: z.string().describe('Headcount with "est." if not verified, or ""'),
  revenue: z.string().describe('Revenue with "est." if not verified, or ""'),
  signals: z.array(signalSchema),
  people: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      verified: z.boolean().describe('true only if a current source confirms this person holds this role'),
      sourceUrl: z.string(),
    })
  ),
  crmCorrections: z.array(z.string()).describe('Places where research contradicts Aaron\'s CRM notes (e.g. "CRM says HQ in Concord; site now lists Hayward")'),
  decisionOwnership: z.string().describe('What is known about local vs corporate decision-making, or ""'),
  sources: z.array(source),
});
export type AccountIntel = z.infer<typeof intelSchema>;

export const SIGNAL_STATUS = z.enum(['HARD SIGNAL', 'SOFT SIGNAL', 'NO RECENT SIGNAL']);

/**
 * The rep's double check, required before any outreach:
 * right person, still there, signal still true, angle relevant to THIS person.
 */
export const preSendCheckSchema = z.object({
  personCurrent: z.enum(['verified', 'unverified', 'left']).describe('Is the contact still at the company in this role? verified only if a CURRENT source (company site, recent post, dated article, current LinkedIn result) shows it. left if any source shows they moved on.'),
  personEvidence: z.string().describe('Source and date behind personCurrent, e.g. "Company team page, checked today" or "No current source found"'),
  signalCurrent: z.enum(['verified', 'stale', 'unverified']).describe('Is the signal you lead with still true today? stale if it is over ~90 days old, already finished, filled, reversed or superseded.'),
  signalEvidence: z.string().describe('Source and date behind signalCurrent'),
  angleFit: z.enum(['strong', 'weak', 'wrong_person']).describe('Does the angle match what THIS person owns and is measured on (IT owns support/alerts, controller owns spend/receipts, owner owns risk and cost)? wrong_person if someone else owns this problem.'),
  angleReason: z.string().describe('One line: why this angle matters to this person, or who owns it instead'),
});
export type PreSendCheck = z.infer<typeof preSendCheckSchema>;

export const callCardSchema = z.object({
  background: z
    .array(z.string())
    .describe('3-6 short bullets of CURRENT research done first: local office + ZIP, size, what they actually do, ownership/who decides, the freshest dated facts. No company history, no fluff.'),
  signalStatus: SIGNAL_STATUS.describe('Label for the current reason to call. Old CRM notes never count as a recent signal.'),
  whyNow: z.string().describe('The honest reason to call today, with date and source when it is a signal. If NO RECENT SIGNAL, say the real reason (reactivation, unfinished thread, service check, routing).'),
  priority: PRIORITY,
  take: z.string().describe('1-3 sentences of coaching before the card, e.g. "I\'d not lead with printers here. ..." Plain, direct.'),
  target: z.object({ name: z.string(), title: z.string(), why: z.string() }),
  preSendCheck: preSendCheckSchema,
  routingContact: z.string().describe('Old/secondary contact useful for routing, and how to use them, or ""'),
  reason: z.string().describe('REASON: why this account, why now'),
  opening: z.string().describe('Exact opening line, in quotes-free spoken form, using the rep\'s opening shape: "[Name], [rep] with [company] here in [location]. Reason for my call, ..."'),
  hypothesis: z.string().describe('One hypothesis, framed as something to test, never as fact'),
  primaryQuestion: z.string(),
  followUp: z.string().describe('Max one optional follow-up, or ""'),
  branches: z
    .array(z.object({ ifThey: z.string().describe('e.g. "Say it\'s centralized"'), say: z.string() }))
    .describe('0-2 short if/then branches when the answer genuinely forks'),
  listenFor: z.array(z.string()),
  angle: z.string().describe('ONE entry point, plus what not to bring up if relevant'),
  meetingBridge: z.string(),
  meetingAsk: z.string(),
  voicemail: z.string().describe('20-40 seconds spoken. Name, local context, reason, relevance, callback. Use the rep phone number if given.'),
  gatekeeper: z.string().describe('What to ask a gatekeeper to route to the owner of the problem'),
  winCondition: z.string().describe('What counts as a win on this call'),
  meetingHypothesis: z.string().describe('The exact 10-minute conversation to earn'),
  ifNoAnswer: z.string().describe('The next move if nobody picks up, using the history (e.g. leave the VM and try Tuesday AM; or, after repeated no-pickups, move to the walk-in list with the best known day/time).'),
  sources: z.array(source),
});
export type CallCard = z.infer<typeof callCardSchema>;

export const emailDraftSchema = z.object({
  priority: PRIORITY,
  skipReason: z.string().describe('If priority is SKIP, why. Otherwise ""'),
  recommendation: z
    .enum(['send', 'call_first'])
    .describe('call_first when email is the wrong move right now, e.g. the contact left the company or only a generic inbox exists'),
  recommendationReason: z.string().describe('If call_first: what to do and the exact line to say on the call. Otherwise ""'),
  signalStatus: SIGNAL_STATUS,
  contact: z.object({ name: z.string(), title: z.string(), email: z.string().describe('Only if verified, else ""'), phone: z.string() }),
  whyAccount: z.string(),
  signal: z.string().describe('Signal + date + HARD/SOFT, or "No strong current trigger"'),
  crmHistory: z.string().describe('Relevant prior notes only, or "NET-NEW"'),
  hypothesis: z.string(),
  angle: z.string(),
  whyPerson: z.string(),
  preSendCheck: preSendCheckSchema,
  subject: z.string(),
  ctaType: z
    .enum(['meeting', 'question'])
    .describe('meeting = ends by asking for 10 or 15 minutes (warm accounts). question = cold first touch or more information needed first: ask the one business question, no meeting ask yet.'),
  body: z.string().describe('The full email, greeting to sign-off, short paragraphs separated by blank lines. Cold first touch about 40-80 words; warm follow-ups can run longer. No em dashes.'),
  meetingHypothesis: z.string(),
  crmNotes: z.array(z.string()).describe('Bullet CRM notes to log once sent, like "Emailed Jordan Hale", ..., "Awaiting response"'),
});
export type EmailDraft = z.infer<typeof emailDraftSchema>;

export const OUTCOMES = [
  'no_answer',
  'voicemail',
  'gatekeeper',
  'general_staff',
  'decision_maker',
  'other_executive',
  'meeting_booked',
  'follow_up_required',
  'not_interested',
  'wrong_contact',
  'connected',
] as const;

export const hotListUpdateSchema = z.object({
  decision: z
    .enum(['qualify_in', 'update', 'meeting_booked', 'close', 'not_qualified'])
    .describe('qualify_in = add to Hot List; update = already on it, update row; meeting_booked = take it off (meeting set); close = dead/recycle; not_qualified = not enough evidence to add'),
  reason: z.string().describe('One line: why this decision'),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  stage: z.enum(['new_qi', 'developing', 'warm', 'meeting_ask_ready', 'meeting_booked', 'closed']),
  contact: z.string().describe('Name, title of the person to work next'),
  whyQualified: z.string(),
  lastInteraction: z.string().describe('What actually happened on the last meaningful touch, with date, e.g. "9/24 call: front desk said security runs through the landlord"'),
  learned: z.string(),
  hypothesis: z.string(),
  nextQuestion: z.string().describe('The one thing to learn next to earn the meeting'),
  nextAction: z.enum(['call', 'email', 'walk_in', 'linkedin', 'research']),
  nextTouchDate: z.string().describe('YYYY-MM-DD'),
  angle: z.string(),
  meetingHypothesis: z.string(),
});
export type HotListUpdate = z.infer<typeof hotListUpdateSchema>;

export const debriefSchema = z.object({
  whatHappened: z.string(),
  whatILearned: z.array(z.string()),
  meetingOpportunity: z.string(),
  didIAsk: z.string().describe('Did Aaron ask for the meeting? Yes/No and one line on how'),
  whereILostControl: z.string().describe('Honest, or "Nowhere obvious" if it went fine'),
  betterQuestion: z.string(),
  betterMeetingBridge: z.string(),
  nextStep: z.string(),
  crmNotes: z.array(z.string()).describe('Short factual bullets, only what the notes say'),
  status: z.string().describe('e.g. "Centralized / No local authority", "Meeting booked", "Follow up in Q1"'),
  crmNextStep: z.string(),
  outcome: z.enum(OUTCOMES),
  category: z.enum(['prospecting', 'admin']).describe('admin = customer service / existing-customer admin work, not prospecting'),
  funnel: z.object({
    connected: z.boolean().describe('Spoke to a live person / got a reply'),
    decisionMaker: z.boolean().describe('Spoke with the decision-maker or someone who owns the problem'),
    relevantConversation: z.boolean().describe('Real conversation about a relevant problem, not just routing'),
    meetingAsked: z.boolean(),
    meetingBooked: z.boolean(),
  }),
  contactName: z.string().describe('Main person Aaron spoke with, or ""'),
  followUpEmail: z
    .object({ subject: z.string(), body: z.string() })
    .describe('Post-call email if one makes sense (60-120 words, from actual notes only). Empty subject/body if not.'),
  hotList: hotListUpdateSchema.describe('How this touch changes the account on the Hot List, following the HOT LIST rules'),
});
export type Debrief = z.infer<typeof debriefSchema>;

export const leadSchema = z.object({
  company: z.string(),
  zip: z.string(),
  address: z.string(),
  domain: z.string(),
  industry: z.string(),
  employees: z.string(),
  revenue: z.string(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  whyCall: z.string(),
  businessOutcome: z.string(),
  signal: signalSchema,
  hypothesis: z.string(),
  angle: z.string(),
  primaryContact: z.object({ name: z.string(), title: z.string(), phone: z.string(), email: z.string(), linkedin: z.string() }),
  secondaryContact: z.string(),
  whyThisPerson: z.string(),
  primaryQuestion: z.string(),
  meetingHypothesis: z.string(),
  sources: z.array(source),
});
export type Lead = z.infer<typeof leadSchema>;

export const leadsResultSchema = z.object({ leads: z.array(leadSchema), notes: z.string().describe('Anything Aaron should know about this batch, e.g. why fewer were found') });

/** JSON Schema for the Claude CLI's --json-schema flag, which rejects the draft-2020-12 `$schema` header zod adds. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}
