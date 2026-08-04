'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- provider metadata varies by source. */

import { motion } from 'framer-motion';
import { useState } from 'react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import MentionDetailDrawer, { MentionDetail } from './MentionDetailDrawer';
import { sourceLabel } from '@/lib/sourceLabels';
import {
  Globe,
  MessageSquare,
  AlertCircle,
  CheckCircle,
  Clock,
  ArrowUpRight,
  FileSearch,
} from 'lucide-react';

interface MentionFeedProps {
  mentions: any[];
}

// Use simple text badges instead of icon-dependent platform icons
const platformColors: Record<string, string> = {
  'Nigerian News Feed': 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  'Google Maps': 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  'Google Reviews': 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  'Twitter': 'bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400',
  'Facebook': 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  'Instagram': 'bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400',
  'LinkedIn': 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400',
  'Public Forums (X/Reddit)': 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
};

export default function MentionFeed({ mentions }: MentionFeedProps) {
  const [selectedMention, setSelectedMention] = useState<MentionDetail | null>(null);

  if (mentions.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="p-4 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
            <MessageSquare className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">No mentions yet</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            We&apos;ll start tracking mentions as soon as we find them.
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
          <MessageSquare className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Mention Feed</h3>
        </div>
        <Badge>{mentions.length} events</Badge>
      </div>

      <div className="divide-y divide-slate-200/60 dark:divide-slate-700/60 max-h-[500px] overflow-y-auto">
        {mentions.map((m, idx) => {
          const sentiment = m.sentiment_results?.[0]?.label || 'pending';
          const category = m.sentiment_results?.[0]?.category || 'general';
          const severity = m.sentiment_results?.[0]?.severity || 0;
          const rootCause = m.sentiment_results?.[0]?.root_cause || '';
          const source = sourceLabel(m.platform || m.source);

          const sourceColor = platformColors[source] || 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400';

          const sentimentColor =
            sentiment === 'negative'
              ? 'border-l-4 border-l-red-500'
              : sentiment === 'positive'
              ? 'border-l-4 border-l-green-500'
              : sentiment === 'pending'
              ? 'border-l-4 border-l-yellow-400'
              : 'border-l-4 border-l-slate-300 dark:border-l-slate-600';

          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={`p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${sentimentColor}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${sourceColor}`}>
                      <Globe className="w-3.5 h-3.5" />
                      {source}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">•</span>
                    <span className="text-xs text-slate-400 flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      {new Date(m.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">•</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 capitalize bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                      {category.replace(/_/g, ' ')}
                    </span>
                    {severity > 0 && (
                      <>
                        <span className="text-slate-300 dark:text-slate-600">•</span>
                        <span className={`text-xs font-medium ${
                          severity >= 8 ? 'text-red-500' :
                          severity >= 5 ? 'text-orange-500' :
                          'text-green-500'
                        }`}>
                          Severity: {severity}/10
                        </span>
                      </>
                    )}
                  </div>

                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-2">
                    {m.content}
                  </p>

                  {rootCause && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                      🔍 {rootCause}
                    </p>
                  )}

                  {m.url && (
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors"
                    >
                      View source <ArrowUpRight className="w-3 h-3" />
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedMention(m)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    aria-label={`Review evidence for mention from ${source}`}
                  >
                    <FileSearch aria-hidden="true" className="h-3.5 w-3.5" />
                    Review evidence
                  </button>
                </div>

                <div className="flex-shrink-0 self-start">
                  <Badge
                    variant={
                      sentiment === 'negative'
                        ? 'danger'
                        : sentiment === 'positive'
                        ? 'success'
                      : sentiment === 'pending' ? 'warning' : 'default'
                    }
                    className="flex items-center gap-1"
                  >
                    {sentiment === 'negative' && <AlertCircle className="w-3 h-3" />}
                    {sentiment === 'positive' && <CheckCircle className="w-3 h-3" />}
                    {sentiment === 'pending' ? 'ANALYSIS PENDING' : sentiment.toUpperCase()}
                  </Badge>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </Card>
    <MentionDetailDrawer mention={selectedMention} onClose={() => setSelectedMention(null)} />
    </>
  );
}
