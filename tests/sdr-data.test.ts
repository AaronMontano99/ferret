import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccountIntel, CallCard, Lead } from '@/ai/sdr/schemas';

// Isolated throwaway DB — see tests/data-accessor.test.ts for why this is a dynamic import.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-sdr-test-'));
process.env.SCOUT_DB_PATH = path.join(tmpDir, 'scout.db');

const data = await import('@/data/accounts');
const sdr = await import('@/data/sdr');
const { buildAccountContext } = await import('@/ai/sdr/engine');
const { extractJson } = await import('@/ai/providers/claude-cli-provider');
const { toJsonSchema, callCardSchema } = await import('@/ai/sdr/schemas');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const intel: AccountIntel = {
  summary: 'Plastics distribution branch on E. Main.',
  localOffice: { address: '550 E. Main Rd', zip: '90021', inTerritory: 'yes', phone: '408-555-0100' },
  parentCompany: 'Summit Holdings',
  headquarters: 'Dallas, TX',
  locations: '11',
  employees: 'est. 25',
  revenue: '',
  signals: [{ signal: 'New GM named for the Springfield site', date: 'Aug 2026', strength: 'HARD', sourceUrl: 'https://example.com' }],
  people: [],
  crmCorrections: [],
  decisionOwnership: 'Centralized',
  sources: [],
};

function card(priority: CallCard['priority']): CallCard {
  return {
    preSendCheck: { personCurrent: 'unverified', personEvidence: 'Demo data', signalCurrent: 'unverified', signalEvidence: 'Demo data', angleFit: 'strong', angleReason: 'Demo data' },
    background: [],
    signalStatus: 'NO RECENT SIGNAL',
    whyNow: '',
    priority,
    take: '',
    target: { name: 'Dana Mahar', title: 'GM', why: '' },
    routingContact: '',
    reason: '',
    opening: '',
    hypothesis: 'Security may be run locally or by corporate.',
    primaryQuestion: '',
    followUp: '',
    branches: [],
    listenFor: [],
    angle: 'Verkada / Brivo',
    meetingBridge: '',
    meetingAsk: '',
    voicemail: '',
    gatekeeper: '',
    winCondition: '',
    meetingHypothesis: '',
    ifNoAnswer: '',
    sources: [],
  };
}

