'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import { AlertCircle, AlertTriangle, Info, CheckCircle, ChevronRight, ChevronDown } from 'lucide-react';

interface Alert {
  id: string;
  title: string;
  source: string;
  risk: 'critical' | 'high' | 'medium' | 'low';
  timestamp: string;
}

interface AlertCenterProps {
  alerts: Alert[];
}

const riskIcons = {
  critical: <AlertCircle className="w-4 h-4 text-red-500" />,
  high: <AlertTriangle className="w-4 h-4 text-orange-500" />,
  medium: <Info className="w-4 h-4 text-yellow-500" />,
  low: <CheckCircle className="w-4 h-4 text-green-500" />,
};

const riskBadgeVariant = {
  critical: 'danger',
  high: 'warning',
  medium: 'default',
  low: 'success',
} as const;

/** Extract a short root key from a title for grouping similar alerts. */
function getGroupKey(title: string): string {
  const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'with', 'by']);
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));
  return words.slice(0, 3).join(' ') || title.toLowerCase().slice(0, 30);
}

interface AlertGroup {
  key: string;
  representative: Alert;
  items: Alert[];
  highestRisk: Alert['risk'];
}

function groupAlerts(alerts: Alert[]): AlertGroup[] {
  const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const map = new Map<string, Alert[]>();

  for (const alert of alerts) {
    const key = getGroupKey(alert.title);
    const existing = map.get(key);
    if (existing) existing.push(alert);
    else map.set(key, [alert]);
  }

  const groups: AlertGroup[] = [];
  for (const [key, items] of map) {
    const sorted = [...items].sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]);
    groups.push({
      key,
      representative: sorted[0],
      items,
      highestRisk: sorted[0].risk,
    });
  }

  return groups.sort((a, b) => riskOrder[a.highestRisk] - riskOrder[b.highestRisk]);
}

function AlertRow({ alert }: { alert: Alert }) {
  return (
    <div className="flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <div className="mt-0.5">{riskIcons[alert.risk]}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {alert.title}
          </p>
          <Badge variant={riskBadgeVariant[alert.risk]} size="sm">
            {alert.risk.toUpperCase()}
          </Badge>
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
          <span>{alert.source}</span>
          <span>•</span>
          <span>{new Date(alert.timestamp).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

export default function AlertCenter({ alerts = [] }: AlertCenterProps) {
  const groups = useMemo(() => groupAlerts(alerts), [alerts]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (alerts.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="p-4 rounded-full bg-green-50 dark:bg-green-900/20 mb-4">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">All clear</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            No active alerts. We&apos;ll notify you immediately if anything changes.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Alert Center</h3>
        </div>
        <Badge variant="danger">{alerts.length}</Badge>
      </div>

      <div className="divide-y divide-slate-200/60 dark:divide-slate-700/60">
        {groups.map((group) => {
          const isSingle = group.items.length === 1;
          const isExpanded = expanded.has(group.key);

          if (isSingle) {
            return (
              <motion.div
                key={group.key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <AlertRow alert={group.representative} />
              </motion.div>
            );
          }

          return (
            <motion.div
              key={group.key}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{riskIcons[group.highestRisk]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {group.representative.title}
                      </p>
                      <Badge variant={riskBadgeVariant[group.highestRisk]} size="sm">
                        {group.highestRisk.toUpperCase()}
                      </Badge>
                      <Badge variant="info" size="sm">
                        {group.items.length} related
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <span>{group.representative.source}</span>
                      <span>•</span>
                      <span>{new Date(group.representative.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 mt-0.5">
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-slate-400" />
                      : <ChevronRight className="w-4 h-4 text-slate-300" />
                    }
                  </div>
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pl-6 border-l-2 border-slate-200 dark:border-slate-700 ml-6 divide-y divide-slate-100 dark:divide-slate-800">
                      {group.items.map((alert) => (
                        <AlertRow key={alert.id} alert={alert} />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}
