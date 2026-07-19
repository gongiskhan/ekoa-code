'use client';
import React from 'react';

type ShellWidth = 'default' | 'wide' | 'full';

const widthClasses: Record<ShellWidth, string> = {
  default: 'max-w-5xl',
  wide: 'max-w-7xl',
  full: 'max-w-none',
};

interface PageShellProps {
  width?: ShellWidth;
  testId?: string;
  children: React.ReactNode;
}

export function PageShell({ width = 'default', testId, children }: PageShellProps) {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-light" data-testid={testId}>
      <div className={`mx-auto ${widthClasses[width]} px-6 py-10 md:px-8 space-y-8`}>{children}</div>
    </div>
  );
}
