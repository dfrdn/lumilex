'use client';

import Link from 'next/link';
import { ScanSearch, Sparkles, Swords, X } from 'lucide-react';
import DeliverableActionButtons, { type DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import { isRedTeamable } from '@/lib/legal/pleading-subtypes';
import { useFeature, useFeatures } from '@/components/FeatureProvider';
import { BTN_OUTLINE } from '@/components/ui/tone';
import { useDeliverable } from './DeliverableShellProvider';
import { usePageVisits } from '@/hooks/use-page-visits';
import { NAV_AREAS } from '@/lib/nav/pages';
import { featuresVisible } from '@/lib/firm/feature-shape';

interface Props {
  currentUserId: string;
}

export default function DeliverableActionRow({ currentUserId }: Props) {
  const { item, applyAction } = useDeliverable();
  const redTeamEnabled = useFeature('red_team');

  // Subtype is the primary signal; fall back to the name for untagged/legacy rows.
  const isJudicialAffidavit =
    /judicial affidavit/i.test(item.subtype ?? '') || /judicial affidavit/i.test(item.name);
  // The deep link lands on /dashboard/red-team, which redirects away without
  // the feature — so a firm that doesn't have it gets no button, not a dead one.
  const redTeamable =
    redTeamEnabled && !isJudicialAffidavit && isRedTeamable(item.subtype, item.name, item.type);
  const showActions = !!currentUserId && item.currentlyWith.includes(currentUserId);

  // A tool offered here that this browser has never opened gets a line saying
  // what it does, until it is opened or the line is closed.
  const visits = usePageVisits();
  const flags = useFeatures();
  const offered = [
    isJudicialAffidavit && '/dashboard/affidavit-review',
    redTeamable && '/dashboard/red-team',
  ].filter((href): href is string => !!href);
  const hints = NAV_AREAS.dashboard.pages.filter(
    (p) => offered.includes(p.href) && featuresVisible(flags, p.features) && visits.showHint(p.href),
  );

  if (!isJudicialAffidavit && !redTeamable && !showActions) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {showActions && (
          <DeliverableActionButtons
            deliverableId={item.id}
            deliverableName={item.name}
            status={item.status}
            type={item.type}
            matterId={item.matterId}
            matterName={item.matter}
            drafterIds={item.drafter}
            reviewerIds={item.reviewerIds}
            currentlyWithIds={item.currentlyWith}
            variant="full"
            onActionComplete={(patch: DeliverableActionPatch) => {
              applyAction({
                ...(patch.status !== undefined ? { status: patch.status } : {}),
                ...(patch.currentlyWithIds !== undefined ? { currentlyWith: patch.currentlyWithIds } : {}),
                ...(patch.dateDone !== undefined ? { dateDone: patch.dateDone } : {}),
              });
            }}
          />
        )}
        {isJudicialAffidavit && (
          <Link
            href={`/dashboard/affidavit-review?deliverableId=${item.id}&mode=self`}
            className={`${BTN_OUTLINE} px-3 py-1.5`}
          >
            <ScanSearch className="w-3.5 h-3.5" />
            Review for objections
          </Link>
        )}
        {redTeamable && (
          <Link
            href={`/dashboard/red-team?deliverableId=${item.id}&mode=self`}
            className={`${BTN_OUTLINE} px-3 py-1.5`}
          >
            <Swords className="w-3.5 h-3.5" />
            Red team this draft
          </Link>
        )}
      </div>
      {hints.map((page) => (
        <div
          key={page.href}
          className="flex items-start gap-2 px-3 py-2 rounded-lg bg-gold-50/70 dark:bg-gold-400/10 ring-1 ring-inset ring-gold-200/70 dark:ring-gold-400/20 text-[13px] text-[var(--text-secondary)]"
        >
          <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gold-600 dark:text-gold-400" />
          <p className="flex-1">
            <span className="font-semibold text-gold-700 dark:text-gold-300">New to you: {page.label}.</span>{' '}
            {page.description}
          </p>
          <button
            type="button"
            onClick={() => visits.dismissHint(page.href)}
            aria-label={`Hide the ${page.label} tip`}
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--subtle-bg)] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
