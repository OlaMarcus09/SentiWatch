'use client';

import { motion } from 'framer-motion';
import { Sparkles, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';

interface AIInsightsProps {
  rootCauseSummary?: string;
  negativeCount: number;
  positiveCount: number;
  totalMentions: number;
  bare?: boolean;
}

export default function AIInsights({
  rootCauseSummary,
  negativeCount,
  positiveCount,
  totalMentions,
  bare = false,
}: AIInsightsProps) {
  const summary = rootCauseSummary || 'No significant reputation signals detected.';
  const hasNegative = negativeCount > 0;

  const content = (
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-blue-600/10 dark:bg-blue-500/20">
          <Sparkles className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">AI Insights</h3>
            <Badge variant="info" size="sm">Powered by Groq</Badge>
          </div>

          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed"
          >
            {summary}
          </motion.p>

          {totalMentions > 0 && (
            <div className="flex flex-wrap gap-4 pt-2">
              {hasNegative ? (
                <div className="flex items-center gap-2 text-sm">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  <span className="text-slate-600 dark:text-slate-400">
                    <strong className="text-red-600 dark:text-red-400">{negativeCount}</strong> negative mentions detected
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm">
                  <TrendingUp className="w-4 h-4 text-green-500" />
                  <span className="text-slate-600 dark:text-slate-400">
                    Brand sentiment is <strong className="text-green-600 dark:text-green-400">positive</strong>
                  </span>
                </div>
              )}
              {positiveCount > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <TrendingUp className="w-4 h-4 text-green-500" />
                  <span className="text-slate-600 dark:text-slate-400">
                    <strong className="text-green-600 dark:text-green-400">{positiveCount}</strong> positive mentions
                  </span>
                </div>
              )}
            </div>
          )}

          {hasNegative && (
            <div className="mt-2 p-3 rounded-xl bg-red-50/70 dark:bg-red-900/20 border border-red-200/50 dark:border-red-800/30">
              <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
                <AlertCircle className="w-4 h-4" />
                <span>Recommended action: Review negative mentions below and respond within 24 hours.</span>
              </div>
            </div>
          )}
        </div>
      </div>
  );

  if (bare) return content;

  return (
    <Card className="bg-gradient-to-br from-blue-50/80 to-indigo-50/80 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200/40 dark:border-blue-800/30">
      {content}
    </Card>
  );
}