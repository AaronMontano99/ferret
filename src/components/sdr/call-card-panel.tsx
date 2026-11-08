'use client';

import { PreSendCheck } from './shared';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { CallCard } from '@/ai/sdr/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MicroLabel } from '@/components/ui/micro-label';
import { lintCallCard } from '@/domain/call-style';
import type { RepIdentity } from '@/domain/identity';
import { AiProgress, CopyButton, ErrorNote, Field, PriorityChip, SignalChip, SourceLinks, formatAge, useSdrRequest } from './shared';

interface Props {
  accountId: string;
  initialCard: CallCard | null;
  cardCreatedAt: string | null;
  hasFreshIntel: boolean;
  /** Set when Aaron just said "I'm calling X": build the card right away with his instruction. */
  autoStart: { instruction: string } | null;
  /** Rep identity from Settings, for the rules check. */
  identity: RepIdentity;
}

export function CallCardPanel({ accountId, initialCard, cardCreatedAt, hasFreshIntel, autoStart, identity }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [card, setCard] = useState<CallCard | null>(initialCard);
  const [createdAt, setCreatedAt] = useState(cardCreatedAt);
  const [lastInstruction, setLastInstruction] = useState(autoStart?.instruction ?? '');
  const [change, setChange] = useState('');
  const [researchLabel, setResearchLabel] = useState(false);
  const started = useRef(false);
  const { run, pending, elapsed, error } = useSdrRequest<{ card?: CallCard; data?: CallCard }>(`call_card:${accountId}`);

  const build = async (refreshResearch: boolean, instruction = lastInstruction) => {
    setResearchLabel(refreshResearch || !hasFreshIntel);
    const result = await run({ action: 'call_card', accountId, instruction: instruction.trim() || undefined, refreshResearch });
    if (result?.card) {
      setCard(result.card);
      setCreatedAt(new Date().toISOString());
    }
  };

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    setLastInstruction(autoStart.instruction);
    // Drop ?go=1 so a refresh doesn't rebuild again.
    router.replace(`${pathname}?a=${accountId}`, { scroll: false });
    void build(false, autoStart.instruction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revise = async () => {
    if (!change.trim()) return;
    setResearchLabel(false);
    const result = await run({ action: 'revise', accountId, kind: 'call_card', instruction: change.trim() });
    if (result?.data) {
      setCard(result.data);
      setCreatedAt(new Date().toISOString());
      setChange('');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {pending && (
        <AiProgress
          label={researchLabel ? 'Researching live: local office, who decides, hiring, new leaders, recent changes…' : 'Building the card from your notes and research…'}
          elapsed={elapsed}
        />
      )}
      {!pending && error && <ErrorNote message={error} onRetry={() => build(false)} />}

      {card && !pending && <CardView card={card} identity={identity} />}

      {card && !pending && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[12px] text-body">
              Change something
              <Input
                value={change}
                onChange={(e) => setChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && revise()}
                placeholder="e.g. lead with Managed IT instead, shorter opening"
                className="!py-2.5"
              />
            </label>
            <Button type="button" variant="secondary" onClick={revise} disabled={!change.trim()} className="!py-2.5 disabled:opacity-50">
              Update
            </Button>
          </div>
          <div className="flex items-center justify-between text-[12px] text-muted">
            <span>{createdAt ? `Built ${formatAge(createdAt)}` : ''}</span>
            <span className="flex gap-4">
              <button type="button" onClick={() => build(false)} className="text-text-link hover:underline">
                Rebuild
              </button>
              <button type="button" onClick={() => build(true)} className="text-text-link hover:underline">
                Re-research live
              </button>
            </span>
          </div>
        </div>
      )}

      {!card && !pending && !error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-hairline-strong px-4 py-3 text-[13px] text-body">
          <span>No call card yet.</span>
          <Button type="button" onClick={() => build(false)} className="!px-3.5 !py-1.5 !text-[12.5px]">
            Build call card
          </Button>
        </div>
      )}
    </div>
  );
}

