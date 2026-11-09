import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  addListener: vi.fn(),
  isNativePlatform: vi.fn(),
}));

vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.addListener } }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));

import { useAutoRefresh } from './useAutoRefresh';

function mount(onRefresh = vi.fn(), enabled = true, interval = 20, busy = false) {
  // Effects are captured by the React mock so registration can resolve after cleanup.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useAutoRefresh(enabled, interval, onRefresh, busy);
  mocks.effects[0]?.();
  return mocks.effects[1]?.();
}

describe('useAutoRefresh lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.effects.length = 0;
    mocks.isNativePlatform.mockReturnValue(true);
    vi.stubGlobal('window', { setInterval: vi.fn(() => 0), clearInterval: vi.fn() });
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('removes a native listener even if registration resolves after unmount', async () => {
    let resolve!: (handle: { remove: () => Promise<void> }) => void;
    const promise = new Promise<{ remove: () => Promise<void> }>((resolvePromise) => {
      resolve = resolvePromise;
    });
    mocks.addListener.mockReturnValue(promise);
    const refresh = vi.fn();
    const cleanup = mount(refresh);
    cleanup?.();
    const remove = vi.fn().mockResolvedValue(undefined);
    resolve({ remove });
    await promise;
    expect(remove).toHaveBeenCalledOnce();
    expect(window.clearInterval).toHaveBeenCalledWith(0);
    mocks.addListener.mock.calls[0]?.[1]({ isActive: true });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes visible web pages without registering a native listener', () => {
    mocks.isNativePlatform.mockReturnValue(false);
    const refresh = vi.fn();
    const cleanup = mount(refresh);
    const tick = vi.mocked(window.setInterval).mock.calls[0]?.[0] as () => void;
    tick();
    expect(refresh).toHaveBeenCalledOnce();
    Object.defineProperty(document, 'hidden', { value: true });
    tick();
    expect(refresh).toHaveBeenCalledOnce();
    cleanup?.();
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', tick);
    expect(mocks.addListener).not.toHaveBeenCalled();
  });

  it.each([
    [false, 20, false],
    [true, 0, false],
    [true, 20, true],
  ])(
    'does not schedule refresh when enabled=%s, interval=%s, busy=%s',
    (enabled, interval, busy) => {
      mount(vi.fn(), enabled, interval, busy);
      expect(window.setInterval).not.toHaveBeenCalled();
      expect(mocks.addListener).not.toHaveBeenCalled();
    },
  );

  it('handles native registration failure while keeping the timer usable', async () => {
    mocks.addListener.mockRejectedValue(new Error('Unavailable'));
    const cleanup = mount();
    await Promise.resolve();
    await Promise.resolve();
    expect(window.setInterval).toHaveBeenCalledOnce();
    cleanup?.();
  });
});
