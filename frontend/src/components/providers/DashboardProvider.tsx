'use client';

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Alert {
  id: string;
  title: string;
  source: string;
  risk: 'critical' | 'high' | 'medium' | 'low';
  timestamp: string;
}

const PIPELINE_STAGE_MESSAGES: Record<string, string> = {
  starting: 'Starting reputation analysis…',
  collecting_mentions: 'Collecting public mentions…',
  searching_web: 'Searching current web coverage…',
  analyzing_sentiment: 'Classifying sentiment and reputation risk…',
  calculating_risk: 'Calculating the reputation risk index…',
  completed: 'Analysis complete.',
};

interface DashboardContextValue {
  // Status
  loading: boolean;
  loadingMessage: string;
  error: string | null;

  // Identity
  displayName: string;
  displayEmail: string;
  userToken: string;

  // Data
  allEntities: any[];
  currentEntity: any;
  currentEntityName: string;
  competitorsData: any[];
  mentions: any[];
  recommendation: any;
  riskScoreData: any;
  finalRiskScore: number;
  previousRiskScore: number | null;

  // Derived
  positive: number;
  neutral: number;
  negative: number;
  trendDelta: number | null;
  categoryBreakdown: Record<string, number>;
  alerts: Alert[];
  rootCauseSummary: string;

  // Theme
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  refreshCompetitors: () => Promise<void>;
  updateCurrentEntity: (patch: Record<string, any>) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return ctx;
}

