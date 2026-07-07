'use client';
import { Loader2 } from 'lucide-react';

type SpinnerSize = 'xs' | 'sm' | 'md';

const sizeMap: Record<SpinnerSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
};

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

export function Spinner({ size = 'sm', className }: SpinnerProps) {
  return <Loader2 className={`animate-spin ${sizeMap[size]} ${className ?? ''}`} aria-hidden />;
}

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <Spinner size="md" className="text-neutral-400" />
      {label && <p className="text-sm text-neutral-500">{label}</p>}
    </div>
  );
}
