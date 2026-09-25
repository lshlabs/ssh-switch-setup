import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export type PageTransitionPhase = 'idle' | 'enter' | 'exit';

export function usePageStack<K extends string>(initialPage: K) {
  const [state, setState] = useState<{ pages: K[]; phase: PageTransitionPhase }>({
    pages: [initialPage],
    phase: 'idle',
  });
  const stateRef = useRef(state);
  const triggers = useRef<HTMLElement[]>([]);
  const focusRequest = useRef<HTMLElement | undefined>(undefined);
  const update = useCallback((next: typeof state) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const open = useCallback(
    (page: K) => {
      const current = stateRef.current;
      if (current.phase !== 'idle' || current.pages.includes(page)) return;
      triggers.current.push(document.activeElement as HTMLElement);
      update({ pages: [...current.pages, page], phase: 'enter' });
    },
    [update],
  );
  const back = useCallback(() => {
    const current = stateRef.current;
    if (current.phase !== 'idle') return true;
    if (current.pages.length === 1) return false;
    update({ ...current, phase: 'exit' });
    return true;
  }, [update]);
  const complete = useCallback(() => {
    const current = stateRef.current;
    if (current.phase === 'idle') return;
    if (current.phase === 'exit') focusRequest.current = triggers.current.pop();
    update({
      pages: current.phase === 'exit' ? current.pages.slice(0, -1) : current.pages,
      phase: 'idle',
    });
  }, [update]);
  useLayoutEffect(() => {
    if (state.phase !== 'idle') return;
    const target = focusRequest.current;
    focusRequest.current = undefined;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [state]);
  return { ...state, page: state.pages[state.pages.length - 1]!, open, back, complete };
}
