'use client';

interface RiskGaugeProps {
  score: number;
}

export default function RiskGauge({ score }: RiskGaugeProps) {
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(score, 100);
  const offset = circumference - (progress / 100) * circumference;

  const color = progress > 75 ? '#EF4444' : progress > 50 ? '#F59E0B' : '#10B981';

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg width={200} height={200} className="transform -rotate-90">
        {/* Background ring */}
        <circle
          cx="100"
          cy="100"
          r={radius}
          stroke="#E5E7EB"
          strokeWidth="12"
          fill="transparent"
        />
        {/* Animated progress ring */}
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
        <span className="text-5xl font-black text-slate-800">{progress}</span>
        <span className="text-sm font-medium text-slate-400">/ 100</span>
      </div>
    </div>
  );
}