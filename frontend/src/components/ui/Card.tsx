'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  hover?: boolean;
  animate?: boolean;
}

export default function Card({ 
  children, 
  className = '', 
  onClick,
  hover = true,
  animate = true 
}: CardProps) {
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 20 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      whileHover={hover ? { y: -4, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05), 0 10px 10px -5px rgba(0,0,0,0.02)' } : {}}
      onClick={onClick}
      className={`
        bg-white dark:bg-slate-800/80 
        rounded-2xl 
        border border-slate-200/60 dark:border-slate-700/60 
        p-6 
        transition-all duration-200
        ${hover ? 'cursor-pointer hover:border-blue-200 dark:hover:border-blue-800/50' : ''}
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}