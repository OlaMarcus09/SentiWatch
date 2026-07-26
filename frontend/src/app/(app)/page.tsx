'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useDashboard } from '@/components/providers/DashboardProvider';
import HeroSection from '@/components/dashboard/HeroSection';
import KPICards from '@/components/dashboard/KPICards';
import RiskGauge from '@/components/dashboard/RiskGauge';
import AIInsights from '@/components/dashboard/AIInsights';
import CreateEntityForm from '@/components/CreateEntityForm';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { Clock, ArrowRight, Shield, Plus, ChevronDown } from 'lucide-react';

interface Rec {
  title: string;
  action_plan: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category?: string;
  effort?: string;
  eta?: string;
  status?: string;
}

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
    eta: score > 75 ? 'Act within 2 hours' : score > 50 ? 'Within 12 hours' : 'Within 24 hours',
    status: 'active',
  }];
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_BADGE: Record<string, 'danger' | 'warning' | 'default' | 'success'> = {
  critical: 'danger', high: 'warning', medium: 'default', low: 'success',
};
const PRIORITY_BORDER: Record<string, string> = {
  critical: 'border-l-red-500', high: 'border-l-orange-500', medium: 'border-l-yellow-500', low: 'border-l-green-500',
};
const PRIORITY_ETA: Record<string, string> = {
  critical: 'Act within 2 hours', high: 'Act within 12 hours', medium: 'Act within 24 hours', low: 'Monitor only',
};

export default function DashboardPage() {
  const {
    displayName,
    currentEntityName,
    finalRiskScore,
    trendDelta,
    mentions,
    negative,
    positive,
    rootCauseSummary,
    recommendation,
    userToken,
  } = useDashboard();

  const [showAddBrand, setShowAddBrand] = useState(false);

  const searchParams = useSearchParams();
  const entityId = searchParams.get('entity_id');
  const recsLink = entityId ? `/recommendations?entity_id=${entityId}` : '/recommendations';

  const actionItems = useMemo(() => {
    const recs = parseRecommendations(recommendation, finalRiskScore)
      .filter((r) => r.status !== 'dismissed')
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return recs.slice(0, 3);
  }, [recommendation, finalRiskScore]);

  return (
    <>
      {/* ── Overview ── */}
      <HeroSection
        userName={displayName}
        riskScore={finalRiskScore}
        trend={trendDelta}
        brandName={currentEntityName}
        actionCount={actionItems.length}
      />

      <KPICards totalMentions={mentions.length} negative={negative} positive={positive} />

      {/* ── Actions Needed ── */}
      {actionItems.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              Actions Needed
            </h3>
            <Link
              href={recsLink}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {actionItems.map((rec, idx) => (
              <Card key={idx} hover={false} className={`p-4 border-l-4 ${PRIORITY_BORDER[rec.priority]}`}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge variant={PRIORITY_BADGE[rec.priority]} size="sm">
                    {rec.priority.toUpperCase()}
                  </Badge>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {rec.eta || PRIORITY_ETA[rec.priority]}
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">{rec.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{rec.action_plan}</p>
                <Link
                  href={recsLink}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 mt-3 hover:underline"
                >
                  View Full Plan <ArrowRight className="w-3 h-3" />
                </Link>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── Risk Intelligence ── */}
      <Card hover={false} className="p-0 overflow-hidden">
        <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/60 flex items-center gap-2">
          <Shield className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Risk Intelligence</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="flex flex-col items-center justify-center py-6 border-b md:border-b-0 md:border-r border-slate-200/60 dark:border-slate-700/60">
            <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
              Live Risk Index
            </h4>
            <RiskGauge score={finalRiskScore} />
          </div>
          <div className="p-6">
            <AIInsights
              rootCauseSummary={rootCauseSummary}
              negativeCount={negative}
              positiveCount={positive}
              totalMentions={mentions.length}
              bare
            />
          </div>
        </div>
      </Card>

      {/* ── Track a New Brand ── */}
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowAddBrand((v) => !v)}
          className="w-full group flex items-center justify-between p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50/50 dark:bg-slate-800/30 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center group-hover:bg-blue-200 dark:group-hover:bg-blue-900/60 transition-colors">
              <Plus className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Track a New Brand</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Add a brand, social handle, and up to 3 competitors</p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showAddBrand ? 'rotate-180' : ''}`} />
        </button>

        {showAddBrand && (
          <div className="mt-4">
            <CreateEntityForm userToken={userToken} />
          </div>
        )}
      </div>
    </>
  );
}
