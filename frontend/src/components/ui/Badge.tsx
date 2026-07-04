'use client';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}

export default function Badge({ 
  children, 
  variant = 'default', 
  size = 'sm',
  className = '' 
}: BadgeProps) {
  const variants = {
    default: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
    success: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    warning: 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    danger: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    info: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  };

  const sizes = {
    sm: 'px-2.5 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  };

  return (
    <span className={`
      inline-flex items-center font-medium rounded-full
      ${variants[variant]} 
      ${sizes[size]}
      ${className}
    `}>
      {children}
    </span>
  );
}