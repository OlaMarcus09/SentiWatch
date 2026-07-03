'use client';

import { Suspense, useEffect, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  Zap,
  TrendingUp,
  ArrowUpRight,
  Menu,
  User,
  LogOut,
  Download,
  BarChart3,
  PieChart,
  FileText,
  Flame,
  Shield,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import EntitySelector from '@/components/EntitySelector';
import SentimentChart from '@/components/SentimentChart';
import AddBrandForm from '@/components/AddBrandForm';
import { CATEGORY_COLORS } from '@/lib/constants'; // You'll need to export this

// ───────────────────────────────────────
// 1. Risk Gauge Component (Animated SVG)
// ───────────────────────────────────────
function RiskGauge({ score }: { score: number }) {
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(score, 100);
  const offset = circumference - (progress / 100) * circumference;

  const color =
    progress > 75
      ? '#EF4444'
      : progress > 50
      ? '#F59E0B'
      : progress > 25
      ? '#3B82F6'
      : '#10B981';

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg width={200} height={200} className="transform -rotate-90">
        <circle
          cx="100"
          cy="100"
          r={radius}
          stroke="#E5E7EB"
          strokeWidth="12"
          fill="transparent"
        />
        <circle
          cx="100"
          cy="100"
          r={radius}
          stroke={color}
          strokeWidth="12"
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-5xl font-black text-slate-800 dark:text-white">
          {progress}
        </span>
        <span className="text-sm font-medium text-slate-400">/ 100</span>
      </div>
    </div>
  );
}