describe('src/data/sdr', () => {
  it('stores intel and syncs the account address/zip/phone', () => {
    const account = data.createAccount({ name: 'Northgate Fabrication' });
    expect(sdr.getIntel(account.id)).toBeNull();
    expect(sdr.isIntelStale(null)).toBe(true);

    sdr.saveIntel(account.id, intel, 'sonnet');
    const stored = sdr.getIntel(account.id);
    expect(stored?.intel.localOffice.zip).toBe('90021');
    expect(sdr.isIntelStale(stored)).toBe(false);
    expect(sdr.isIntelStale(stored, new Date(Date.now() + 15 * 86_400_000))).toBe(true);
    expect(data.getAccount(account.id)).toMatchObject({ zip: '90021', phone: '408-555-0100', address: '550 E. Main Rd' });
  });

  it('keeps the latest draft per kind and applies hand edits', async () => {
    const account = data.createAccount({ name: 'Draft Co' });
    sdr.saveDraft(account.id, 'call_card', card('LOW'), null, 'sonnet');
    await new Promise((r) => setTimeout(r, 5));
    const id = sdr.saveDraft(account.id, 'call_card', card('HIGH'), 'calling SJ office', 'sonnet');
    const latest = sdr.getLatestDraft(account.id, 'call_card');
    expect(latest?.id).toBe(id);
    expect(latest?.data.priority).toBe('HIGH');
    expect(latest?.instruction).toBe('calling SJ office');
  });

  it('logs activity and reads it back by day', () => {
    const account = data.createAccount({ name: 'Activity Co' });
    sdr.logActivity({
      accountId: account.id,
      accountName: account.name,
      channel: 'call',
      category: 'prospecting',
      outcome: 'decision_maker',
      contactName: 'Omar',
      rawNotes: 'raw',
      crmNotes: ['Spoke with Omar', 'Security handled through landlord'],
      coaching: null,
      connected: true,
      decisionMaker: true,
      relevant: false,
      meetingAsked: false,
      meetingBooked: false,
      occurredAt: '2026-09-24T17:00:00.000Z',
    });
    const forAccount = sdr.getActivitiesForAccount(account.id);
    expect(forAccount).toHaveLength(1);
    expect(forAccount[0]!.crmNotes).toEqual(['Spoke with Omar', 'Security handled through landlord']);
    expect(forAccount[0]!.decisionMaker).toBe(true);
    expect(sdr.getActivitiesBetween('2026-09-24T00:00:00.000Z', '2026-09-25T00:00:00.000Z')).toHaveLength(1);
    expect(sdr.getActivitiesBetween('2026-09-25T00:00:00.000Z', '2026-09-26T00:00:00.000Z')).toHaveLength(0);

    sdr.deleteActivity(forAccount[0]!.id);
    expect(sdr.getActivitiesForAccount(account.id)).toHaveLength(0);
  });

  it('builds the call-first list from HIGH/MEDIUM cards only, touched-today last', () => {
    const high = data.createAccount({ name: 'High Co' });
    const medium = data.createAccount({ name: 'Medium Co' });
    const low = data.createAccount({ name: 'Low Co' });
    sdr.saveDraft(high.id, 'call_card', card('HIGH'), null, 'sonnet');
    sdr.saveDraft(medium.id, 'call_card', card('MEDIUM'), null, 'sonnet');
    sdr.saveDraft(low.id, 'call_card', card('LOW'), null, 'sonnet');
    sdr.saveIntel(high.id, intel, 'sonnet');

    const dayStart = new Date(Date.now() - 60_000).toISOString();
    let list = sdr.getCallFirstList(dayStart).filter((r) => ['High Co', 'Medium Co', 'Low Co'].includes(r.company));
    expect(list.map((r) => r.company)).toEqual(['High Co', 'Medium Co']);
    expect(list[0]!.phone).toBe('408-555-0100');
    expect(list[0]!.signal).toBe('New GM named for the Springfield site (Aug 2026)');

    sdr.logActivity({
      accountId: high.id,
      accountName: high.name,
      channel: 'call',
      category: 'prospecting',
      outcome: 'voicemail',
      contactName: null,
      rawNotes: null,
      crmNotes: [],
      coaching: null,
      connected: false,
      decisionMaker: false,
      relevant: false,
      meetingAsked: false,
      meetingBooked: false,
    });
    list = sdr.getCallFirstList(dayStart).filter((r) => ['High Co', 'Medium Co'].includes(r.company));
    expect(list.map((r) => r.company)).toEqual(['Medium Co', 'High Co']);
    expect(list[1]!.touchedToday).toBe(true);
  });

  it('never saves a lead for a company already in Ferret or already suggested', () => {
    data.createAccount({ name: 'Existing Builders Inc' });
    const lead = (company: string): Lead => ({
      company,
      zip: '90012',
      address: '',
      domain: '',
      industry: 'Construction/AEC',
      employees: '40',
      revenue: '',
      priority: 'HIGH',
      whyCall: '',
      businessOutcome: '',
      signal: { signal: 'Hiring IT manager', date: 'Sep 2026', strength: 'HARD', sourceUrl: '' },
      hypothesis: '',
      angle: 'Managed IT',
      primaryContact: { name: '', title: '', phone: '', email: '', linkedin: '' },
      secondaryContact: '',
      whyThisPerson: '',
      primaryQuestion: '',
      meetingHypothesis: '',
      sources: [],
    });

    expect(sdr.saveLeadCandidates('run1', [lead('Existing Builders'), lead('New Law Group LLP'), lead('New Law Group')])).toBe(1);
    expect(sdr.saveLeadCandidates('run2', [lead('New Law Group, LLP')])).toBe(0);
    const [candidate] = sdr.getLeadCandidates('new');
    expect(candidate!.lead.company).toBe('New Law Group LLP');

    sdr.setLeadCandidateStatus(candidate!.id, 'dismissed');
    expect(sdr.getLeadCandidates('new')).toHaveLength(0);
  });

  it('builds prompt context from pasted notes, and says NET-NEW when there are none', () => {
    const account = data.createAccount({ name: 'Acme Test Labs', industry: 'Technology' });
    sdr.saveCrmHistory(account.id, '7/16/2024: Spoke to Carmen > small IT team > Jordan Hale decides');
    const context = buildAccountContext(account.id, null);
    expect(context).toContain('Spoke to Carmen > small IT team');
    expect(context).not.toContain('NET-NEW');

    const fresh = data.createAccount({ name: 'Brand New Co' });
    expect(buildAccountContext(fresh.id, null)).toContain('NET-NEW');
  });

  it('ignores the same notes pasted twice', () => {
    const account = data.createAccount({ name: 'Paste Twice Co' });
    expect(sdr.saveCrmHistory(account.id, 'Rich direct number works.')).toBe(true);
    expect(sdr.saveCrmHistory(account.id, '  Rich direct number works.  ')).toBe(false);
    expect(sdr.saveCrmHistory(account.id, '')).toBe(false);
    expect(sdr.getCrmNotes(account.id)).toHaveLength(1);
  });
});

describe('"I\'m calling X" account matching', () => {
  it('reuses the same company however it is typed', () => {
    const { account, isNew } = data.findOrCreateAccount('Coastline Fabrication, Inc.');
    expect(isNew).toBe(true);
    expect(data.findOrCreateAccount('coastline fabrication').account.id).toBe(account.id);
    expect(data.findOrCreateAccount('The Coastline Fabrication LLC', 'https://www.coastlinefab.com/san-jose').account).toMatchObject({ id: account.id, domain: 'coastlinefab.com' });
    expect(data.findOrCreateAccount('Coastline Fabrication West').isNew).toBe(true);
  });

  it('normalizes names and domains', () => {
    expect(data.normalizeCompanyName('Bayline Supply, Inc.')).toBe('bayline supply');
    expect(data.normalizeCompanyName("Joe's Plumbing & Heating Co.")).toBe('joes plumbing and heating');
    expect(data.normalizeDomain('HTTPS://www.BaylineSupply.com/about')).toBe('baylinesupply.com');
    expect(data.normalizeDomain('not a domain')).toBeNull();
  });
});

describe('Claude CLI helpers', () => {
  it('pulls JSON out of a fenced or chatty answer', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prefix {"b": [1,2]} suffix')).toEqual({ b: [1, 2] });
    expect(extractJson('no json here')).toBeNull();
  });

  it('emits a JSON Schema the CLI accepts (no $schema header)', () => {
    const schema = toJsonSchema(callCardSchema);
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe('object');
  });
});
