'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { supabase } from '../../lib/supabase';
import {
  Zap, Clock, Check, Copy, AlertCircle, AlertTriangle, Info, CheckCircle,
} from 'lucide-react';

interface Rec {
  title: string;
  action_plan: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category?: string;
  effort?: string;
  eta?: string;
  status?: string;
}

interface RecommendationCenterProps {
  recommendation: any;
  score: number;
}

const PRIORITY_ICON: Record<Rec['priority'], React.ReactNode> = {
  critical: <AlertCircle className="w-4 h-4 text-red-500" />,
  high: <AlertTriangle className="w-4 h-4 text-orange-500" />,
  medium: <Info className="w-4 h-4 text-yellow-500" />,
  low: <CheckCircle className="w-4 h-4 text-green-500" />,
};

const PRIORITY_BADGE: Record<Rec['priority'], 'danger' | 'warning' | 'default' | 'success'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'default',
  low: 'success',
};

const PRIORITY_ORDER: Record<Rec['priority'], number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

/**
 * action_plan is either the new JSON payload {"recommendations":[...]} or a
 * legacy plain-text string. Normalize both into a Rec[].
 */
function parseRecommendations(recommendation: any, score: number): Rec[] {
  const raw = recommendation?.action_plan;
  if (!raw) return [];

  // New shape: JSON string with a recommendations array.
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.recommendations)) {
        return parsed.recommendations as Rec[];
      }
    } catch {
      // fall through to legacy handling
    }
  }

  // Legacy shape: single plain-text playbook. Derive a priority from score.
  const legacyPriority: Rec['priority'] =
    score > 75 ? 'critical' : score > 50 ? 'high' : score > 25 ? 'medium' : 'low';
  return [{
    title: 'Reputation Playbook',
    action_plan: typeof raw === 'string' ? raw : 'Review your reputation data.',
    priority: legacyPriority,
    eta: score > 75 ? 'Immediate' : score > 50 ? 'Within 12 hours' : 'Within 24 hours',
    status: 'active',
  }];
}

export default function RecommendationCenter({ recommendation, score }: RecommendationCenterProps) {
  const initialRecs = useMemo(
    () => parseRecommendations(recommendation, score)
      .filter((r) => r.status !== 'dismissed')
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]),
    [recommendation, score],
  );

  const [recs, setRecs] = useState<Rec[]>(initialRecs);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  // Persist a dismiss by rewriting the row's JSON payload. Best-effort: the UI
  // already hid the item optimistically, so a failed write only affects reload.
  const persistDismiss = async (dismissedTitle: string) => {
    if (!recommendation?.id) return;
    try {
      const remaining = recs
        .filter((r) => r.title !== dismissedTitle)
        .map((r) => ({ ...r, status: r.status ?? 'active' }));
      const dismissed = recs
        .filter((r) => r.title === dismissedTitle)
        .map((r) => ({ ...r, status: 'dismissed' }));
      await supabase
        .from('recommendations')
        .update({ action_plan: JSON.stringify({ recommendations: [...remaining, ...dismissed] }) })
        .eq('id', recommendation.id);
    } catch {
      // non-fatal
    }
  };

  const handleDismiss = (idx: number) => {
    const target = recs[idx];
    setRecs((prev) => prev.filter((_, i) => i !== idx));
    setStatusMsg(`Dismissed: ${target.title}`);
    persistDismiss(target.title);
  };

  const handleGenerate = async (rec: Rec, idx: number) => {
    const draft =
      `Re: ${rec.title}\n\n${rec.action_plan}\n\n— Prepared via SentiWatch`;
    try {
      await navigator.clipboard.writeText(draft);
      setCopiedIdx(idx);
      setStatusMsg(`Response draft for "${rec.title}" copied to clipboard`);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 2000);
    } catch {
      setStatusMsg('Could not access clipboard');
    }
  };

  if (recs.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="p-4 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
            <Zap className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">No recommendations yet</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">
            We'll generate personalized recommendations once we have enough brand mentions.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Recommendation Center</h3>
        </div>
        <Badge variant="info">{recs.length}</Badge>
      </div>

      <p aria-live="polite" className="sr-only">{statusMsg}</p>

      <div className="divide-y divide-slate-200/60 dark:divide-slate-700/60">
        {recs.map((rec, idx) => (
          <motion.div
            key={`${rec.title}-${idx}`}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="p-4"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">{PRIORITY_ICON[rec.priority]}</div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center flex-wrap gap-2">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{rec.title}</p>
                  <Badge variant={PRIORITY_BADGE[rec.priority]} size="sm">
                    {rec.priority.toUpperCase()}
                  </Badge>
                  {rec.eta && (
                    <Badge variant="default" size="sm">
                      <Clock className="w-3 h-3 mr-1" />
                      {rec.eta}
                    </Badge>
                  )}
                  {rec.category && (
                    <span className="text-xs text-slate-400">{rec.category}</span>
                  )}
                </div>

                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                  {rec.action_plan}
                </p>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => handleGenerate(rec, idx)}
                    aria-label={`Generate response for ${rec.title}`}
                  >
                    {copiedIdx === idx
                      ? <><Check className="w-3.5 h-3.5" /> Copied</>
                      : <><Copy className="w-3.5 h-3.5" /> Generate Response</>}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDismiss(idx)}
                    aria-label={`Dismiss ${rec.title}`}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}