// ───────────────────────────────────────
// 2. Category Heatmap Component
// ───────────────────────────────────────
function CategoryHeatmap({ breakdown }: { breakdown: Record<string, number> }) {
  if (!breakdown || Object.keys(breakdown).length === 0) {
    return (
      <div className="text-center text-slate-400 text-sm py-4">
        No category data available yet.
      </div>
    );
  }

  const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="space-y-2">
      {sorted.map(([category, count]) => {
        const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
        const color = CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] || '#6B7280';
        const label = category.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

        return (
          <div key={category} className="flex items-center gap-3">
            <div className="w-24 text-xs font-medium text-slate-600 truncate" title={label}>
              {label}
            </div>
            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${percentage}%`, backgroundColor: color }}
              />
            </div>
            <div className="w-12 text-xs font-mono text-slate-500 text-right">
              {count}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────
// 3. Root Cause Summary Component
// ───────────────────────────────────────
function RootCauseSummary({ summary, causes }: { summary: string; causes: any[] }) {
  if (!summary) {
    return (
      <div className="text-slate-400 text-sm">Analyzing root causes...</div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-700 dark:text-slate-300">{summary}</p>
      {causes && causes.length > 0 && (
        <div className="space-y-1 mt-2">
          {causes.slice(0, 3).map((cause, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-slate-600 dark:text-slate-400">
                {cause.category.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                : {cause.cause}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────
// 4. Structured Recommendation Renderer
// ───────────────────────────────────────
function renderRecommendation(text: string) {
  if (!text) return null;

  const sections = text.split(/\n{2,}/).filter((s) => s.trim());

  return sections.map((section, idx) => {
    const lines = section.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return null;

    const title = lines[0].trim();
    const body = lines.slice(1).join('\n');

    const isNumbered = (line: string) => /^\d+\./.test(line.trim());

    return (
      <div key={idx} className="mb-6 last:mb-0">
        <h4 className="text-blue-400 font-bold text-base mb-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
          {title}
        </h4>
        <div className="text-slate-300 text-sm space-y-2 pl-4">
          {body
            .split('\n')
            .filter((l) => l.trim())
            .map((line, i) => {
              const trimmed = line.trim();
              const isNumberedLine = isNumbered(trimmed);
              const content = isNumberedLine
                ? trimmed.replace(/^\d+\.\s*/, '')
                : trimmed;
              const number = isNumberedLine
                ? trimmed.match(/^\d+\./)?.[0]
                : null;

              return (
                <div key={i} className="flex gap-3 items-start">
                  {isNumberedLine && number && (
                    <span className="text-blue-400 font-mono font-bold min-w-[24px]">
                      {number}
                    </span>
                  )}
                  <span
                    className={`leading-relaxed ${
                      isNumberedLine ? '' : 'pl-4'
                    }`}
                  >
                    {content}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    );
  });
}

// ───────────────────────────────────────
// 5. Main Dashboard Component
// ───────────────────────────────────────
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entityIdParam = searchParams.get('entity_id');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allEntities, setAllEntities] = useState<any[]>([]);
  const [mentions, setMentions] = useState<any[]>([]);
  const [finalRiskScore, setFinalRiskScore] = useState(0);
  const [recommendation, setRecommendation] = useState<any>(null);
  const [riskScoreData, setRiskScoreData] = useState<any>(null);

  useEffect(() => {
    let attempts = 0;
    const MAX_ATTEMPTS = 8;
    let isMounted = true;

    async function loadDashboard() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          if (isMounted) router.push('/login');
          return;
        }

        const userId = session.user.id;

        const { data: entities, error: entitiesError } = await supabase
          .from('monitored_entities')
          .select('*')
          .eq('user_id', userId)
          .order('name');

        if (entitiesError) {
          console.error('Entities error:', entitiesError);
          if (isMounted) setError('Failed to load your brands. Please refresh.');
          return;
        }

        if (!entities || entities.length === 0) {
          if (isMounted) {
            setAllEntities([]);
            setLoading(false);
          }
          return;
        }

        if (isMounted) setAllEntities(entities);

        const currentEntityId = entityIdParam || entities[0].id;

        const { data: fetchedMentions, error: mentionsError } = await supabase
          .from('mentions')
          .select('*')
          .eq('entity_id', currentEntityId)
          .order('created_at', { ascending: false });

        if (mentionsError) {
          console.error('Mentions error:', mentionsError);
          if (
            mentionsError.code === '42501' ||
            mentionsError.message?.includes('403')
          ) {
            if (isMounted)
              setError('Permission denied reading mentions. Check RLS policies.');
            return;
          }
        }

        if (
          !mentionsError &&
          (!fetchedMentions || fetchedMentions.length === 0) &&
          attempts < MAX_ATTEMPTS
        ) {
          attempts++;
          setTimeout(() => {
            if (isMounted) loadDashboard();
          }, 3000);
          return;
        }

        const mentionIds = (fetchedMentions || []).map((m: any) => m.id);

        const { data: sentimentRows } =
          mentionIds.length > 0
            ? await supabase
                .from('sentiment_results')
                .select('mention_id, label, confidence, category, severity, risk_level, root_cause, reason')
                .in('mention_id', mentionIds)
            : { data: [] };

        const sentimentMap = Object.fromEntries(
          (sentimentRows || []).map((s: any) => [s.mention_id, s])
        );

        const mergedMentions = (fetchedMentions || []).map((m: any) => ({
          ...m,
          sentiment_results: sentimentMap[m.id] ? [sentimentMap[m.id]] : [],
        }));

        // Fetch full risk score data (including category breakdown)
        const { data: riskData } = await supabase
          .from('risk_scores')
          .select('*')
          .eq('entity_id', currentEntityId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: recData } = await supabase
          .from('recommendations')
          .select('*')
          .eq('entity_id', currentEntityId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (isMounted) {
          setMentions(mergedMentions);
          setFinalRiskScore(Math.min(riskData?.score || 0, 100));
          setRiskScoreData(riskData);
          setRecommendation(recData);
          setLoading(false);
        }
      } catch (err) {
        console.error('Dashboard load error:', err);
        if (isMounted) setError('Something went wrong. Please refresh.');
      }
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [entityIdParam, router]);

  // ─── Loading ────────────────────────────
  if (loading && !error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 bg-slate-50 dark:bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <div className="text-slate-500 dark:text-slate-400 font-medium text-sm">
          Synchronizing brand data...
        </div>
      </div>
    );
  }

  // ─── Error ──────────────────────────────
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen p-8 bg-slate-50 dark:bg-slate-900">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-2xl p-6 max-w-md text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <p className="text-red-700 dark:text-red-400 font-medium text-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 text-xs text-red-600 dark:text-red-400 underline"
          >
            Refresh page
          </button>
        </div>
      </div>
    );
  }

  // ─── No Entities ────────────────────────
  if (allEntities.length === 0) {
    return (
      <div className="p-8 space-y-6 bg-slate-50 dark:bg-slate-900 min-h-screen">
        <AddBrandForm />
        <div className="p-12 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm">
          Welcome to SentiWatch! Use the form above to activate tracking on
          your first brand.
        </div>
      </div>
    );
  }

  // ─── Sentiment counts ────────────────────
  let positive = 0,
    neutral = 0,
    negative = 0;
  mentions.forEach((m) => {
    const label = m.sentiment_results?.[0]?.label || 'neutral';
    if (label === 'positive') positive++;
    else if (label === 'negative') negative++;
    else neutral++;
  });

  // ─── Category breakdown ──────────────────
  const categoryBreakdown = riskScoreData?.category_breakdown || {};
  const rootCauseSummary = riskScoreData?.root_cause_summary || '';

  // ─── Main Render ────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
      {/* --- Premium Glass Header --- */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-white/20 dark:border-slate-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              SentiWatch
            </h1>
            <span className="text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-3 py-1 rounded-full hidden sm:inline-block">
              Pro Plan
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
              <Menu className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
              <User className="w-4 h-4" />
            </div>
          </div>
        </div>
      </header>

      {/* --- Main Content --- */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Top row: AddBrand + EntitySelector */}
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1">
            <AddBrandForm />
          </div>
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm flex items-end">
            <EntitySelector entities={allEntities} />
          </div>
        </div>

        {/* Executive Summary Row */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Risk Score Card */}
          <div className="lg:col-span-1 bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700 flex flex-col items-center justify-center">
            <RiskGauge score={finalRiskScore} />
            <p className="text-sm font-medium mt-2 text-center">
              {finalRiskScore > 75
                ? '🔴 Critical – Immediate action required'
                : finalRiskScore > 50
                ? '🟠 Elevated – Monitor closely'
                : finalRiskScore > 25
                ? '🟡 Watch – Stay aware'
                : '🟢 Healthy – All clear'}
            </p>
          </div>

          {/* Root Cause Summary Card */}
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-4 h-4 text-orange-500" />
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                Root Cause Analysis
              </h3>
            </div>
            <RootCauseSummary 
              summary={rootCauseSummary} 
              causes={[]} // Will be populated from sentiment results
            />
          </div>

          {/* Quick Stats Card */}
          <div className="lg:col-span-1 bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 dark:text-slate-400">Negative</span>
                <span className="text-sm font-bold text-red-600 dark:text-red-400">{negative}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 dark:text-slate-400">Positive</span>
                <span className="text-sm font-bold text-green-600 dark:text-green-400">{positive}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 dark:text-slate-400">Neutral</span>
                <span className="text-sm font-bold text-slate-600 dark:text-slate-300">{neutral}</span>
              </div>
              <div className="flex justify-between items-center border-t border-gray-100 dark:border-slate-700 pt-2">
                <span className="text-sm text-slate-500 dark:text-slate-400">Total</span>
                <span className="text-sm font-bold text-slate-800 dark:text-white">{mentions.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Grid: Sentiment Chart + Category Heatmap */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="col-span-1 md:col-span-2 bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">
              Sentiment Breakdown
            </h3>
            <SentimentChart
              positive={positive}
              neutral={neutral}
              negative={negative}
            />
          </div>

          <div className="col-span-1 bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-purple-500" />
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                Risk by Category
              </h3>
            </div>
            <CategoryHeatmap breakdown={categoryBreakdown} />
          </div>
        </div>

        {/* Automated Consultant Recommendation */}
        {recommendation && (
          <div className="bg-slate-900 dark:bg-slate-950 rounded-2xl p-6 shadow-lg border border-slate-800 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 opacity-10 rounded-full blur-3xl" />
            <div className="flex items-center gap-3 mb-4 relative z-10">
              <div className="bg-blue-500/20 p-2 rounded-lg border border-blue-500/30">
                <Zap className="w-5 h-5 text-blue-400" />
              </div>
              <h3 className="text-lg font-bold tracking-wide">
                Automated Crisis Consultant
              </h3>
              <span className="ml-auto text-xs bg-red-500/20 text-red-400 px-3 py-1 rounded-full border border-red-500/30">
                Action Required
              </span>
              <button className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg flex items-center gap-1 transition-colors">
                <Download className="w-3 h-3" />
                Export PDF
              </button>
            </div>
            <div className="space-y-3 relative z-10">
              {renderRecommendation(recommendation.action_plan)}
            </div>
          </div>
        )}

        {/* Mentions Feed */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden flex flex-col h-[500px]">
          <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Recent Mentions
            </h3>
            <span className="text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2.5 py-1 rounded-full">
              {mentions.length} events
            </span>
          </div>

          <div className="overflow-y-auto flex-1 p-6">
            <div className="space-y-4">
              {mentions.length === 0 ? (
                <div className="text-center text-slate-400 dark:text-slate-500 py-8">
                  No mentions found for this entity yet.
                </div>
              ) : (
                mentions.map((m) => {
                  const sentiment = m.sentiment_results?.[0]?.label || 'neutral';
                  const category = m.sentiment_results?.[0]?.category || 'general';
                  const severity = m.sentiment_results?.[0]?.severity || 0;
                  const rootCause = m.sentiment_results?.[0]?.root_cause || '';
                  
                  return (
                    <div
                      key={m.id}
                      className="flex gap-4 p-4 rounded-xl border border-gray-100 dark:border-slate-700 hover:border-blue-100 dark:hover:border-blue-800 hover:shadow-sm transition-all bg-white dark:bg-slate-800"
                    >
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center space-x-2 flex-wrap gap-1">
                          <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                            {m.source}
                          </span>
                          <span className="text-gray-300 dark:text-slate-600">•</span>
                          <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center">
                            <Clock className="w-3 h-3 mr-1" />
                            {new Date(m.created_at).toLocaleDateString(
                              undefined,
                              {
                                month: 'short',
                                day: 'numeric',
                              }
                            )}
                          </span>
                          {category && category !== 'general' && (
                            <>
                              <span className="text-gray-300 dark:text-slate-600">•</span>
                              <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                                category.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
                              </span>
                            </>
                          )}
                          {severity > 0 && (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              severity >= 8 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                              severity >= 5 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                              'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            }`}>
                              Severity: {severity}/10
                            </span>
                          )}
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed">
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
                            className="text-xs text-blue-500 hover:underline inline-block pt-1 flex items-center gap-1"
                          >
                            View original trace content
                            <ArrowUpRight className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      <div
                        className={`self-start px-2.5 py-1 rounded-full text-xs font-bold tracking-wide border flex items-center ${
                          sentiment === 'negative'
                            ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800'
                            : sentiment === 'positive'
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800'
                            : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-100 dark:border-slate-600'
                        }`}
                      >
                        {sentiment === 'negative' && (
                          <AlertCircle className="w-3.5 h-3.5 mr-1 text-red-500 dark:text-red-400" />
                        )}
                        {sentiment === 'positive' && (
                          <CheckCircle className="w-3.5 h-3.5 mr-1 text-green-500 dark:text-green-400" />
                        )}
                        {sentiment.toUpperCase()}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}