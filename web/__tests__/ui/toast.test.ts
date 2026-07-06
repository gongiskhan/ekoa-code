import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toast, useToastStore } from '@/stores/toast';

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().clear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    useToastStore.getState().clear();
  });

  it('adds a toast with the tone and message', () => {
    toast.success('Saved');
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].tone).toBe('success');
    expect(toasts[0].message).toBe('Saved');
    expect(toasts[0].duration).toBe(2500);
  });

  it('uses the default duration per tone', () => {
    toast.error('Boom');
    toast.info('FYI');
    const { toasts } = useToastStore.getState();
    expect(toasts.find((t) => t.tone === 'error')?.duration).toBe(6000);
    expect(toasts.find((t) => t.tone === 'info')?.duration).toBe(4000);
  });

  it('auto-expires after its duration', () => {
    toast.success('Temp');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(2499);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('honours a custom duration and 0 = sticky', () => {
    toast.info('Sticky', { duration: 0 });
    vi.advanceTimersByTime(100000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('can be dismissed manually before expiry', () => {
    const id = toast.success('Manual');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('carries an optional action', () => {
    const onClick = vi.fn();
    toast.info('Undo?', { action: { label: 'Undo', onClick } });
    expect(useToastStore.getState().toasts[0].action?.label).toBe('Undo');
  });
});
