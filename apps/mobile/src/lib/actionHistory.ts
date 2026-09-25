import { Power, PowerOff, RotateCcw, type LucideIcon } from 'lucide-react';
import type { PcStatus, PowerAction } from '@pc-control/core';

export const ACTION_LABEL_KEY: Record<PowerAction, string> = {
  'power-on': 'home.powerOn',
  shutdown: 'home.shutdown',
  reboot: 'home.reboot',
};

export const ACTION_ICON: Record<PowerAction, LucideIcon> = {
  'power-on': Power,
  shutdown: PowerOff,
  reboot: RotateCcw,
};

export type ActionHistoryTone = 'power-on' | 'power-off' | 'power-reboot' | 'error';

export function actionHistoryTone(action: PowerAction, finalStatus: PcStatus): ActionHistoryTone {
  if (finalStatus === 'error') return 'error';
  if (action === 'power-on') return 'power-on';
  if (action === 'shutdown') return 'power-off';
  return 'power-reboot';
}

export function actionHistoryDescriptionKey(action: PowerAction, finalStatus: PcStatus) {
  if (action === 'reboot' && finalStatus === 'online') return 'history.actionReconnected';
  if (action === 'power-on' && finalStatus === 'online') return 'history.actionPoweredOn';
  if (action === 'shutdown' && finalStatus === 'offline') return 'history.actionShutdown';
  if (finalStatus === 'error') return 'history.actionFailed';
  return 'history.actionDone';
}

export function actionHistoryOutcomeKey(finalStatus: PcStatus) {
  if (finalStatus === 'error') return 'common.failed';
  if (finalStatus === 'online' || finalStatus === 'offline') return 'common.completed';
  return 'history.pending';
}
