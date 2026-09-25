import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { usePageStack, PageTransitionPhase } from '../../hooks/usePageStack';

type TransitionDirection = 'forward' | 'back';

export function PageStack<K extends string>({
  navigation,
  children,
}: {
  navigation: ReturnType<typeof usePageStack<K>>;
  children: (page: K) => ReactNode;
}) {
  const topIndex = navigation.pages.length - 1;
  const transitionDirection: TransitionDirection | undefined =
    navigation.phase === 'enter' ? 'forward' : navigation.phase === 'exit' ? 'back' : undefined;

  return (
    <div className="page-stack" data-transition-direction={transitionDirection}>
      {navigation.pages.map((page, index) => {
        let phase: PageTransitionPhase = 'idle';
        let animationName: string | undefined;
        let completesTransition = false;

        if (navigation.phase === 'enter') {
          if (index === topIndex) {
            // Forward: the new page slides from +100% to 0.
            phase = 'enter';
            animationName = 'page-forward-enter';
            completesTransition = true;
          } else if (index === topIndex - 1) {
            // Forward: the previous page shifts from 0 to -120dp-equivalent.
            phase = 'exit';
            animationName = 'page-forward-exit';
          }
        } else if (navigation.phase === 'exit') {
          if (index === topIndex) {
            // Back: the current page slides from 0 to +100%.
            phase = 'exit';
            animationName = 'page-back-exit';
            completesTransition = true;
          } else if (index === topIndex - 1) {
            // Back: the revealed page returns from -120dp-equivalent to 0.
            phase = 'enter';
            animationName = 'page-back-enter';
          }
        }

        return (
          <PageLayer
            key={page}
            page={page}
            active={index === topIndex}
            phase={phase}
            animationName={animationName}
            completesTransition={completesTransition}
            onComplete={navigation.complete}
          >
            {children(page)}
          </PageLayer>
        );
      })}
    </div>
  );
}

function PageLayer({
  page,
  active,
  phase,
  animationName,
  completesTransition,
  onComplete,
  children,
}: {
  page: string;
  active: boolean;
  phase: PageTransitionPhase;
  animationName: string | undefined;
  completesTransition: boolean;
  onComplete: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (phase === 'idle' || !animationName || !completesTransition) return;

    const layer = ref.current!;
    // Wait for the actual CSS animation, including reduced-motion and cancellation.
    // No independent timer can unmount the surface before its last frame.
    const animation = layer
      .getAnimations()
      .find(
        (candidate) => 'animationName' in candidate && candidate.animationName === animationName,
      );

    let disposed = false;
    const finish = () => {
      if (!disposed) onComplete();
    };

    if (animation) void animation.finished.then(finish, finish);
    else queueMicrotask(finish);

    return () => {
      disposed = true;
    };
  }, [animationName, completesTransition, phase, onComplete]);

  return (
    <div
      ref={ref}
      data-page-layer={page}
      className={`page-layer${phase === 'idle' ? '' : ` page-transition-${phase}`}`}
      inert={!active || phase !== 'idle'}
      aria-hidden={!active || undefined}
    >
      {children}
    </div>
  );
}
