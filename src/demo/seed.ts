/**
 * Made-up companies and people for the demo. Every name here is invented.
 * Used by the public demo (src/instrumentation.ts) and by `npm run demo`.
 *
 * Hosting runs several servers, each seeding its own copy, so account ids are
 * fixed: a link built on one server has to work on another.
 */
import { createAccount } from '@/data/accounts';
import * as sdr from '@/data/sdr';
import { createTask } from '@/data/tasks';
import { updateSettings } from '@/data/settings';
import { addBusinessDays, ymd } from '@/domain/hot-list';
import type { CallCard, EmailDraft, Lead } from '@/ai/sdr/schemas';

// Fixed seed: the demo looks the same every time.
let state = 42;
const rand = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)]!;

const COMPANIES = [
  ['Harbor Ridge Dental', 'Healthcare/Dental', 'Dana Whitfield, Office Manager'],
  ['Copperline Fabrication', 'Manufacturing', 'Marcus Oyelaran, GM'],
  ['Alder & Finch LLP', 'Law', 'Priya Raman, Managing Partner'],
  ['Northfork Logistics', 'Distribution/Logistics', 'Tom Eklund, Ops Director'],
  ['Saltbox Property Group', 'Property/CRE', 'Jess Moreau, Regional Manager'],
  ['Bright Fern Pediatrics', 'Healthcare/Dental', 'Dr. Lena Park, Owner'],
  ['Ironwood Civil', 'Construction/AEC', 'Reggie Tate, VP Operations'],
  ['Lantern Street CPAs', 'Accounting/Finance', 'Owen Sayers, Partner'],
  ['Quarry Hill Motors', 'Automotive', 'Nina Delgado, Controller'],
  ['Tidewater Nonprofit Alliance', 'Nonprofit', 'Sam Abara, Executive Director'],
  ['Redtail Software', 'Technology', 'Chloe Vance, Head of IT'],
  ['Meridian Test Labs', 'Professional services', 'Hank Sorensen, Site Lead'],
  ['Foxglove Academy', 'Education', 'Maya Ito, Business Manager'],
  ['Pinecrest Wholesale', 'Distribution/Logistics', 'Leo Marsh, Owner'],
  ['Summit Crane Rental', 'Construction/AEC', 'Ruth Calder, Office Manager'],
  ['Wren & Vale Interiors', 'Professional services', 'Ada Novak, Principal'],
];
const STAGES = ['warm', 'meeting_ask_ready', 'developing', 'new_qi', 'developing', 'warm', 'new_qi', 'meeting_ask_ready', 'new_qi', 'meeting_booked', 'developing', 'closed'] as const;
const QUESTIONS = ['Who owns the print contract when it renews?', 'Is the new office on the same network as the old one?', 'What happens when the MSP misses a ticket?', 'When does the copier lease end?', 'Who signs off on IT spend at this site?'];
const LEARNED = ['Front desk says the owner decides, not corporate.', 'Moved to a second floor in June and printing has been rough since.', 'Happy with IT support, unhappy with the invoices.', 'Lease ends in Q1, and nobody has pulled the paperwork yet.'];

