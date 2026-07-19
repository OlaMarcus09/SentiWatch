'use client';

import { motion } from 'framer-motion';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { Zap, Clock, Check, ExternalLink } from 'lucide-react';

interface RecommendationCenterProps {
  recommendation: any;
  score: number;
}

export default function RecommendationCenter({ recommendation, score }: RecommendationCenterProps) {
  if (!recommendation) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="p-4 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
            <Zap className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">No recommendations yet</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">
            We'll generate personalized recommendations once we have enough brand mentions.
          </p>
        </div>
      </Card>
    );
  }

  const priority = score > 75 ? 'Critical' : score > 50 ? 'High' : score > 25 ? 'Medium' : 'Low';
  const priorityColor = 
    priority === 'Critical' ? 'danger' : 
    priority === 'High' ? 'warning' : 
    priority === 'Medium' ? 'info' : 'default';

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/20">
          <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 space-y-3">
          <div className="flex items-center flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Recommendation Center
            </h3>
            <Badge variant={priorityColor}>{priority} Priority</Badge>
            <Badge variant="default">
              <Clock className="w-3 h-3 mr-1" />
              {score > 75 ? 'Immediate' : score > 50 ? '12 hours' : '24 hours'}
            </Badge>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
              {recommendation.action_plan || 'Review your reputation data.'}
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button size="sm">
              <Check className="w-3.5 h-3.5" /> 
              Generate Response
            </Button>
            <Button variant="ghost" size="sm">Dismiss</Button>
            <Button variant="ghost" size="sm" className="text-slate-400">
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}