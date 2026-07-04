'use client';

import { useEffect, useState } from 'react';
import { motion, useAnimation } from 'framer-motion';

interface RiskGaugeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

export default function RiskGauge({ score, size = 'lg' }: RiskGaugeProps) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const controls = useAnimation();

  const sizes = {
    sm: { w: 120, r: 50, stroke: 8, text: 'text-2xl' },
    md: { w: 160, r: 68, stroke: 10, text: 'text-3xl' },
    lg: { w: 200, r: 85, stroke: 12, text: 'text-4xl' },
  };

  const { w, r, stroke, text } = sizes[size];
  const circumference = 2 * Math.PI * r;
  const progress = Math.min(score, 100);
  const offset = circumference - (progress / 100) * circumference;

  const color =
    progress > 75
      ? '#DC2626'
      : progress > 50
      ? '#F59E0B'
      : progress > 25
      ? '#2563EB'
      : '#16A34A';

  const status =
    progress > 75
      ? 'Critical'
      : progress > 50
      ? 'Elevated'
      : progress > 25
      ? 'Watch'
      : 'Healthy';

  useEffect(() => {
    const duration = 1000;
    const steps = 20;
    const increment = progress / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= progress) {
        setAnimatedScore(progress);
        clearInterval(timer);
      } else {
        setAnimatedScore(Math.round(current));
      }
    }, duration / steps);

    controls.start({
      strokeDashoffset: offset,
      transition: { duration: 1, ease: 'easeOut' },
    });

    return () => clearInterval(timer);
  }, [progress, offset, controls]);

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: w, height: w }}>
        <svg width={w} height={w} className="transform -rotate-90">
          <circle
            cx={w / 2}
            cy={w / 2}
            r={r}
            stroke="#E5E7EB"
            strokeWidth={stroke}
            fill="transparent"
            className="dark:stroke-slate-700"
          />
          <motion.circle
            cx={w / 2}
            cy={w / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="transparent"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={controls}
            className="transition-colors duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            key={animatedScore}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`font-black text-slate-800 dark:text-white ${text}`}
          >
            {animatedScore}
          </motion.span>
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">
            / 100
          </span>
          <span
            className="text-xs font-semibold mt-1 px-2.5 py-0.5 rounded-full"
            style={{ 
              color: color,
              backgroundColor: color + '20',
            }}
          >
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}