function CardView({ card, identity }: { card: CallCard; identity: RepIdentity }) {
  const target = [card.target.name, card.target.title].filter(Boolean).join(', ');
  return (
    <div className="flex flex-col gap-4">
      {(card.background.length > 0 || card.whyNow) && (
        <div className="rounded-md border border-hairline-strong bg-canvas-soft px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <MicroLabel>Background</MicroLabel>
            <SignalChip status={card.signalStatus} />
          </div>
          {card.background.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {card.background.map((b, i) => (
                <li key={i} className="text-[13px] leading-[1.5] text-ink">
                  · {b}
                </li>
              ))}
            </ul>
          )}
          {card.whyNow && (
            <p className="mt-2 text-[13px] leading-[1.5] text-ink">
              <span className="font-medium">Why now: </span>
              {card.whyNow}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <PriorityChip priority={card.priority} />
        {target && (
          <span className="text-[13.5px] text-ink">
            <span className="text-muted">Target:</span> <span className="font-medium">{target}</span>
          </span>
        )}
      </div>
      {card.take && <p className="max-w-[760px] text-[14px] leading-[1.6] text-body">{card.take}</p>}
      {card.target.why && <p className="-mt-2 text-[12.5px] text-muted">Why this person: {card.target.why}</p>}
      <PreSendCheck check={card.preSendCheck} />

      <Field label="Opening" emphasis copy={card.opening}>
        {card.opening}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reason">{card.reason}</Field>
        <Field label="Hypothesis">{card.hypothesis}</Field>
      </div>

      <Field label="Primary question" emphasis copy={card.primaryQuestion}>
        {card.primaryQuestion}
      </Field>

      <Field label="Follow-up (only if useful)">{card.followUp}</Field>

      {card.branches.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {card.branches.map((b, i) => (
            <div key={i} className="rounded-md border border-hairline-strong px-3.5 py-2.5">
              <MicroLabel>If they {b.ifThey.replace(/^if (they )?/i, '')}</MicroLabel>
              <p className="mt-1 text-[13.5px] leading-[1.5] text-ink">{b.say}</p>
            </div>
          ))}
        </div>
      )}

      {card.listenFor.length > 0 && (
        <div>
          <MicroLabel>Listen for</MicroLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {card.listenFor.map((l) => (
              <span key={l} className="rounded-full bg-surface-strong px-2.5 py-1 text-[12px] text-ink">
                {l}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Angle">{card.angle}</Field>
        <Field label="Meeting bridge">{card.meetingBridge}</Field>
      </div>

      <Field label="Meeting ask" emphasis copy={card.meetingAsk}>
        {card.meetingAsk}
      </Field>

      <Field label="Win condition">{card.winCondition}</Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="If a gatekeeper answers">{card.gatekeeper}</Field>
        <Field label="Routing contact">{card.routingContact}</Field>
      </div>

      {card.voicemail && (
        <div className="rounded-md border border-hairline-strong px-4 py-3">
          <div className="flex items-center justify-between">
            <MicroLabel>Voicemail (20 to 40 sec)</MicroLabel>
            <CopyButton text={card.voicemail} />
          </div>
          <p className="mt-1 text-[13.5px] leading-[1.55] text-ink">{card.voicemail}</p>
        </div>
      )}

      <Field label="If nobody picks up">{card.ifNoAnswer}</Field>
      <Field label="Meeting to earn (10 min)">{card.meetingHypothesis}</Field>
      <SourceLinks sources={card.sources} />
      <RulesCheck card={card} identity={identity} />
    </div>
  );
}

/** Checks the card against the hard-coded call rules (src/domain/call-style.ts). */
function RulesCheck({ card, identity }: { card: CallCard; identity: RepIdentity }) {
  const issues = lintCallCard(card, identity);
  if (issues.length === 0) return <p className="text-[12px] text-good">✓ Passes your call rules</p>;
  return (
    <div className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-ink">
      <span className="font-medium text-accent-warning">Rules check: </span>
      {issues.map((i) => i.detail).join(' · ')}
    </div>
  );
}
