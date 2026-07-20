'use client';

import { TrendingUp, ArrowDownRight, ArrowUpRight, BarChart3, Target } from 'lucide-react';
import Card from '../ui/Card';

interface Competitor {
  id: string;
  name: string;
  profile_type: string;
  risk_scores?: Array<{
    score: number;
    negative_mentions: number;
    category_breakdown: Record<string, number>;
    created_at?: string;
  }>;
}

interface CompetitorMatrixProps {
  primaryEntity: {
    id: string;
    name: string;
  };
  primaryRiskScore: number;
  competitors: Competitor[];
}

export default function CompetitorComparisonMatrix({ primaryEntity, primaryRiskScore, competitors }: CompetitorMatrixProps) {
  
  // Quick analyzer to pull out worst-performing categories for competitors
  const getVulnerability = (breakdown: Record<string, number> | undefined) => {
    if (!breakdown || Object.keys(breakdown).length === 0) return 'Stable Operational Baseline';
    const worstCat = Object.keys(breakdown).reduce((a, b) => (breakdown[a] > breakdown[b] ? a : b));
    if (breakdown[worstCat] === 0) return 'Stable Operational Baseline';
    
    const formatting: Record<string, string> = {
      customer_complaint: 'Service Speed/Delays',
      fraud: 'Trust & Security Concerns',
      product_quality: 'Product Defect Overload',
      regulatory: 'Compliance Headwinds',
    };
    return formatting[worstCat] || worstCat.replace('_', ' ');
  };

  return (
    <Card className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
            Competitor Intelligence & Review Matrix
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time vulnerability mapping to capitalize on competitor bad reviews.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-100 dark:border-slate-800">
          <BarChart3 className="w-4 h-4 text-slate-500" />
          <span className="text-2xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            Active Market Intercept Mode
          </span>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-100 dark:border-slate-800/80 rounded-xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/70 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800">
              <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Entity Name</th>
              <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Risk Index</th>
              <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Negative Volume</th>
              <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Primary Operational Flaw</th>
              <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Strategic Recommendation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            
            {/* Primary Brand Context Row */}
            <tr className="bg-slate-50/20 dark:bg-slate-800/10 font-medium">
              <td className="p-4 text-slate-900 dark:text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <span>{primaryEntity.name} <span className="text-2xs text-blue-500 font-normal border border-blue-200 px-1.5 py-0.5 rounded ml-1">You</span></span>
              </td>
              <td className="p-4 text-center">
                <span className={`font-mono text-xs font-bold px-2.5 py-1 rounded-md ${
                  primaryRiskScore >= 60
                    ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400'
                    : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400'
                }`}>
                  {primaryRiskScore}/100
                </span>
              </td>
              <td className="p-4 text-center text-slate-500">—</td>
              <td className="p-4 text-slate-400 italic text-xs">Self Baseline Analysis Active</td>
              <td className="p-4 text-slate-500 text-xs">Defend core operational nodes.</td>
            </tr>

            {/* Competitor Data Extraction Loop */}
            {competitors.map((comp) => {
              // risk_scores comes back unordered; pick the most recent so the
              // matrix reflects the latest analysis rather than an arbitrary row.
              const latestRisk = [...(comp.risk_scores ?? [])].sort(
                (a, b) =>
                  new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
              )[0];
              const score = latestRisk?.score || 0;
              const vulnerability = getVulnerability(latestRisk?.category_breakdown);

              return (
                <tr key={comp.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/5 transition-colors">
                  <td className="p-4 font-medium text-slate-700 dark:text-slate-300">
                    {comp.name}
                  </td>
                  <td className="p-4 text-center">
                    <span className={`font-mono text-xs font-bold px-2.5 py-1 rounded-md ${
                      score >= 60 
                        ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400' 
                        : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400'
                    }`}>
                      {score}/100
                    </span>
                  </td>
                  <td className="p-4 text-center text-slate-600 dark:text-slate-400 font-mono text-xs">
                    {latestRisk?.negative_mentions || 0}
                  </td>
                  <td className="p-4">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                      vulnerability !== 'Stable Operational Baseline'
                        ? 'text-amber-700 bg-amber-50 dark:bg-amber-950/25 dark:text-amber-400'
                        : 'text-slate-500 bg-slate-100 dark:bg-slate-800'
                    }`}>
                      {vulnerability}
                    </span>
                  </td>
                  <td className="p-4 text-xs text-slate-600 dark:text-slate-400 max-w-xs">
                    {vulnerability !== 'Stable Operational Baseline' ? (
                      <div className="flex items-start gap-1">
                        <Target className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                        <span>
                          Deploy ad campaigns targeting <strong>{vulnerability}</strong> parameters. Highlight your superiority here in your copywriting.
                        </span>
                      </div>
                    ) : (
                      'Monitor baseline metrics for competitive deviations.'
                    )}
                  </td>
                </tr>
              );
            })}

          </tbody>
        </table>
      </div>
    </Card>
  );
}