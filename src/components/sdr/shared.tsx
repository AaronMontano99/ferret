'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MicroLabel } from '@/components/ui/micro-label';

/**
 * Shared bits for the Lead SDR panels: the long-running AI request
 * hook (with an elapsed-time counter and pickup of runs already in
 * flight), copy buttons, priority chips, and labeled card fields.
 */

export function useSdrRequest<T>(jobKey: string | null) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - (startedAt.current ?? Date.now())) / 1000)), 1000);
    return () => clearInterval(t);
  }, [pending]);

  // If this page was reopened while a run for this key is still going, show it and refresh when it lands.
  useEffect(() => {
    if (!jobKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (first: boolean) => {
      const res = await fetch(`/api/sdr?key=${encodeURIComponent(jobKey)}`).catch(() => null);
      const job = res?.ok ? ((await res.json()) as { job: { status: string; startedAt: number } | null }).job : null;
      if (cancelled) return;
      if (job?.status === 'running') {
        startedAt.current = job.startedAt;
        setPending(true);
        timer = setTimeout(() => check(false), 3000);
      } else if (!first) {
        setPending(false);
        router.refresh();
      }
    };
    check(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobKey, router]);

  const run = useCallback(
    async (body: Record<string, unknown>): Promise<T | null> => {
      startedAt.current = Date.now();
      setElapsed(0);
      setPending(true);
      setError(null);
      try {
        const res = await fetch('/api/sdr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const json = (await res.json()) as T & { error?: string };
        if (!res.ok || json.error) {
          setError(json.error ?? 'Something went wrong.');
          return null;
        }
        router.refresh();
        return json;
      } catch {
        setError('Lost connection to Ferret. Is the dev server still running?');
        return null;
      } finally {
        setPending(false);
      }
    },
    [router]
  );

  return { run, pending, elapsed, error, setError };
}

export function AiProgress({ label, elapsed }: { label: string; elapsed: number }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-hairline-strong bg-canvas-soft px-4 py-3 text-[13px] text-body">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
      <span>{label}</span>
      <span className="ml-auto font-mono text-[12px] text-muted">{elapsed}s</span>
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-semantic-error/40 bg-semantic-error/10 px-4 py-3 text-[13px] text-ink">
      {message}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 text-text-link hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}

const PRIORITY_CLASS: Record<string, string> = {
  HIGH: 'bg-good-soft text-good',
  MEDIUM: 'bg-info-soft text-info',
  LOW: 'bg-surface-strong text-body',
  SKIP: 'bg-bad-soft text-bad',
};

export function PriorityChip({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${PRIORITY_CLASS[priority] ?? PRIORITY_CLASS.LOW}`}>
      {priority}
    </span>
  );
}

const SIGNAL_CLASS: Record<string, string> = {
  'HARD SIGNAL': 'bg-warn-soft text-warn',
  'SOFT SIGNAL': 'bg-info-soft text-info',
  'NO RECENT SIGNAL': 'bg-surface-strong text-muted',
};

/** HARD / SOFT / NO RECENT SIGNAL — Aaron's honesty label for "why now". */
export function SignalChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[12px] font-semibold ${SIGNAL_CLASS[status] ?? SIGNAL_CLASS['NO RECENT SIGNAL']}`}>
      {status}
    </span>
  );
}

export function StrengthChip({ strength }: { strength: 'HARD' | 'SOFT' }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded px-1.5 py-px text-[12px] font-semibold ${
        strength === 'HARD' ? 'bg-warn-soft text-warn' : 'bg-surface-strong text-muted'
      }`}
    >
      {strength}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="text-[12px] font-medium text-text-link hover:underline"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/** A labeled block on a card. Renders nothing for empty values so cards stay glanceable. */
export function Field({
  label,
  children,
  emphasis = false,
  copy,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
  copy?: string;
}) {
  if (children == null || children === '' || (Array.isArray(children) && children.length === 0)) return null;
  return (
    <div className={emphasis ? 'rounded-md border border-hairline-strong bg-canvas-soft px-4 py-3' : ''}>
      <div className="flex items-center justify-between gap-3">
        <MicroLabel color={emphasis ? 'text-info' : undefined}>{label}</MicroLabel>
        {copy && <CopyButton text={copy} />}
      </div>
      <div className={`mt-1 leading-[1.55] ${emphasis ? 'text-[14.5px] text-ink' : 'text-[13.5px] text-ink'}`}>{children}</div>
    </div>
  );
}

export function SourceLinks({ sources }: { sources: { label: string; url: string }[] }) {
  const real = sources.filter((s) => s.url);
  if (real.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {real.map((s, i) => (
        <a key={`${s.url}-${i}`} href={s.url} target="_blank" rel="noreferrer" className="text-[12px] text-text-link hover:underline">
          {s.label || hostname(s.url)} ↗
        </a>
      ))}
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function formatAge(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

type Check = { personCurrent: string; personEvidence: string; signalCurrent: string; signalEvidence: string; angleFit: string; angleReason: string };

/**
 * The double check before any outreach: right person, still
 * there, signal still true, angle relevant to this person. Older drafts
 * made before the check existed show nothing.
 */
export function PreSendCheck({ check }: { check?: Check | null }) {
  if (!check) return null;
  const tone = (ok: boolean, bad: boolean) => (bad ? 'border-bad bg-bad-soft' : ok ? 'border-good bg-good-soft' : 'border-warn bg-warn-soft');
  const items = [
    { label: 'Still there?', value: check.personCurrent === 'verified' ? 'Verified' : check.personCurrent === 'left' ? 'Left the company' : 'Not confirmed', ok: check.personCurrent === 'verified', bad: check.personCurrent === 'left', why: check.personEvidence },
    { label: 'Signal still true?', value: check.signalCurrent === 'verified' ? 'Verified' : check.signalCurrent === 'stale' ? 'Stale' : 'Not confirmed', ok: check.signalCurrent === 'verified', bad: check.signalCurrent === 'stale', why: check.signalEvidence },
    { label: 'Angle fits them?', value: check.angleFit === 'strong' ? 'Yes' : check.angleFit === 'wrong_person' ? 'Wrong person' : 'Weak', ok: check.angleFit === 'strong', bad: check.angleFit === 'wrong_person', why: check.angleReason },
  ];
  const allGood = items.every((i) => i.ok);
  return (
    <div className="flex flex-col gap-2">
      <MicroLabel>{allGood ? 'Double check · all clear' : 'Double check before you send'}</MicroLabel>
      <div className="grid gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <div key={i.label} className={`rounded-md border px-3 py-2 ${tone(i.ok, i.bad)}`}>
            <div className="text-[12px] text-muted">{i.label}</div>
            <div className="text-[13.5px] font-medium text-ink">{i.value}</div>
            {i.why && <div className="mt-0.5 text-[12px] leading-[1.45] text-body">{i.why}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
