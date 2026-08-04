'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Minus,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Card from '../ui/Card';

export interface ComparisonFilters {
  entity_id: string;
  created_at_gte: string;
  created_at_lte: string;
  exclude_status?: string;
  sentiment?: string;
  source?: string;
  category?: string;
}

interface EvidenceSummary {
  status: 'verified' | 'partial' | 'no_evidence';
  coverage_pct: number;
  counts: {
    collected: number;
    usable: number;
    analyzed: number;
    pending: number;
    rejected: number;
  };
}

export interface CompetitiveEntity {
  id: string;
  name: string;
  is_primary: boolean;
  evidence_status: 'verified' | 'partial' | 'no_evidence';
  coverage_pct: number;
  counts: {
    mentions: number;
    analyzed: number;
    pending: number;
    positive: number;
    neutral: number;
    negative: number;
  };
  shares: {
    voice: number;
    positive: number;
    negative: number;
  };
  latest_risk: { score: number; status: string; created_at: string } | null;
  risk_delta: number | null;
  source_distribution: Array<{
    source: string;
    count: number;
    share: number;
    filters: ComparisonFilters;
  }>;
  top_categories: Array<{
    category: string;
    count: number;
    share: number;
    filters: ComparisonFilters;
  }>;
  trend: Array<{
    date: string;
    mentions: number;
    positive: number;
    neutral: number;
    negative: number;
    risk_score: number | null;
  }>;
  filters: {
    voice: ComparisonFilters;
    positive: ComparisonFilters;
    neutral: ComparisonFilters;
    negative: ComparisonFilters;
  };
}

export interface CompetitiveIntelligenceResponse {
  window_days: number;
  from: string;
  to: string;
  total_mentions: number;
  entities: CompetitiveEntity[];
  truncated?: { mentions: boolean; risk_snapshots: boolean };
}

interface Props {
  data: CompetitiveIntelligenceResponse;
  onInspect: (entity: CompetitiveEntity, filters: ComparisonFilters, title: string) => void;
}

const COLORS = ['#2563eb', '#f97316', '#8b5cf6', '#14b8a6'];

