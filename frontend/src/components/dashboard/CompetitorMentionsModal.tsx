'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- relation rows are not generated yet. */

import { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import MentionFeed from './MentionFeed';
import type { ComparisonFilters } from './CompetitiveIntelligenceDashboard';

interface CompetitorMentionsModalProps {
  competitor: { id: string; name: string };
  onClose: () => void;
  filters?: ComparisonFilters | null;
  title?: string;
}

export default function CompetitorMentionsModal({ competitor, onClose, filters, title }: CompetitorMentionsModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<any[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Close on Escape and move focus into the dialog for keyboard users.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        // Competitors are entities owned by the same user, so RLS lets us read
        // their mentions with the current session — same fetch/merge the
        // dashboard uses for the primary entity.
        let mentionQuery = supabase
          .from('mentions')
          .select('*')
          .eq('entity_id', competitor.id)
          .order('created_at', { ascending: false })
          .limit(500);

        if (filters?.created_at_gte) mentionQuery = mentionQuery.gte('created_at', filters.created_at_gte);
        if (filters?.created_at_lte) mentionQuery = mentionQuery.lte('created_at', filters.created_at_lte);

        const { data: fetchedMentions, error: mentionsError } = await mentionQuery;

        if (mentionsError) throw mentionsError;

        const mentionIds = (fetchedMentions || []).map((m: any) => m.id);
        const { data: sentimentRows } = mentionIds.length > 0
          ? await supabase.from('sentiment_results').select('*').in('mention_id', mentionIds)
          : { data: [] };

        const sentimentMap = Object.fromEntries(
          (sentimentRows || []).map((s: any) => [s.mention_id, s])
        );
        const merged = (fetchedMentions || [])
          .map((m: any) => ({
            ...m,
            sentiment_results: sentimentMap[m.id] ? [sentimentMap[m.id]] : [],
          }))
          .filter((mention: any) => {
            if (filters?.exclude_status && mention.status === filters.exclude_status) return false;
            const source = String(mention.platform || mention.source || '').toLowerCase();
            if (filters?.source && source !== filters.source.toLowerCase()) return false;
            const sentiment = mention.sentiment_results?.[0];
            if (filters?.sentiment && sentiment?.label !== filters.sentiment) return false;
            if (filters?.category && sentiment?.category !== filters.category) return false;
            return true;
          });

        if (isMounted) {
          setMentions(merged);
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load competitor mentions:', err);
        if (isMounted) {
          setError('Could not load mentions for this competitor.');
          setLoading(false);
        }
      }
    }

    load();
    return () => { isMounted = false; };
  }, [competitor.id, filters]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Mentions for ${competitor.name}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title || competitor.name}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Evidence behind this comparison metric</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-blue-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div role="status" className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 aria-hidden="true" className="w-8 h-8 animate-spin text-slate-400" />
              <p className="text-sm text-slate-500 dark:text-slate-400">Loading mentions…</p>
            </div>
          ) : error ? (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400 text-center py-16">{error}</p>
          ) : (
            <MentionFeed mentions={mentions} />
          )}
        </div>
      </div>
    </div>
  );
}
