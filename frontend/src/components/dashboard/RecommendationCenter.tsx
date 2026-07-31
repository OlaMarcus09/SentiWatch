'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import {
  Zap, Clock, Check, Copy, AlertCircle, AlertTriangle, Info, CheckCircle, X,
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
  userToken: string;
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

const PRIORITY_TOOLTIP: Record<Rec['priority'], string> = {
  critical: 'Immediate threat. Respond within 2 hours.',
  high: 'Serious risk. Respond within 12 hours.',
  medium: 'Elevated concern. Respond within 24 hours.',
  low: 'Monitor only. No immediate action needed.',
};

function parseRecommendations(recommendation: any, score: number): Rec[] {
  const raw = recommendation?.action_plan;
  if (!raw) return [];

  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.recommendations)) {
        return parsed.recommendations as Rec[];
      }
    } catch { /* fall through */ }
  }

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

function PriorityBadgeWithTooltip({ priority }: { priority: Rec['priority'] }) {
  const [show, setShow] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      <button
        type="button"
        tabIndex={0}
        aria-label={`${priority} priority: ${PRIORITY_TOOLTIP[priority]}`}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-full"
        onClick={() => setShow((s) => !s)}
      >
        <Badge variant={PRIORITY_BADGE[priority]} size="sm">
          {priority.toUpperCase()}
        </Badge>
      </button>
      {show && (
        <span
          role="tooltip"
          className="absolute left-0 top-full mt-1 z-10 w-56 px-3 py-2 text-xs text-white bg-slate-800 dark:bg-slate-700 rounded-lg shadow-lg pointer-events-none"
        >
          {PRIORITY_TOOLTIP[priority]}
        </span>
      )}
    </span>
  );
}

function ResponseModal({ rec, onClose }: { rec: Rec; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rec.action_plan);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* non-fatal */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Response plan for ${rec.title}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{rec.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={PRIORITY_BADGE[rec.priority]} size="sm">{rec.priority.toUpperCase()}</Badge>
              {rec.eta && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {rec.eta}
                </span>
              )}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Action Plan</h3>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">{rec.action_plan}</p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200/60 dark:border-slate-700/60">
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Response Template Guide</h3>
            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-400">
              <div>
                <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">For X/Twitter (max 280 chars):</p>
                <p className="italic">Acknowledge the issue briefly, state corrective action, and reassure stakeholders. Keep it factual and professional.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">For LinkedIn (longer form):</p>
                <p className="italic">Open with the issue, explain root cause, detail corrective steps, and close with a forward-looking commitment.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <Button size="sm" onClick={handleCopy}>
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy Action Plan</>}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function RecommendationCenter({ recommendation, score, userToken }: RecommendationCenterProps) {
  const initialRecs = useMemo(
    () => parseRecommendations(recommendation, score)
      .filter((r) => r.status !== 'dismissed')
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]),
    [recommendation, score],
  );

  const [recs, setRecs] = useState<Rec[]>(initialRecs);
  const [modalRec, setModalRec] = useState<Rec | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  const persistDismiss = async (dismissedTitle: string) => {
    if (!recommendation?.id || !userToken) throw new Error('Missing recommendation credentials');
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recommendations/${recommendation.id}/dismiss`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: dismissedTitle }),
    });
    if (!response.ok) throw new Error('Dismissal failed');
  };

  const handleDismiss = (idx: number) => {
    const target = recs[idx];
    setRecs((prev) => prev.filter((_, i) => i !== idx));
    setStatusMsg(`Dismissed: ${target.title}`);
    persistDismiss(target.title).catch(() => {
      setRecs((prev) => [...prev, target].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]));
      setStatusMsg(`Could not dismiss ${target.title}. Please try again.`);
    });
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
    <>
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
                    <PriorityBadgeWithTooltip priority={rec.priority} />
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
                      onClick={() => setModalRec(rec)}
                      aria-label={`Generate response for ${rec.title}`}
                    >
                      <Copy className="w-3.5 h-3.5" /> Generate Response
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

      {modalRec && <ResponseModal rec={modalRec} onClose={() => setModalRec(null)} />}
    </>
  );
}
