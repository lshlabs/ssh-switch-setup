import { registerPlugin } from '@capacitor/core';

import type { PcControlPlugin } from './definitions';

const PcControl = registerPlugin<PcControlPlugin>('PcControl', {
  web: () => import('./web').then((module) => new module.PcControlWeb()),
});

export * from './definitions';
export { PcControl };
