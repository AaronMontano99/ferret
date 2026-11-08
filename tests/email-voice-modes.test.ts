import { describe, expect, it } from 'vitest';
import { lintEmail, normalizeEmail } from '@/domain/email-style';

// Made-up accounts only: this repo is public. Aaron's real emails live in private/voice-golden.test.ts.

const COLD = `Hi Dana,

Aaron with HOS here in Springfield. I saw Acme Test Labs is opening a second site on Main St and was curious how you're planning to handle day-to-day IT support once it's up and running. If there's a piece you'd rather hand off, I'd be happy to compare what that could look like.

Thanks,
Aaron`;

describe('cold vs warm email rules', () => {
  it('keeps a one-paragraph cold email that opens with the rep name (was being deleted as a signature)', () => {
    const out = normalizeEmail(COLD, 'Dana', 'Aaron', 'Harbor Office Systems');
    expect(out).toContain('Aaron with HOS here in Springfield. I saw Acme Test Labs');
    expect(out.endsWith('\n\nThanks,\nAaron')).toBe(true);
  });

  it('passes a short cold email with an indirect question', () => {
    expect(lintEmail('IT support at Main St', normalizeEmail(COLD, 'Dana', 'Aaron'), 'question', { warm: false })).toEqual([]);
  });

  it('flags "you mentioned" and exclamations on cold emails only', () => {
    const fake = COLD.replace('Aaron with HOS here in Springfield. I saw', 'You mentioned last month that');
    expect(lintEmail('IT support', fake, 'question', { warm: false }).map((i) => i.rule)).toContain('fake_familiarity');
    const excited = COLD.replace('up and running.', 'up and running!');
    expect(lintEmail('IT support', excited, 'question', { warm: false }).map((i) => i.rule)).toContain('exclamation');
    expect(lintEmail('IT support', excited, 'question', { warm: true }).map((i) => i.rule)).not.toContain('exclamation');
  });

  it('flags unnamed client claims in cold emails, but not partner names', () => {
    const claim = COLD.replace("If there's a piece", 'We partner with Arctic Wolf and work with a few local shops on this. If there\'s a piece');
    expect(lintEmail('IT support', claim, 'question', { warm: false }).map((i) => i.rule)).toContain('unverified_claim');
    const partner = COLD.replace("If there's a piece", 'We partner with Arctic Wolf. If there\'s a piece');
    expect(lintEmail('IT support', partner, 'question', { warm: false }).map((i) => i.rule)).not.toContain('unverified_claim');
  });

  it('caps cold length at 90 words', () => {
    const long = COLD.replace('If there', 'We work with a lot of local companies on exactly this and usually start with the help desk, patching, backups and after-hours alerts, then grow from there depending on what the internal team wants to keep, which most owners appreciate because nothing changes for their people on day one and the budget stays predictable month to month. If there');
    expect(lintEmail('IT support', long, 'question', { warm: false }).map((i) => i.rule)).toContain('too_long');
  });

  it('lets a warm follow-up close with an offer and keep his own words', () => {
    const warm = `Hey Sam - nice meeting you today! I'm just stepping into my office and wanted to follow up on our conversation this morning.

I was wondering if you could forward along my information to whoever handles IT. Also, when it comes to access controls, feel free to reach out anytime.

Thanks, and looking forward to connecting,
Aaron`;
    const out = normalizeEmail(warm, 'Sam', 'Aaron');
    expect(out.startsWith('Hey Sam,\n\nNice meeting you today!')).toBe(true);
    expect(out.endsWith('Thanks, and looking forward to connecting,\nAaron')).toBe(true);
    expect(lintEmail('Following up', out, 'meeting', { warm: true })).toEqual([]);
    expect(lintEmail('Following up', out, 'meeting', { warm: false }).length).toBeGreaterThan(0);
  });
});
