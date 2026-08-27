'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PendingLeave } from './leave-guard';
import { resolveInternalHref } from './leave-guard';

function formatSavedAgo(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function useEditSaveFeedback(formId?: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [leavePrompt, setLeavePrompt] = useState<PendingLeave | null>(null);

  const pendingLeaveRef = useRef<PendingLeave | null>(null);
  const backGuardRef = useRef(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!formId) return;
    const form = document.getElementById(formId);
    if (!form) return;
    const markDirty = () => setDirty(true);
    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    return () => {
      form.removeEventListener('input', markDirty);
      form.removeEventListener('change', markDirty);
    };
  }, [formId]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const completeLeave = useCallback(
    (target: PendingLeave) => {
      setDirty(false);
      setLeavePrompt(null);
      pendingLeaveRef.current = null;
      backGuardRef.current = false;

      if ('href' in target) {
        router.push(target.href);
        return;
      }

      window.history.go(-2);
    },
    [router],
  );

  const requestLeave = useCallback((target: PendingLeave) => {
    pendingLeaveRef.current = target;
    setLeavePrompt(target);
  }, []);

  useEffect(() => {
    if (!dirty) {
      backGuardRef.current = false;
      return;
    }

    if (!backGuardRef.current) {
      window.history.pushState({ editLeaveGuard: true }, '', window.location.href);
      backGuardRef.current = true;
    }

    const onPopState = () => {
      window.history.pushState({ editLeaveGuard: true }, '', window.location.href);
      requestLeave({ type: 'back' });
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [dirty, requestLeave]);

  useEffect(() => {
    if (!dirty) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest('a');
      if (!anchor) return;

      const href = resolveInternalHref(anchor, window.location);
      if (!href) return;

      event.preventDefault();
      event.stopPropagation();
      requestLeave({ href });
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty, requestLeave]);

  const reportResult = useCallback(
    (text: string) => {
      const isError = text.startsWith('Error:');
      setStatusText(text);
      setStatusTone(isError ? 'error' : 'success');
      if (!isError) {
        setDirty(false);
        setLastSaved(new Date());
        setToast({ message: 'Saved — will update on live site shortly', tone: 'success' });

        const queuedLeave = pendingLeaveRef.current;
        if (queuedLeave) {
          completeLeave(queuedLeave);
        }
      } else {
        pendingLeaveRef.current = null;
        setLeavePrompt(null);
        setToast({ message: text.replace(/^Error:\s*/, ''), tone: 'error' });
      }
    },
    [completeLeave],
  );

  const saveBeforeLeave = useCallback(() => {
    if (!formId) return;
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    form.requestSubmit();
  }, [formId]);

  const discardLeave = useCallback(() => {
    const target = leavePrompt ?? pendingLeaveRef.current;
    if (!target) {
      setLeavePrompt(null);
      pendingLeaveRef.current = null;
      return;
    }
    completeLeave(target);
  }, [completeLeave, leavePrompt]);

  const stayOnPage = useCallback(() => {
    pendingLeaveRef.current = null;
    setLeavePrompt(null);
  }, []);

  const barStatusText = pending
    ? 'Saving…'
    : dirty
      ? 'Unsaved changes'
      : statusText?.startsWith('Error:')
        ? statusText
        : lastSaved
          ? `Saved ${formatSavedAgo(lastSaved)}`
          : null;

  const barTone: 'neutral' | 'success' | 'error' = pending
    ? 'neutral'
    : dirty
      ? 'neutral'
      : statusTone;

  return {
    pending,
    startTransition,
    reportResult,
    barStatusText,
    barTone,
    toast,
    dismissToast: () => setToast(null),
    dirty,
    leavePrompt,
    saveBeforeLeave,
    discardLeave,
    stayOnPage,
  };
}
