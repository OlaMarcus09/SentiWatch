'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  FileSearch,
  Gauge,
  Globe,
  MessageSquareText,
  ShieldAlert,
  Tag,
  UserRound,
  X,
} from 'lucide-react';
import Badge from '../ui/Badge';

interface SentimentResult {
  label?: string | null;
  confidence?: number | null;
  severity?: number | null;
  risk_level?: string | null;
  category?: string | null;
  sub_category?: string | null;
  reason?: string | null;
  root_cause?: string | null;
}

export interface MentionDetail {
  id: string;
  content?: string | null;
  source?: string | null;
  platform?: string | null;
  url?: string | null;
  created_at?: string | null;
  published_at?: string | null;
  author_name?: string | null;
  author_handle?: string | null;
  engagement?: Record<string, unknown> | null;
  sentiment_results?: SentimentResult[] | null;
}

interface MentionDetailDrawerProps {
  mention: MentionDetail | null;
  onClose: () => void;
}

function readable(value: string | null | undefined, fallback = 'Not available') {
  return value?.trim() || fallback;
}

function titleCase(value: string | null | undefined, fallback = 'Not classified') {
  if (!value) return fallback;
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Publication time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Publication time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatMetric(value: unknown) {
  if (typeof value === 'number') return new Intl.NumberFormat().format(value);
  if (typeof value === 'string') return value;
  return null;
}

export default function MentionDetailDrawer({ mention, onClose }: MentionDetailDrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const sentiment = mention?.sentiment_results?.[0];
  const label = sentiment?.label || 'pending';
  const engagement = useMemo(
    () => Object.entries(mention?.engagement || {})
      .map(([key, value]) => ({ key, value: formatMetric(value) }))
      .filter((entry): entry is { key: string; value: string } => entry.value !== null),
    [mention?.engagement]
  );

  useEffect(() => {
    if (!mention) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [mention, onClose]);

  if (!mention || typeof document === 'undefined') return null;

  const badgeVariant = label === 'negative'
    ? 'danger'
    : label === 'positive'
      ? 'success'
      : label === 'pending'
        ? 'warning'
        : 'default';

  const confidence = typeof sentiment?.confidence === 'number'
    ? `${Math.round(sentiment.confidence * 100)}%`
    : 'Pending';
  const author = mention.author_name || mention.author_handle;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex justify-end bg-slate-950/55 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex h-full w-full flex-col bg-white shadow-2xl dark:bg-slate-950 sm:max-w-xl sm:border-l sm:border-slate-200 dark:sm:border-slate-800"
      >
        <header className="safe-top flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={badgeVariant}>
                {label === 'pending' ? 'Analysis pending' : label}
              </Badge>
              {sentiment?.risk_level && (
                <Badge variant={sentiment.risk_level === 'critical' || sentiment.risk_level === 'high' ? 'danger' : 'default'}>
                  {sentiment.risk_level} risk
                </Badge>
              )}
            </div>
            <h2 id={titleId} className="text-lg font-semibold text-slate-950 dark:text-white">
              Mention evidence
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Review the source evidence and the reasoning behind this classification.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close mention details"
            className="shrink-0 rounded-xl p-2.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          <div className="space-y-6">
            <section aria-labelledby={`${titleId}-evidence`}>
              <div className="mb-3 flex items-center gap-2">
                <MessageSquareText aria-hidden="true" className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h3 id={`${titleId}-evidence`} className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Source evidence
                </h3>
              </div>
              <blockquote className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 sm:p-5">
                {readable(mention.content, 'No evidence text was captured for this mention.')}
              </blockquote>
            </section>

            <section aria-labelledby={`${titleId}-origin`} className="grid gap-3 sm:grid-cols-2">
              <h3 id={`${titleId}-origin`} className="sr-only">Mention origin</h3>
              <DetailItem icon={Globe} label="Source" value={readable(mention.source || mention.platform)} />
              <DetailItem icon={CalendarClock} label="Published" value={formatDate(mention.published_at || mention.created_at)} />
              <DetailItem
                icon={UserRound}
                label="Author"
                value={author ? `${mention.author_name || mention.author_handle}${mention.author_handle && mention.author_name ? ` (${mention.author_handle})` : ''}` : 'Author unavailable'}
              />
              <DetailItem icon={Activity} label="Engagement" value={engagement.length ? engagement.map(({ key, value }) => `${titleCase(key)}: ${value}`).join(' · ') : 'No engagement data'} />
            </section>

            <section aria-labelledby={`${titleId}-analysis`}>
              <div className="mb-3 flex items-center gap-2">
                <FileSearch aria-hidden="true" className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h3 id={`${titleId}-analysis`} className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Analysis details
                </h3>
              </div>

              {label === 'pending' ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">This mention has not been classified yet.</p>
                  <p className="mt-1 text-sm leading-6 text-amber-800/80 dark:text-amber-300/80">
                    It is excluded from neutral sentiment and reputation conclusions until analysis completes.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailItem icon={Gauge} label="Confidence" value={confidence} />
                  <DetailItem icon={ShieldAlert} label="Severity" value={typeof sentiment?.severity === 'number' ? `${sentiment.severity}/10` : 'Not scored'} />
                  <DetailItem icon={Tag} label="Category" value={titleCase(sentiment?.category)} />
                  <DetailItem icon={Tag} label="Subcategory" value={titleCase(sentiment?.sub_category)} />
                </div>
              )}
            </section>

            {label !== 'pending' && (sentiment?.root_cause || sentiment?.reason) && (
              <section aria-labelledby={`${titleId}-reasoning`} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 sm:p-5">
                <h3 id={`${titleId}-reasoning`} className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Classification reasoning
                </h3>
                {sentiment.root_cause && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Root cause</p>
                    <p className="mt-1 text-sm font-medium leading-6 text-slate-900 dark:text-white">{sentiment.root_cause}</p>
                  </div>
                )}
                {sentiment.reason && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Why it was classified this way</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">{sentiment.reason}</p>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        <footer className="safe-bottom border-t border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
          {mention.url ? (
            <a
              href={mention.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 sm:w-auto"
            >
              Open original source
              <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
            </a>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">No original source link was captured.</p>
          )}
        </footer>
      </div>
    </div>,
    document.body
  );
}

function DetailItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Globe;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Icon aria-hidden="true" className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 break-words text-sm font-medium leading-5 text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}