export default function DashboardProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entityIdParam = searchParams.get('entity_id');

  // Core State
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Initializing secure connection…');
  const [error, setError] = useState<string | null>(null);
  const [userToken, setUserToken] = useState<string>('');

  // Identity
  const [displayName, setDisplayName] = useState<string>('');
  const [displayEmail, setDisplayEmail] = useState<string>('');

  // Data State
  const [allEntities, setAllEntities] = useState<any[]>([]);
  const [currentEntity, setCurrentEntity] = useState<any>(null);
  const [competitorsData, setCompetitorsData] = useState<any[]>([]);
  const [mentions, setMentions] = useState<any[]>([]);
  const [finalRiskScore, setFinalRiskScore] = useState(0);
  const [previousRiskScore, setPreviousRiskScore] = useState<number | null>(null);
  const [recommendation, setRecommendation] = useState<any>(null);
  const [riskScoreData, setRiskScoreData] = useState<any>(null);

  // Theme
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const refreshCompetitors = useCallback(async () => {
    if (!currentEntity?.id) return;
    const { data, error } = await supabase
      .from('competitor_links')
      .select('competitor_entity_id, monitored_entities!competitor_entity_id(*, risk_scores(*))')
      .eq('primary_entity_id', currentEntity.id);
    if (error) {
      console.error('Failed to refresh competitors:', error);
      return;
    }
    setCompetitorsData((data || []).map((link: any) => link.monitored_entities).filter(Boolean));
  }, [currentEntity?.id]);

  const updateCurrentEntity = useCallback((patch: Record<string, any>) => {
    setCurrentEntity((previous: any) => previous ? { ...previous, ...patch } : previous);
    setAllEntities((previous) => previous.map((entity) =>
      entity.id === currentEntity?.id ? { ...entity, ...patch } : entity
    ));
  }, [currentEntity?.id]);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('theme') : null;
    const isDark = stored ? stored === 'dark' : document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', isDark);
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    if (typeof window !== 'undefined') localStorage.setItem('theme', newTheme);
  };

  // ─── POLLING & DATA FETCHING ENGINE ───
  useEffect(() => {
    let isMounted = true;
    let pollInterval: NodeJS.Timeout;
    const MAX_POLLS = 40; // 40 attempts * 3 seconds = 120s (covers Render free-tier cold starts)
    let pollCount = 0;

    const loadingMessages = [
      'Authenticating user…',
      'Deploying data scrapers…',
      'Searching live web context via Tavily…',
      'Analyzing sentiment with Groq Llama-3…',
      'Calculating risk index…',
      'Generating competitor matrix…',
      'Finalizing dashboard…'
    ];

    async function loadData() {
      try {
        if (isMounted) setError(null);
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (isMounted) router.push('/login');
          return;
        }

        if (isMounted) setUserToken(session.access_token);

        // Derive a single, consistent identity from the Supabase session.
        const email = session.user.email || '';
        const metaName =
          (session.user.user_metadata?.full_name as string) ||
          (session.user.user_metadata?.name as string) ||
          '';
        const name = metaName || (email ? email.split('@')[0] : 'there');
        if (isMounted) {
          setDisplayName(name);
          setDisplayEmail(email);
        }

        const userId = session.user.id;

        // 1. Fetch User Entities
        const { data: entities, error: entitiesError } = await supabase
          .from('monitored_entities')
          .select('*')
          .eq('user_id', userId)
          .order('name');

        if (entitiesError || !entities || entities.length === 0) {
          if (isMounted) { setAllEntities([]); setLoading(false); }
          return;
        }

        // Competitors are stored as owned monitored_entities too, so they'd
        // otherwise show up in the dashboard/selector alongside real brands.
        // Exclude any entity that is linked as a competitor (RLS scopes
        // competitor_links to the user's own entities) so competitors only
        // surface on the Competitors tab.
        const { data: linkedCompetitors } = await supabase
          .from('competitor_links')
          .select('competitor_entity_id');
        const competitorIds = new Set(
          (linkedCompetitors || []).map((l: any) => l.competitor_entity_id)
        );
        const primaryEntities = entities.filter((e) => !competitorIds.has(e.id));

        if (primaryEntities.length === 0) {
          if (isMounted) { setAllEntities([]); setLoading(false); }
          return;
        }

        if (isMounted) setAllEntities(primaryEntities);
        const activeEntity = primaryEntities.find(e => e.id === entityIdParam) || primaryEntities[0];
        if (isMounted) setCurrentEntity(activeEntity);

        // 2. Fetch Competitors
        const { data: compLinks, error: compLinksError } = await supabase
          .from('competitor_links')
          .select('competitor_entity_id, monitored_entities!competitor_entity_id(*, risk_scores(*))')
          .eq('primary_entity_id', activeEntity.id);

        if (compLinksError) {
          // A blocked read (e.g. a missing RLS SELECT policy on competitor_links)
          // otherwise looks identical to "no competitors" — surface it instead of
          // silently rendering the empty state. See SECURITY.md §4d.
          console.error('Failed to load competitors:', compLinksError);
        }

        if (isMounted && compLinks) {
          setCompetitorsData(compLinks.map((link: any) => link.monitored_entities));
        }

        // 3. Polling Logic for Background Tasks
        const checkDataReady = async () => {
          if (!isMounted) return;
          pollCount++;

          // Cycle through loading messages to keep user engaged
          if (pollCount < loadingMessages.length) {
            setLoadingMessage(loadingMessages[pollCount]);
          }

          // Check if FastAPI background worker has finished saving the risk score.
          // Fetch the two most recent rows so we can compute a real trend delta.
          const [{ data: riskRows, error: riskError }, { data: pipelineRun, error: pipelineError }] = await Promise.all([
            supabase
              .from('risk_scores')
              .select('*')
              .eq('entity_id', activeEntity.id)
              .order('created_at', { ascending: false })
              .limit(2),
            supabase
              .from('pipeline_runs')
              .select('status, stage, error_message, started_at')
              .eq('entity_id', activeEntity.id)
              .order('started_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

          // Stay compatible while the pipeline_runs migration rolls out.
          if (pipelineError && pipelineError.code !== '42P01') {
            console.error('Failed to load pipeline status:', pipelineError);
          }

          const latestRiskCreatedAt = riskRows?.[0]?.created_at;
          const failureIsNewerThanRisk = !latestRiskCreatedAt || (
            pipelineRun?.started_at &&
            new Date(pipelineRun.started_at).getTime() >= new Date(latestRiskCreatedAt).getTime()
          );

          if (pipelineRun?.status === 'failed' && failureIsNewerThanRisk) {
            setError(
              pipelineRun.error_message
                ? `Analysis failed: ${pipelineRun.error_message}`
                : 'Analysis failed. Please try creating the entity again.'
            );
            setLoading(false);
            return;
          }

          if (pipelineRun?.status === 'running' && pipelineRun.stage) {
            setLoadingMessage(
              PIPELINE_STAGE_MESSAGES[pipelineRun.stage] || 'Reputation analysis is running…'
            );
          }

          if (riskError) {
            console.error('Failed to load risk score:', riskError);
          }

          const riskData = riskRows?.[0] || null;
          const priorRisk = riskRows?.[1] || null;

          if (!riskData && pollCount < MAX_POLLS) {
            // Data isn't ready yet, FastAPI is still running. Try again in 3 seconds.
            pollInterval = setTimeout(checkDataReady, 3000);
            return;
          } else if (!riskData && pollCount >= MAX_POLLS) {
            setError('Analysis is taking longer than expected. Please refresh to check its latest status.');
            setLoading(false);
            return;
          }

          // 4. Data is ready! Fetch the rest of the payloads.
          const { data: fetchedMentions } = await supabase
            .from('mentions')
            .select('*')
            .eq('entity_id', activeEntity.id)
            .order('created_at', { ascending: false });

          const mentionIds = (fetchedMentions || []).map((m: any) => m.id);
          const { data: sentimentRows } = mentionIds.length > 0
            ? await supabase.from('sentiment_results').select('*').in('mention_id', mentionIds)
            : { data: [] };

          const sentimentMap = Object.fromEntries((sentimentRows || []).map((s: any) => [s.mention_id, s]));
          const mergedMentions = (fetchedMentions || []).map((m: any) => ({
            ...m,
            sentiment_results: sentimentMap[m.id] ? [sentimentMap[m.id]] : [],
          }));

          const { data: recData } = await supabase
            .from('recommendations')
            .select('*')
            .eq('entity_id', activeEntity.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (isMounted) {
            setMentions(mergedMentions);
            setFinalRiskScore(Math.min(riskData?.score || 0, 100));
            setPreviousRiskScore(priorRisk ? Math.min(priorRisk.score || 0, 100) : null);
            setRiskScoreData(riskData);
            setRecommendation(recData);
            setError(null);
            setLoading(false);
            // Keep an open dashboard current while scheduled or background
            // analysis writes new mentions and scores.
            pollInterval = setTimeout(checkDataReady, 30000);
          }
        };

        // Trigger the polling loop
        checkDataReady();

      } catch (err) {
        console.error(err);
        if (isMounted) setError('An unexpected error occurred. Please refresh.');
      }
    }

    loadData();
    return () => {
      isMounted = false;
      clearTimeout(pollInterval);
    };
  }, [entityIdParam, router]);

  // ─── DERIVED VALUES ───

  // Calculate Sentiment Stats
  let positive = 0, neutral = 0, negative = 0;
  mentions.forEach((m) => {
    const label = m.sentiment_results?.[0]?.label || 'neutral';
    if (label === 'positive') positive++;
    else if (label === 'negative') negative++;
    else neutral++;
  });

  const rootCauseSummary = riskScoreData?.root_cause_summary || '';
  const currentEntityName = currentEntity?.name || 'Your Profile';

  // Real trend: change vs the previous saved risk score (null when no prior data).
  const trendDelta =
    previousRiskScore !== null ? finalRiskScore - previousRiskScore : null;

  // Real category breakdown from the saved risk score (feeds the heatmap).
  const categoryBreakdown: Record<string, number> =
    riskScoreData?.category_breakdown || {};

  // Real alerts: high-severity negative mentions, most severe first.
  const alerts: Alert[] = mentions
    .filter((m) => {
      const s = m.sentiment_results?.[0];
      return s?.label === 'negative' && (s?.severity || 0) >= 8;
    })
    .sort(
      (a, b) =>
        (b.sentiment_results?.[0]?.severity || 0) -
        (a.sentiment_results?.[0]?.severity || 0)
    )
    .slice(0, 5)
    .map((m) => {
      const severity = m.sentiment_results?.[0]?.severity || 0;
      const risk: 'critical' | 'high' | 'medium' | 'low' =
        severity >= 9 ? 'critical' : severity >= 8 ? 'high' : 'medium';
      return {
        id: m.id,
        title:
          m.sentiment_results?.[0]?.root_cause ||
          (m.content ? String(m.content).slice(0, 80) : 'Negative mention detected'),
        source: m.source || 'Unknown',
        risk,
        timestamp: m.created_at,
      };
    });

  const value = useMemo<DashboardContextValue>(
    () => ({
      loading,
      loadingMessage,
      error,
      displayName,
      displayEmail,
      userToken,
      allEntities,
      currentEntity,
      currentEntityName,
      competitorsData,
      mentions,
      recommendation,
      riskScoreData,
      finalRiskScore,
      previousRiskScore,
      positive,
      neutral,
      negative,
      trendDelta,
      categoryBreakdown,
      alerts,
      rootCauseSummary,
      theme,
      toggleTheme,
      refreshCompetitors,
      updateCurrentEntity,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      loading,
      loadingMessage,
      error,
      displayName,
      displayEmail,
      userToken,
      allEntities,
      currentEntity,
      competitorsData,
      mentions,
      recommendation,
      riskScoreData,
      finalRiskScore,
      previousRiskScore,
      theme,
      refreshCompetitors,
      updateCurrentEntity,
    ]
  );

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}