export function seedDemo(): void {
  updateSettings({ ownerName: 'Alex', companyName: 'Demo Office Systems', location: 'Springfield', phoneNumber: '555-0100', territoryZips: ['90001', '90002', '90003'], weeklyDialGoal: 60, weeklyMeetingGoal: 3 });
  const today = new Date();
  const todayYmd = ymd(today);

  const accounts = COMPANIES.map(([name, industry], i) => ({ ...createAccount({ name: name!, industry, zip: `9000${i % 9}`, phone: `555-01${String(i + 10)}`, domain: `${name!.toLowerCase().replace(/[^a-z]+/g, '')}.example` }, `demo-${i + 1}`), contact: COMPANIES[i]![2]! }));

  accounts.forEach((a, i) => {
    const stage = STAGES[i];
    if (stage) {
      sdr.upsertHotList(a.id, {
        stage,
        priority: i % 3 === 0 ? 'HIGH' : i % 3 === 1 ? 'MEDIUM' : 'LOW',
        contact: a.contact,
        whyQualified: 'Local decision maker and a dated reason to talk.',
        nextQuestion: pick(QUESTIONS),
        learned: pick(LEARNED),
        hypothesis: 'The move left their setup behind their headcount.',
        angle: 'New space, old setup',
        lastInteraction: `${today.getMonth() + 1}/${today.getDate()} call: spoke with the front desk`,
        nextAction: i % 4 === 2 ? 'email' : i % 5 === 3 ? 'walk_in' : 'call',
        nextTouchDate: stage === 'closed' || stage === 'meeting_booked' ? null : addBusinessDays(todayYmd, i % 7),
        ...(stage === 'closed' ? { closeReason: 'Decisions all made at corporate.' } : {}),
      });
    }
    if (i < 8) sdr.saveIntel(a.id, { summary: 'Local office with a recent change worth asking about.', localOffice: { address: '100 Example Ave', zip: `9000${i % 9}`, inTerritory: 'yes', phone: `555-01${i + 10}` }, parentCompany: '', headquarters: '', locations: '', employees: 'est. 40', revenue: '', signals: [{ signal: 'Moved to a bigger office this quarter', date: 'This quarter', strength: i % 2 ? 'SOFT' : 'HARD', sourceUrl: '' }], people: [], crmCorrections: [], decisionOwnership: 'Local', sources: [] }, 'demo');
    if (i % 5 === 0) sdr.setFavorite(a.id, true);
  });

  // Twelve weeks of ordinary work, mornings and late afternoons on purpose so the heatmap has a shape.
  for (let week = 11; week >= 0; week--) {
    const dials = 18 + Math.floor(rand() * 26);
    const emails = 5 + Math.floor(rand() * 9);
    const when = () => {
      const d = new Date(today);
      d.setDate(d.getDate() - week * 7 - ((d.getDay() + 6) % 7) + Math.floor(rand() * 5));
      d.setHours(pick([9, 9, 10, 10, 11, 13, 14, 16, 16, 17]), Math.floor(rand() * 60));
      return d > today ? today.toISOString() : d.toISOString();
    };
    const base = { category: 'prospecting' as const, rawNotes: null, coaching: null };
    for (let n = 0; n < dials; n++) {
      const a = pick(accounts);
      const roll = rand();
      const connected = roll > 0.68;
      const dm = roll > 0.82;
      const relevant = roll > 0.88;
      const asked = roll > 0.91;
      const booked = roll > 0.965;
      sdr.logActivity({ ...base, accountId: a.id, accountName: a.name, channel: 'call', outcome: booked ? 'meeting_booked' : dm ? 'decision_maker' : connected ? 'gatekeeper' : roll > 0.4 ? 'voicemail' : 'no_answer', contactName: dm ? a.contact : null, crmNotes: [dm ? pick(LEARNED) : 'No pickup'], connected, decisionMaker: dm, relevant, meetingAsked: asked, meetingBooked: booked, occurredAt: when() });
    }
    for (let n = 0; n < emails; n++) {
      const a = pick(accounts);
      sdr.logActivity({ ...base, accountId: a.id, accountName: a.name, channel: 'email', outcome: 'email_sent', contactName: a.contact, crmNotes: ['Sent question-first email'], connected: false, decisionMaker: false, relevant: false, meetingAsked: true, meetingBooked: false, occurredAt: when() });
      if (rand() > 0.72) sdr.logActivity({ ...base, accountId: a.id, accountName: a.name, channel: 'email', outcome: 'email_reply', contactName: a.contact, crmNotes: ['Replied, wants more detail'], connected: true, decisionMaker: false, relevant: rand() > 0.4, meetingAsked: false, meetingBooked: rand() > 0.82, occurredAt: when() });
    }
    for (let n = 0; n < 2; n++) {
      const a = pick(accounts);
      sdr.logActivity({ ...base, accountId: a.id, accountName: a.name, channel: rand() > 0.5 ? 'walk_in' : 'linkedin', outcome: 'gatekeeper', contactName: null, crmNotes: ['Dropped by the front desk'], connected: true, decisionMaker: false, relevant: false, meetingAsked: false, meetingBooked: false, occurredAt: when() });
    }
  }

  const task = (i: number, title: string, kind: 'call' | 'meeting' | 'email' | 'task', offset: number, time: string | null) =>
    createTask({ accountId: accounts[i]!.id, title, kind, dueDate: addBusinessDays(todayYmd, Math.max(offset, 0)).replace(/^/, ''), dueTime: time, notes: '' });
  task(0, `Meeting with ${accounts[0]!.contact.split(',')[0]}`, 'meeting', 0, '10:30');
  task(1, 'Send the lease comparison', 'email', 1, null);
  task(2, 'Call back after the partner meeting', 'call', 2, '14:00');
  task(4, 'Drop off the quote summary', 'task', 3, null);
  task(6, `Meeting with ${accounts[6]!.contact.split(',')[0]}`, 'meeting', 4, '09:00');
  const overdue = new Date(today);
  overdue.setDate(overdue.getDate() - 3);
  createTask({ accountId: accounts[3]!.id, title: 'Find the ops director’s direct line', kind: 'task', dueDate: ymd(overdue), dueTime: null, notes: '' });

  accounts.forEach((a, i) => {
    sdr.saveDraft(a.id, 'call_card', callCard(a.name, a.contact), null, 'demo');
    sdr.saveDraft(a.id, 'email', emailDraft(a.name, a.contact), null, 'demo');
    sdr.saveCrmHistory(a.id, `Spoke with the front desk. ${LEARNED[i % LEARNED.length]}`);
  });
  sdr.saveLeadCandidates('demo', [lead('Bluebird Bakery Supply', 'Distribution/Logistics', 'Morgan Hale, General Manager'), lead('Tallgrass Veterinary Group', 'Healthcare/Dental', 'Dr. Ines Vale, Owner')]);
}

