'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startOutreachAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';

type Kind = 'call' | 'email';

const COPY: Record<Kind, { verb: string; companyPlaceholder: string; extraPlaceholder: string; cta: string; path: string }> = {
  call: {
    verb: "I'm calling",
    companyPlaceholder: 'Company, e.g. Northgate Fabrication',
    extraPlaceholder: 'Anything else? e.g. calling the SJ office, not the old contact, won’t mention him',
    cta: 'Get call intel',
    path: '/calls',
  },
  email: {
    verb: "I'm emailing",
    companyPlaceholder: 'Company, e.g. Acme Test Labs',
    extraPlaceholder: 'Anything else? e.g. email Jordan, reopen the IT thread the front desk mentioned',
    cta: 'Find why now + write it',
    path: '/emails',
  },
};

/**
 * The whole front door: who you're reaching out to, your notes if you
 * have any, anything else. Ferret remembers the company and your notes
 * behind the scenes; you never manage records.
 */
export function OutreachComposer({ kind, compact = false }: { kind: Kind; compact?: boolean }) {
  const router = useRouter();
  const copy = COPY[kind];
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  const [notes, setNotes] = useState('');
  const [extra, setExtra] = useState('');
  const [showWebsite, setShowWebsite] = useState(false);
  const [expanded, setExpanded] = useState(!compact);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const go = () => {
    if (!company.trim()) {
      setError('Who are you reaching out to?');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await startOutreachAction({ company, website, notes });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      const params = new URLSearchParams({ a: result.accountId, go: '1' });
      if (extra.trim()) params.set('i', extra.trim());
      setCompany('');
      setWebsite('');
      setNotes('');
      setExtra('');
      setExpanded(!compact);
      router.push(`${copy.path}?${params.toString()}`);
    });
  };

  return (
    <div className="glass p-5 ">
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
        <span className="shrink-0 text-[17px] font-semibold tracking-[-0.01em] text-ink">{copy.verb}</span>
        <Input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={(e) => e.key === 'Enter' && !pending && go()}
          placeholder={copy.companyPlaceholder}
          className="!py-2.5 !text-[15px]"
          autoFocus={!compact}
        />
        <Button type="button" disabled={pending} onClick={go} className="shrink-0 !py-2.5 disabled:opacity-60">
          {pending ? 'Starting…' : copy.cta}
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2.5">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder={'Paste your CRM notes if you have any (dates and all). Leave empty for a net-new account.'}
            className="!text-[13px]"
          />
          <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={copy.extraPlaceholder} className="!py-2.5 !text-[13px]" />
          {showWebsite ? (
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website (helps if the name is common), e.g. portplastics.com" className="!py-2.5 !text-[13px]" />
          ) : (
            <button type="button" onClick={() => setShowWebsite(true)} className="self-start text-[12px] text-text-link hover:underline">
              + Add website (if the name is common)
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-[12.5px] text-bad">{error}</p>}
    </div>
  );
}
