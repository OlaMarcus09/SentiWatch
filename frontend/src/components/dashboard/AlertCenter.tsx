'use client';

import { motion } from 'framer-motion';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import { AlertCircle, AlertTriangle, Info, CheckCircle, ChevronRight } from 'lucide-react';

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

export default function AlertCenter({ alerts = [] }: AlertCenterProps) {
  const mockAlerts: Alert[] = [
    {
      id: '1',
      title: 'Negative mention velocity spike detected',
      source: 'Nigerian News Feed',
      risk: 'critical',
      timestamp: new Date().toISOString(),
    },
    {
      id: '2',
      title: 'Google Review sentiment dropped 15%',
      source: 'Google Reviews',
      risk: 'high',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const displayAlerts = alerts.length > 0 ? alerts : mockAlerts;

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

  if (displayAlerts.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="p-4 rounded-full bg-green-50 dark:bg-green-900/20 mb-4">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">All clear</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            No active alerts. We'll notify you immediately if anything changes.
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
        <Badge variant="danger">{displayAlerts.length}</Badge>
      </div>

      <div className="divide-y divide-slate-200/60 dark:divide-slate-700/60">
        {displayAlerts.map((alert, idx) => (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
          >
            <div className="flex items-start gap-3">
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
              <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
            </div>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}