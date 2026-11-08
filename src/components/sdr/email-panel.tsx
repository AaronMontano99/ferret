'use client';

import { PreSendCheck } from './shared';
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { EmailDraft } from '@/ai/sdr/schemas';
import { markEmailSentAction, saveEmailEditsAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { MicroLabel } from '@/components/ui/micro-label';
import { lintEmail } from '@/domain/email-style';
import Link from 'next/link';
import { AiProgress, CopyButton, ErrorNote, Field, PriorityChip, SignalChip, formatAge, useSdrRequest } from './shared';

interface Props {
  accountId: string;
  initialDraft: { id: string; data: EmailDraft; createdAt: string } | null;
  hasFreshIntel: boolean;
  /** True when an email was already logged as sent after this draft was written. */
  initiallySent: boolean;
  /** Set when Aaron just said "I'm emailing X": write it right away with his instruction. */
  autoStart: { instruction: string } | null;
}

export function EmailPanel({ accountId, initialDraft, hasFreshIntel, initiallySent, autoStart }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const started = useRef(false);
  const [draftId, setDraftId] = useState(initialDraft?.id ?? null);
  const [email, setEmail] = useState<EmailDraft | null>(initialDraft?.data ?? null);
  const [createdAt, setCreatedAt] = useState(initialDraft?.createdAt ?? null);
  const [subject, setSubject] = useState(initialDraft?.data.subject ?? '');
  const [body, setBody] = useState(initialDraft?.data.body ?? '');
  const [crmNotes, setCrmNotes] = useState((initialDraft?.data.crmNotes ?? []).join('\n'));
  const [lastInstruction, setLastInstruction] = useState(autoStart?.instruction ?? '');
  const [change, setChange] = useState('');
  const [researching, setResearching] = useState(false);
  const [sent, setSent] = useState(initiallySent);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [saving, startSaving] = useTransition();
  const { run, pending, elapsed, error } = useSdrRequest<{ draftId: string; email?: EmailDraft; data?: EmailDraft }>(`email:${accountId}`);

  const load = (id: string, next: EmailDraft) => {
    setDraftId(id);
    setEmail(next);
    setSubject(next.subject);
    setBody(next.body);
    setCrmNotes(next.crmNotes.join('\n'));
    setCreatedAt(new Date().toISOString());
    setSent(false);
    setConfirmingSend(false);
  };

  const build = async (refreshResearch: boolean, instruction = lastInstruction) => {
    setResearching(refreshResearch || !hasFreshIntel);
    const result = await run({ action: 'email', accountId, instruction: instruction.trim() || undefined, refreshResearch });
    if (result?.email) load(result.draftId, result.email);
  };

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    setLastInstruction(autoStart.instruction);
    router.replace(`${pathname}?a=${accountId}`, { scroll: false });
    void build(false, autoStart.instruction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revise = async () => {
    if (!change.trim()) return;
    setResearching(false);
    if (draftId && email && (subject !== email.subject || body !== email.body)) {
      await saveEmailEditsAction(accountId, draftId, { subject, body });
    }
    const result = await run({ action: 'revise', accountId, kind: 'email', instruction: change.trim() });
    if (result?.data) {
      load(result.draftId, result.data);
      setChange('');
    }
  };

  const markSent = () => {
    if (!draftId) return;
    startSaving(async () => {
      await markEmailSentAction(accountId, draftId, {
        subject,
        body,
        crmNotes: crmNotes
          .split('\n')
          .map((l) => l.replace(/^[-•]\s*/, '').trim())
          .filter(Boolean),
      });
      setSent(true);
      setConfirmingSend(false);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {pending && (
        <AiProgress
          label={researching ? 'Finding real signals for why you\'re reaching out now, then writing…' : 'Writing from your notes and research…'}
          elapsed={elapsed}
        />
      )}
      {!pending && error && <ErrorNote message={error} onRetry={() => build(false)} />}

      {email && !pending && (
        <>
          {email.recommendation === 'call_first' && (
            <div className="rounded-md border border-warn bg-warn-soft px-4 py-3 text-[13px] leading-[1.55] text-ink">
              <span className="font-semibold">Call first, don&apos;t send this yet. </span>
              {email.recommendationReason}{' '}
              <Link href={`/calls?a=${accountId}`} className="text-text-link hover:underline">
                Open the call →
              </Link>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <PriorityChip priority={email.priority} />
            <SignalChip status={email.signalStatus} />
            {email.ctaType === 'question' && (
              <span className="rounded bg-surface-strong px-1.5 py-0.5 text-[12px] text-body">Question first, no meeting ask yet</span>
            )}
            {(email.contact.name || email.contact.title) && (
              <span className="text-[13.5px] text-ink">
                <span className="text-muted">To:</span> <span className="font-medium">{[email.contact.name, email.contact.title].filter(Boolean).join(', ')}</span>
                {email.contact.email && <span className="text-body"> · {email.contact.email}</span>}
              </span>
            )}
          </div>
          {email.priority === 'SKIP' && email.skipReason && (
            <p className="rounded-md bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">Skip: {email.skipReason}</p>
          )}

          <div className="grid gap-x-5 gap-y-3 rounded-md border border-hairline px-4 py-3 sm:grid-cols-2">
            <Field label="Why this account">{email.whyAccount}</Field>
            <Field label="Signal">{email.signal}</Field>
            <Field label="CRM history">{email.crmHistory}</Field>
            <Field label="Hypothesis">{email.hypothesis}</Field>
            <Field label="Angle">{email.angle}</Field>
            <Field label="Why this person">{email.whyPerson}</Field>
          </div>
          <PreSendCheck check={email.preSendCheck} />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <MicroLabel>Subject</MicroLabel>
              <CopyButton text={subject} />
            </div>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="!py-2.5 font-medium" />
            <div className="mt-1 flex items-center justify-between">
              <MicroLabel>
                Email · {body.trim().split(/\s+/).filter(Boolean).length} words
              </MicroLabel>
              <div className="flex gap-3">
                <CopyButton text={body} label="Copy body" />
                <CopyButton text={`Subject: ${subject}\n\n${body}`} label="Copy all" />
              </div>
            </div>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.max(10, body.split('\n').length + 2)} className="!text-[14px] leading-[1.6]" />
            <StyleCheck subject={subject} body={body} ctaType={email.ctaType} warm={!/net-new/i.test(email.crmHistory)} />
          </div>

          <Field label="Meeting to earn (15 min)">{email.meetingHypothesis}</Field>

          {!sent && !confirmingSend && (
            <div className="flex gap-2">
              <Button type="button" onClick={() => setConfirmingSend(true)}>
                I sent it, log it
              </Button>
            </div>
          )}

          {confirmingSend && !sent && (
            <div className="flex flex-col gap-2 rounded-md border border-hairline-strong p-4">
              <MicroLabel>CRM notes to log (one per line, edit if needed)</MicroLabel>
              <Textarea value={crmNotes} onChange={(e) => setCrmNotes(e.target.value)} rows={Math.max(5, crmNotes.split('\n').length + 1)} />
              <div className="flex items-center gap-3">
                <Button type="button" disabled={saving} onClick={markSent} className="disabled:opacity-60">
                  {saving ? 'Logging…' : 'Log as sent'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirmingSend(false)}>
                  Cancel
                </Button>
                <span className="ml-auto">
                  <CopyButton text={crmNotes} label="Copy CRM notes" />
                </span>
              </div>
            </div>
          )}

          {sent && (
            <div className="flex items-center justify-between rounded-md bg-good-soft px-4 py-3 text-[13px] text-good">
              <span>Logged as sent. It counts toward today&apos;s numbers.</span>
              <CopyButton text={crmNotes} label="Copy CRM notes" />
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-hairline pt-4">
            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-[12px] text-body">
                Change something
                <Input
                  value={change}
                  onChange={(e) => setChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && revise()}
                  placeholder="e.g. turn this into 3 paragraphs, make the ask Tuesday or Wednesday"
                  className="!py-2.5"
                />
              </label>
              <Button type="button" variant="secondary" onClick={revise} disabled={!change.trim()} className="!py-2.5 disabled:opacity-50">
                Update
              </Button>
            </div>
            <div className="flex items-center justify-between text-[12px] text-muted">
              <span>{createdAt ? `Written ${formatAge(createdAt)}` : ''}</span>
              <span className="flex gap-4">
                <button type="button" onClick={() => build(false)} className="text-text-link hover:underline">
                  Rewrite
                </button>
                <button type="button" onClick={() => build(true)} className="text-text-link hover:underline">
                  Re-research live
                </button>
              </span>
            </div>
          </div>
        </>
      )}

      {!email && !pending && !error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-hairline-strong px-4 py-3 text-[13px] text-body">
          <span>No email yet.</span>
          <Button type="button" onClick={() => build(false)} className="!px-3.5 !py-1.5 !text-[12.5px]">
            Write email
          </Button>
        </div>
      )}
    </div>
  );
}

/** Live check against Aaron's hard-coded email style (src/domain/email-style.ts), including his own edits. */
function StyleCheck({ subject, body, ctaType, warm }: { subject: string; body: string; ctaType: 'meeting' | 'question'; warm?: boolean }) {
  const issues = lintEmail(subject, body, ctaType, { warm });
  if (issues.length === 0) return <p className="text-[12px] text-good">✓ Passes your style rules</p>;
  return (
    <div className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-ink">
      <span className="font-medium text-accent-warning">Style check: </span>
      {issues.map((i) => i.detail).join(' · ')}
    </div>
  );
}
