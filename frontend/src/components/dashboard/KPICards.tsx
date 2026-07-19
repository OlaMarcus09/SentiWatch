'use client';

import { motion } from 'framer-motion';
import Card from '../ui/Card';
import { Activity, AlertTriangle, ThumbsDown, ThumbsUp } from 'lucide-react';

interface KPICardsProps {
  totalMentions: number;
  negative: number;
  positive: number;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export default function KPICards({ totalMentions, negative, positive }: KPICardsProps) {
  const cards = [
    {
      label: 'Total Mentions',
      value: totalMentions,
      icon: Activity,
      color: 'text-blue-600',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
    },
    {
      label: 'Risk Index',
      value: Math.round((negative / (totalMentions || 1)) * 100),
      icon: AlertTriangle,
      color: 'text-orange-500',
      bg: 'bg-orange-50 dark:bg-orange-900/20',
      suffix: '%',
    },
    {
      label: 'Negative',
      value: negative,
      icon: ThumbsDown,
      color: 'text-red-600',
      bg: 'bg-red-50 dark:bg-red-900/20',
    },
    {
      label: 'Positive',
      value: positive,
      icon: ThumbsUp,
      color: 'text-green-600',
      bg: 'bg-green-50 dark:bg-green-900/20',
    },
  ];

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 md:grid-cols-4 gap-4"
    >
      {cards.map((card, idx) => (
        <motion.div key={idx} variants={item}>
          <Card hover={false} className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div className={`p-2 rounded-xl ${card.bg}`}>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold text-slate-800 dark:text-white">
                {card.value}{card.suffix || ''}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{card.label}</p>
            </div>
          </Card>
        </motion.div>
      ))}
    </motion.div>
  );
}