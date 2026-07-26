'use client';

import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

interface HeroSectionProps {
  userName: string;
  riskScore: number;
  trend: number | null;
  brandName?: string;
  actionCount?: number;
}

export default function HeroSection({ userName, riskScore, trend, brandName, actionCount = 0 }: HeroSectionProps) {
  const status = riskScore > 75 ? 'Critical' : riskScore > 50 ? 'Elevated' : riskScore > 25 ? 'Watch' : 'Healthy';
  const statusColor = riskScore > 75 ? 'text-red-600' : riskScore > 50 ? 'text-orange-500' : riskScore > 25 ? 'text-yellow-500' : 'text-green-600';

  const brand = brandName || 'Your brand';
  const subtitle =
    riskScore > 75
      ? `\u26A0\uFE0F ${brand} is under reputational pressure. ${actionCount > 0 ? `${actionCount} action${actionCount > 1 ? 's' : ''} need${actionCount === 1 ? 's' : ''} your attention.` : 'Review the items below.'}`
      : riskScore > 50
      ? `\uD83D\uDD36 ${brand} has elevated risk signals. Review the items below.`
      : riskScore > 25
      ? `\uD83D\uDC40 ${brand} is stable but worth monitoring closely.`
      : `\u2705 ${brand}'s reputation is in good standing.`;
  // A rising risk score is bad, so an increase is shown in red, a decrease in green.
  const hasTrend = trend !== null;
  const trendUp = (trend ?? 0) > 0;
  const trendColor = !hasTrend ? 'text-slate-400' : trendUp ? 'text-red-600' : 'text-green-600';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
    >
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-white">
          Welcome back, {userName || 'there'} 👋
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {subtitle}
        </p>
      </div>
      <div className="flex items-center gap-6 bg-white dark:bg-slate-800/50 px-6 py-3 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-800 dark:text-white">{riskScore}</span>
            <span className="text-sm text-slate-400">/ 100</span>
          </div>
          <span className={`text-sm font-medium ${statusColor}`}>{status}</span>
        </div>
        <div className="h-10 w-px bg-slate-200 dark:bg-slate-700" />
        <div>
          <div className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
            {hasTrend ? (
              <>
                <TrendingUp className={`w-4 h-4 ${trendColor} ${trendUp ? '' : 'rotate-180'}`} />
                <span className={`${trendColor} font-medium`}>
                  {trendUp ? '+' : ''}{trend} pts
                </span>
                <span>vs last check</span>
              </>
            ) : (
              <span className="text-slate-400">No prior data</span>
            )}
          </div>
          <span className="text-xs text-slate-400">Risk score change</span>
        </div>
      </div>
    </motion.div>
  );
}