function firstName(contact: string): string {
  return contact.split(/[ ,]/)[0] ?? 'there';
}

function callCard(company: string, contact: string): CallCard {
  const [name = '', title = ''] = contact.split(', ');
  const first = firstName(name.replace('Dr. ', ''));
  return {
    preSendCheck: { personCurrent: 'unverified', personEvidence: 'Demo data', signalCurrent: 'unverified', signalEvidence: 'Demo data', angleFit: 'strong', angleReason: 'Demo data' },
    background: [`${company} moved to a bigger office this quarter.`, 'About 40 people at the local site, est.', 'Decisions look local, not corporate.'],
    signalStatus: 'SOFT SIGNAL',
    whyNow: 'They just moved, so the setup they planned for the old office may not fit the new one.',
    priority: 'MEDIUM',
    take: "I'd skip the product talk here. Ask how the move went and let them tell you what broke.",
    target: { name, title, why: 'Runs the day-to-day and would feel any problems first.' },
    routingContact: '',
    reason: 'They moved this quarter and nobody has followed up about the new setup.',
    opening: `${first}, Alex with Demo Office Systems here in Springfield. Reason for my call, I saw you moved this quarter and wanted to ask how the new space is treating your team.`,
    hypothesis: 'The move left their office setup behind their headcount.',
    primaryQuestion: 'What has been harder than expected since the move?',
    followUp: 'Is that something you want fixed, or is it livable for now?',
    branches: [{ ifThey: 'Say everything is fine', say: "Good to hear. Who would handle it if something came up, you or someone else?" }],
    listenFor: ['Printing or network complaints', 'Who owns vendor decisions', 'Contract end dates'],
    angle: 'New space, old setup.',
    meetingBridge: "That's usually the moment it helps to have someone look at it with fresh eyes.",
    meetingAsk: "Let's spend 10 minutes on how it's set up today. If it looks good, we leave it there.",
    voicemail: `${first}, Alex with Demo Office Systems here in Springfield. I saw you moved this quarter and wanted to ask how the new space is working for your team. You can reach me at 555-0100. Again, Alex, 555-0100.`,
    gatekeeper: 'Who looks after the office setup and vendors there?',
    winCondition: 'Learn who owns the decision and book 10 minutes.',
    meetingHypothesis: 'Walk through how the new office runs today and whether anything is worth comparing.',
    ifNoAnswer: 'Leave the voicemail and try a different day next week.',
    sources: [],
  };
}

function emailDraft(company: string, contact: string): EmailDraft {
  const [name = '', title = ''] = contact.split(', ');
  const first = firstName(name.replace('Dr. ', ''));
  return {
    preSendCheck: { personCurrent: 'unverified', personEvidence: 'Demo data', signalCurrent: 'unverified', signalEvidence: 'Demo data', angleFit: 'strong', angleReason: 'Demo data' },
    priority: 'MEDIUM',
    skipReason: '',
    recommendation: 'send',
    recommendationReason: '',
    signalStatus: 'SOFT SIGNAL',
    contact: { name, title, email: '', phone: '' },
    whyAccount: `${company} moved this quarter.`,
    signal: 'Moved to a bigger office this quarter (SOFT)',
    crmHistory: 'NET-NEW',
    hypothesis: 'The setup did not keep up with the move.',
    angle: 'New space, old setup',
    whyPerson: 'Runs the day-to-day at the local site.',
    subject: `${first}, the new office`,
    ctaType: 'meeting',
    body: `Hi ${first},\n\nI saw ${company} moved this quarter. Moves tend to look done on paper while the everyday stuff catches up for months.\n\nI work with local offices on exactly that part. I'm curious what has been harder than expected in the new space.\n\nWould 15 minutes next week be worth it to compare notes?\n\nAlex`,
    meetingHypothesis: 'Compare how the new office runs today against what they expected.',
    crmNotes: [`Emailed ${first} about the move`, 'Awaiting response'],
  };
}

function lead(company: string, industry: string, contact: string): Lead {
  const [name = '', title = ''] = contact.split(', ');
  return {
    company,
    zip: '90002',
    address: '200 Example Blvd',
    domain: `${company.toLowerCase().replace(/[^a-z]+/g, '')}.example`,
    industry,
    employees: 'est. 35',
    revenue: '',
    priority: 'HIGH',
    whyCall: 'Opened a second location this quarter.',
    businessOutcome: 'Get the new site running without pulling staff off their real work.',
    signal: { signal: 'Opened a second location', date: 'This quarter', strength: 'HARD', sourceUrl: '' },
    hypothesis: 'The second site is being run on the first one\'s setup.',
    angle: 'Second site, same headaches',
    primaryContact: { name, title, phone: '', email: '', linkedin: '' },
    secondaryContact: '',
    whyThisPerson: 'Owns the rollout.',
    primaryQuestion: 'What has been hardest about running two sites?',
    meetingHypothesis: 'Compare how both sites run today.',
    sources: [],
  };
}
