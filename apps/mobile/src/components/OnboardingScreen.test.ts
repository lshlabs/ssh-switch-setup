import { describe, expect, it } from 'vitest';

import { defaultAppSettings } from '@pc-control/core';
import { createOnboardingSession } from './onboardingSession';

describe('createOnboardingSession', () => {
  it('starts with blank connection fields and product defaults without mutating preferences', () => {
    const saved = {
      ...defaultAppSettings(),
      pcHost: '192.168.60.177',
      pcPort: 2200,
      pcUsername: 'admin',
      pcMac: '2C:F0:5D:83:5B:07',
      routerHost: '192.168.60.1',
      routerPort: 2222,
      routerUsername: 'root',
      wolInterface: 'br0',
      themePreference: 'dark' as const,
      onboardingStep: 9,
      onboardingCompleted: true,
    };

    const session = createOnboardingSession(saved);

    expect(session).toMatchObject({
      pcHost: '',
      pcPort: 22,
      pcUsername: '',
      pcMac: '',
      routerHost: '',
      routerPort: 22,
      routerUsername: '',
      wolInterface: '',
      themePreference: 'dark',
      onboardingStep: 0,
      onboardingCompleted: false,
    });
    expect(saved.pcHost).toBe('192.168.60.177');
  });
});
