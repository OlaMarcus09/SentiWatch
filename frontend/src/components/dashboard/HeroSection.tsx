'use client';

import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

interface HeroSectionProps {
  userName: string;
  riskScore: number;
  trend: number;
}

export default function HeroSection({ userName, riskScore, trend }: HeroSectionProps) {
  const status = riskScore > 75 ? 'Critical' : riskScore > 50 ? 'Elevated' : riskScore > 25 ? 'Watch' : 'Healthy';
  const statusColor = riskScore > 75 ? 'text-red-600' : riskScore > 50 ? 'text-orange-500' : riskScore > 25 ? 'text-yellow-500' : 'text-green-600';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
    >
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-white">
          Good Morning, {userName} 👋
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Here's the current health of your brand reputation.
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
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-green-600 font-medium">+{trend}%</span>
            <span>vs yesterday</span>
          </div>
          <span className="text-xs text-slate-400">24h change</span>
        </div>
      </div>
    </motion.div>
  );
}