function label(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function EvidenceBadge({ evidence }: { evidence: EvidenceSummary }) {
  const config = evidence.status === 'verified'
    ? { icon: CheckCircle2, text: 'Verified evidence', className: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900' }
    : evidence.status === 'partial'
      ? { icon: AlertTriangle, text: `${evidence.coverage_pct}% analyzed`, className: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900' }
      : { icon: AlertTriangle, text: 'No evidence', className: 'text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-900 dark:border-slate-700' };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${config.className}`}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {config.text}
    </span>
  );
}

function Trend({ entity }: { entity: CompetitiveEntity }) {
  const delta = entity.risk_delta;
  if (delta === null) return <span className="text-xs text-slate-400">No trend yet</span>;
  const direction = delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const riskImproved = direction === 'down';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
      direction === 'flat' ? 'text-slate-500' : riskImproved ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
    }`}>
      <Icon aria-hidden="true" className="h-4 w-4" />
      {Math.abs(delta)} pts {riskImproved ? 'lower' : direction === 'up' ? 'higher' : 'unchanged'}
    </span>
  );
}

export default function CompetitiveIntelligenceDashboard({ data, onInspect }: Props) {
  const [trendMetric, setTrendMetric] = useState<'mentions' | 'negative'>('mentions');
  const overallEvidence = data.entities.every((entity) => entity.evidence_status === 'no_evidence')
    ? 'no_evidence'
    : data.entities.every((entity) => entity.evidence_status === 'verified')
      ? 'verified'
      : 'partial';
  const chartData = useMemo(() => {
    const dates = new Set<string>();
    data.entities.forEach((entity) => entity.trend.forEach((point) => dates.add(point.date)));
    return [...dates].sort().map((date) => {
      const row: Record<string, string | number> = { date };
      data.entities.forEach((entity) => {
        const point = entity.trend.find((item) => item.date === date);
        row[entity.id] = point?.[trendMetric] ?? 0;
      });
      return row;
    });
  }, [data.entities, trendMetric]);

  return (
    <div className="space-y-6">
      {(data.truncated?.mentions || data.truncated?.risk_snapshots) && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This comparison reached the safe evidence limit. Shares and trends use the newest available records in this window and should be treated as partial.
          </p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={BarChart3} label="Market mentions" value={data.total_mentions} detail={`${data.window_days}-day evidence window`} />
        <SummaryCard icon={TrendingUp} label="Positive signals" value={data.entities.reduce((sum, entity) => sum + entity.counts.positive, 0)} detail="Across all tracked brands" tone="positive" />
        <SummaryCard icon={AlertTriangle} label="Negative signals" value={data.entities.reduce((sum, entity) => sum + entity.counts.negative, 0)} detail="Click a metric to inspect evidence" tone="negative" />
        <SummaryCard
          icon={ShieldCheck}
          label="Comparison confidence"
          value={overallEvidence === 'verified' ? 'Verified' : overallEvidence === 'partial' ? 'Partial' : 'No data'}
          detail={overallEvidence === 'partial' ? 'Coverage varies across tracked brands' : 'Based on analyzed evidence'}
        />
      </div>

      <Card hover={false} className="p-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">Share of voice</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Share of collected market conversation. Pending analysis remains in volume, but never counts as neutral sentiment.
            </p>
          </div>
          <p className="text-xs text-slate-400">{formatDate(data.from)} – {formatDate(data.to)}</p>
        </div>

        <div className="grid divide-y divide-slate-200 dark:divide-slate-700 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="space-y-5 p-5 sm:p-6">
            {data.entities.map((entity, index) => (
              <button
                type="button"
                key={entity.id}
                onClick={() => onInspect(entity, entity.filters.voice, `${entity.name} mentions`)}
                className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{entity.name}</span>
                    {entity.is_primary && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">You</span>}
                  </div>
                  <span className="font-mono text-sm font-bold text-slate-950 dark:text-white">{entity.shares.voice}%</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div className="h-full rounded-full transition-all" style={{ width: `${entity.shares.voice}%`, backgroundColor: COLORS[index % COLORS.length] }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{entity.counts.mentions} mentions</span>
                  <span className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400">View evidence <ExternalLink className="h-3 w-3" /></span>
                </div>
              </button>
            ))}
          </div>

          <div className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Conversation trend</h3>
              <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
                {(['mentions', 'negative'] as const).map((metric) => (
                  <button
                    type="button"
                    key={metric}
                    onClick={() => setTrendMetric(metric)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${trendMetric === metric ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500'}`}
                  >
                    {metric === 'mentions' ? 'Volume' : 'Negative'}
                  </button>
                ))}
              </div>
            </div>
            {chartData.length ? (
              <div className="h-64 w-full" aria-label={`${trendMetric} trend chart`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cbd5e1" opacity={0.35} />
                    <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip labelFormatter={(value) => formatDate(String(value))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {data.entities.map((entity, index) => (
                      <Line key={entity.id} name={entity.name} type="monotone" dataKey={entity.id} stroke={COLORS[index % COLORS.length]} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400 dark:border-slate-700">No trend evidence in this window.</div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {data.entities.map((entity, index) => (
          <Card key={entity.id} hover={false} className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-950 dark:text-white">{entity.name}</h3>
                    {entity.is_primary && <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Your brand</span>}
                  </div>
                  <div className="mt-2"><EvidenceBadge evidence={{ status: entity.evidence_status, coverage_pct: entity.coverage_pct, counts: { collected: entity.counts.mentions, usable: entity.counts.mentions, analyzed: entity.counts.analyzed, pending: entity.counts.pending, rejected: 0 } }} /></div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Latest window risk</p>
                <p className="mt-1 font-mono text-2xl font-bold text-slate-950 dark:text-white">{entity.latest_risk?.score ?? '—'}<span className="text-sm text-slate-400">/100</span></p>
                <Trend entity={entity} />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <MetricButton label="Mention share" value={`${entity.shares.voice}%`} onClick={() => onInspect(entity, entity.filters.voice, `${entity.name} mentions`)} />
              <MetricButton label="Positive share" value={`${entity.shares.positive}%`} tone="positive" onClick={() => onInspect(entity, entity.filters.positive, `${entity.name} positive mentions`)} />
              <MetricButton label="Negative share" value={`${entity.shares.negative}%`} tone="negative" onClick={() => onInspect(entity, entity.filters.negative, `${entity.name} negative mentions`)} />
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Breakdown
                title="Top sources"
                empty="No source evidence"
                rows={entity.source_distribution.slice(0, 4).map((item) => ({ key: item.source, count: item.count, pct: item.share, filters: item.filters }))}
                entity={entity}
                onInspect={onInspect}
              />
              <Breakdown
                title="Top complaint categories"
                empty="No negative categories"
                rows={entity.top_categories.slice(0, 4).map((item) => ({ key: item.category, count: item.count, pct: item.share, filters: item.filters }))}
                entity={entity}
                onInspect={onInspect}
              />
            </div>

            {entity.evidence_status === 'partial' && (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                {entity.counts.pending} mention{entity.counts.pending === 1 ? ' is' : 's are'} awaiting analysis. Sentiment shares use only the {entity.counts.analyzed} analyzed mentions.
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label: title, value, detail, tone = 'default' }: { icon: typeof BarChart3; label: string; value: string | number; detail: string; tone?: 'default' | 'positive' | 'negative' }) {
  return (
    <Card hover={false} className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{title}</p>
          <p className={`mt-2 text-2xl font-bold ${tone === 'positive' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'negative' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-950 dark:text-white'}`}>{value}</p>
          <p className="mt-1 text-[11px] text-slate-400">{detail}</p>
        </div>
        <span className="rounded-xl bg-slate-100 p-2.5 text-slate-500 dark:bg-slate-900 dark:text-slate-300"><Icon className="h-4 w-4" /></span>
      </div>
    </Card>
  );
}

function MetricButton({ label: title, value, onClick, tone = 'default' }: { label: string; value: string; onClick: () => void; tone?: 'default' | 'positive' | 'negative' }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-slate-700 dark:hover:border-blue-700 dark:hover:bg-blue-950/20">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title}</span>
      <span className={`mt-1 block text-lg font-bold ${tone === 'positive' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'negative' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{value}</span>
    </button>
  );
}

function Breakdown({ title, empty, rows, entity, onInspect }: { title: string; empty: string; rows: Array<{ key: string; count: number; pct: number; filters: ComparisonFilters }>; entity: CompetitiveEntity; onInspect: Props['onInspect'] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h4>
      <div className="mt-3 space-y-3">
        {rows.length ? rows.map((row) => (
          <button type="button" key={row.key} onClick={() => onInspect(entity, row.filters, `${entity.name}: ${label(row.key)}`)} className="block w-full text-left group">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-medium text-slate-700 group-hover:text-blue-600 dark:text-slate-300 dark:group-hover:text-blue-400">{label(row.key)}</span>
              <span className="font-mono text-slate-500">{row.count} · {row.pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-slate-400 dark:bg-slate-500" style={{ width: `${row.pct}%` }} /></div>
          </button>
        )) : <p className="text-xs text-slate-400">{empty}</p>}
      </div>
    </div>
  );
}
