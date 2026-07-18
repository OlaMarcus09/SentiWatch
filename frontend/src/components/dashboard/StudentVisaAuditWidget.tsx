'use client';

import { ShieldAlert, CheckCircle2, AlertTriangle, Eye } from 'lucide-react';
import Card from '../ui/Card';

interface Mention {
  id: string;
  source: string;
  content: string;
  sentiment_results?: Array<{
    category: string;
    risk_level: string;
    severity: number;
    root_cause: string;
  }>;
}

interface StudentVisaAuditProps {
  mentions: Mention[];
  riskScore: number;
}

export default function StudentVisaAuditWidget({ mentions, riskScore }: StudentVisaAuditProps) {
  // Extract high-risk flags for visa screening
  const visaFlags = mentions.filter(m => {
    const result = m.sentiment_results?.[0];
    return result && (result.risk_level === 'high' || result.risk_level === 'critical' || result.severity >= 7);
  });

  const getStatusConfig = (score: number) => {
    if (score <= 25) return { text: 'Clear / Safe', color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30' };
    if (score <= 50) return { text: 'Review Advised', color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30' };
    return { text: 'High Risk Flag', color: 'text-rose-500 bg-rose-50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/30' };
  };

  const status = getStatusConfig(riskScore);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Risk Profile Breakdown */}
      <Card className="lg:col-span-1 p-6 flex flex-col justify-between">
        <div>
          <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
            Immigration Clearance Status
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
            Background check simulation modeling embassy officer evaluations.
          </p>
          
          <div className={`p-4 rounded-xl border text-center font-semibold text-lg mb-6 ${status.color}`}>
            {status.text}
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">Total Profile Nodes Scanned</span>
              <span className="text-sm font-semibold text-slate-900 dark:text-white">{mentions.length}</span>
            </div>
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">Critical Flags Found</span>
              <span className={`text-sm font-semibold ${visaFlags.length > 0 ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
                {visaFlags.length}
              </span>
            </div>
          </div>
        </div>
        
        <div className="mt-6 text-2xs text-slate-400 dark:text-slate-500 italic bg-slate-50 dark:bg-slate-900/40 p-3 rounded-lg border border-slate-100 dark:border-slate-800/60">
          💡 Note: Embassies cross-reference public forum discussions, political call-outs, and name variations using automated digital indexing tools.
        </div>
      </Card>

      {/* Flagged Elements Feed */}
      <Card className="lg:col-span-2 p-6">
        <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
          Background Audit Report & Risk Flags
        </h3>

        {visaFlags.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">Digital Footprint Pristine</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mt-1">
                No active threats or high-volatility controversies are indexed to your legal tracking name.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
            {visaFlags.map((flag) => {
              const res = flag.sentiment_results?.[0];
              return (
                <div 
                  key={flag.id} 
                  className="p-4 rounded-xl border border-rose-100 dark:border-rose-900/30 bg-white dark:bg-slate-800/40 shadow-2xs flex items-start gap-3 transition-all hover:border-rose-200"
                >
                  <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                  <div className="space-y-1 flex-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                        {res?.category.replace('_', ' ')} Flag
                      </span>
                      <span className="text-2xs font-medium text-slate-400 dark:text-slate-500 uppercase px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                        {flag.source}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2 italic">
                      "{flag.content}"
                    </p>
                    <div className="text-xs text-slate-500 dark:text-slate-400 pt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      <span><strong>Impact Trigger:</strong> {res?.root_cause}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}