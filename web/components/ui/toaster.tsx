'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info, X, type LucideIcon } from 'lucide-react';
import { useToastStore, type ToastTone } from '@/stores/toast';
import { useTranslation } from '@/stores/i18n';

const toneIcon: Record<ToastTone, LucideIcon> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const toneIconColor: Record<ToastTone, string> = {
  success: 'text-teal-300',
  error: 'text-red-300',
  info: 'text-neutral-300',
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const { common } = useTranslation();
  const closeLabel = common?.close ?? 'Fechar';

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = toneIcon[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              role="status"
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 480, damping: 36 }}
              data-testid={t.testId}
              className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-overlay ring-1 ring-white/10"
            >
              <Icon className={`h-4 w-4 shrink-0 ${toneIconColor[t.tone]}`} aria-hidden />
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="rounded font-medium text-teal-300 hover:text-teal-200 focus-ring"
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label={closeLabel}
                onClick={() => dismiss(t.id)}
                className="rounded text-neutral-400 hover:text-white focus-ring"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
