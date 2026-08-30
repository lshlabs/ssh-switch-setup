import { useEffect, useState } from 'react';

import {
  PcControl,
  type BridgeStatusResult,
  type ExecuteSshCommandResult,
  type SshHostKeyResult,
  type SshIdentityResult,
  type SshTarget,
} from '@pc-control/capacitor-pc-control';
import { DEFAULT_PC_CONTROL_CONFIG } from '@pc-control/core';

type CheckState = 'idle' | 'checking' | 'ready' | 'unavailable' | 'error';

interface StatusMessage {
  message: string;
  state: CheckState;
}

interface CommandDefinition {
  command: string;
  label: string;
}

interface SshTargetPanelProps {
  commands: readonly CommandDefinition[];
  defaultUsername?: string;
  host: string;
  label: string;
  onOutput: (output: string) => void;
  port: number;
  target: SshTarget;
}

const INITIAL_BRIDGE_CHECK: StatusMessage = {
  message: '아직 확인하지 않음',
  state: 'idle',
};

const WINDOWS_COMMANDS = [
  { command: 'hostname', label: 'hostname' },
  { command: 'whoami', label: 'whoami' },
] as const;

const ROUTER_COMMANDS = [
  { command: 'uname -n', label: 'uname -n' },
  { command: 'printf "%s\\n" "$USER"', label: 'user' },
  { command: 'uname -a', label: 'uname -a' },
] as const;

function bridgeMessage(result: BridgeStatusResult): StatusMessage {
  if (!result.native) {
    return {
      message: '웹 미리보기에서는 네이티브 SSH를 사용할 수 없습니다.',
      state: 'unavailable',
    };
  }

  return { message: 'Android 네이티브 브리지 연결됨', state: 'ready' };
}

function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    const message = typeof candidate.message === 'string' ? candidate.message : '알 수 없는 오류';
    return typeof candidate.code === 'string' ? `[${candidate.code}] ${message}` : message;
  }
  return '알 수 없는 오류';
}

function formatCommandResult(
  label: string,
  command: string,
  result: ExecuteSshCommandResult,
): string {
  const stdout = result.stdout.trimEnd() || '(stdout 없음)';
  const stderr = result.stderr.trimEnd();
  return [
    `${label} > ${command}`,
    `exit ${result.exitCode}`,
    stdout,
    ...(stderr ? [`stderr: ${stderr}`] : []),
  ].join('\n');
}

function SshTargetPanel({
  commands,
  defaultUsername = '',
  host,
  label,
  onOutput,
  port,
  target,
}: SshTargetPanelProps) {
  const [username, setUsername] = useState(defaultUsername);
  const [hostKey, setHostKey] = useState<SshHostKeyResult>();
  const [busyAction, setBusyAction] = useState<string>();
  const [status, setStatus] = useState('저장된 호스트 키 확인 중…');

  useEffect(() => {
    let active = true;
    void PcControl.getTrustedSshHostKey({ host, port })
      .then((trusted) => {
        if (!active) return;
        if (trusted.trusted && trusted.algorithm && trusted.fingerprint) {
          setHostKey({
            algorithm: trusted.algorithm,
            fingerprint: trusted.fingerprint,
            host,
            port,
            trusted: true,
          });
          setStatus('저장된 호스트 키를 사용합니다.');
        } else {
          setStatus('호스트 키를 스캔하고 지문을 확인하세요.');
        }
      })
      .catch((error: unknown) => {
        if (active) setStatus(describeError(error));
      });
    return () => {
      active = false;
    };
  }, [host, port]);

  async function scanHostKey() {
    setBusyAction('scan');
    setStatus('호스트 키 스캔 중…');
    try {
      const result = await PcControl.scanSshHostKey({ host, port, connectTimeoutMs: 8_000 });
      setHostKey(result);
      setStatus(
        result.trusted
          ? '스캔한 지문이 저장된 값과 일치합니다.'
          : '서버에서 확인한 지문입니다. 서버의 실제 지문과 비교한 뒤 신뢰하세요.',
      );
    } catch (error) {
      setStatus(describeError(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function trustHostKey() {
    if (!hostKey) return;
    setBusyAction('trust');
    try {
      const result = await PcControl.trustSshHostKey({
        algorithm: hostKey.algorithm,
        fingerprint: hostKey.fingerprint,
        host,
        port,
      });
      setHostKey(result);
      setStatus('호스트 키 지문을 이 기기에 저장했습니다.');
    } catch (error) {
      setStatus(describeError(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function executeCommand(command: string) {
    if (!username.trim()) {
      setStatus('SSH 사용자 이름을 입력하세요.');
      return;
    }
    setBusyAction(command);
    setStatus(`${command} 실행 중…`);
    try {
      const result = await PcControl.executeSshCommand({
        command,
        commandTimeoutMs: 8_000,
        connectTimeoutMs: 8_000,
        ...(hostKey ? { expectedHostFingerprint: hostKey.fingerprint } : {}),
        host,
        port,
        target,
        username: username.trim(),
      });
      setStatus(`${command} 성공`);
      onOutput(formatCommandResult(label, command, result));
    } catch (error) {
      const message = describeError(error);
      setStatus(message);
      onOutput(`${label} > ${command}\n${message}`);
    } finally {
      setBusyAction(undefined);
    }
  }

  const busy = busyAction !== undefined;

  return (
    <section className="border-t border-slate-200 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">{label}</h2>
        <span className="font-mono text-xs text-slate-500">
          {host}:{port}
        </span>
      </div>

      {target === 'router' ? (
        <label className="mt-4 block text-sm text-slate-700">
          ASUS SSH 사용자
          <input
            autoCapitalize="none"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="사용자 이름"
            spellCheck={false}
            value={username}
          />
        </label>
      ) : (
        <p className="mt-2 text-sm text-slate-600">SSH 사용자: {username}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={busy}
          onClick={scanHostKey}
          type="button"
        >
          {busyAction === 'scan' ? '스캔 중…' : '호스트 키 스캔'}
        </button>
        {hostKey && !hostKey.trusted ? (
          <button
            className="rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={trustHostKey}
            type="button"
          >
            {busyAction === 'trust' ? '저장 중…' : '확인한 지문 신뢰'}
          </button>
        ) : null}
      </div>

      {hostKey ? (
        <div className="mt-3 break-all font-mono text-xs leading-5 text-slate-700">
          <div>{hostKey.algorithm}</div>
          <div>{hostKey.fingerprint}</div>
        </div>
      ) : null}

      <p aria-live="polite" className="mt-3 text-sm leading-5 text-slate-600">
        {status}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {commands.map(({ command, label: commandLabel }) => (
          <button
            className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-400"
            disabled={busy || !hostKey?.trusted}
            key={command}
            onClick={() => void executeCommand(command)}
            type="button"
          >
            {busyAction === command ? '실행 중…' : commandLabel}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [bridgeCheck, setBridgeCheck] = useState<StatusMessage>(INITIAL_BRIDGE_CHECK);
  const [identity, setIdentity] = useState<SshIdentityResult>({ available: false });
  const [identityStatus, setIdentityStatus] = useState('Android Keystore 확인 중…');
  const [identityBusy, setIdentityBusy] = useState(false);
  const [output, setOutput] = useState('명령 결과가 여기에 표시됩니다.');

  useEffect(() => {
    let active = true;
    void PcControl.getSshIdentity()
      .then((result) => {
        if (!active) return;
        setIdentity(result);
        setIdentityStatus(
          result.available
            ? '앱 전용 개인키는 Android Keystore 안에 있습니다.'
            : '아직 앱 전용 SSH identity가 없습니다.',
        );
      })
      .catch((error: unknown) => {
        if (active) setIdentityStatus(describeError(error));
      });
    return () => {
      active = false;
    };
  }, []);

  async function checkNativeBridge() {
    setBridgeCheck({ message: '확인 중…', state: 'checking' });
    try {
      setBridgeCheck(bridgeMessage(await PcControl.getBridgeStatus()));
    } catch (error) {
      setBridgeCheck({ message: describeError(error), state: 'error' });
    }
  }

  async function ensureIdentity() {
    setIdentityBusy(true);
    setIdentityStatus('Android Keystore에서 키 준비 중…');
    try {
      const result = await PcControl.ensureSshIdentity();
      setIdentity(result);
      setIdentityStatus(
        result.created
          ? '새 앱 전용 SSH identity를 생성했습니다.'
          : '기존 identity를 불러왔습니다.',
      );
    } catch (error) {
      setIdentityStatus(describeError(error));
    } finally {
      setIdentityBusy(false);
    }
  }

  async function copyPublicKey() {
    try {
      await PcControl.copySshPublicKey();
      setIdentityStatus('공개키만 클립보드에 복사했습니다.');
    } catch (error) {
      setIdentityStatus(describeError(error));
    }
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-xl">
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            Android · Phase 1
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">PC Control SSH test</h1>
          <div className="mt-4 flex items-center gap-3 text-sm">
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium disabled:opacity-50"
              disabled={bridgeCheck.state === 'checking'}
              onClick={checkNativeBridge}
              type="button"
            >
              Native bridge test
            </button>
            <span className={bridgeCheck.state === 'error' ? 'text-red-700' : 'text-slate-600'}>
              {bridgeCheck.message}
            </span>
          </div>
        </header>

        <section className="mt-8 border-t border-slate-200 py-6">
          <h2 className="text-lg font-semibold">App-only SSH identity</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{identityStatus}</p>
          {identity.available && identity.publicKey ? (
            <>
              <p className="mt-3 font-mono text-xs text-slate-600">{identity.fingerprint}</p>
              <textarea
                aria-label="SSH public key"
                className="mt-3 h-28 w-full resize-none rounded-md border border-slate-300 bg-white p-3 font-mono text-xs leading-5"
                readOnly
                value={identity.publicKey}
              />
              <button
                className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
                onClick={copyPublicKey}
                type="button"
              >
                공개키 복사
              </button>
            </>
          ) : (
            <button
              className="mt-4 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-400"
              disabled={identityBusy}
              onClick={ensureIdentity}
              type="button"
            >
              {identityBusy ? '생성 중…' : '앱 전용 SSH identity 생성'}
            </button>
          )}
          <p className="mt-3 text-xs leading-5 text-slate-500">
            공개키를 Windows와 ASUS의 authorized_keys에 등록해야 인증할 수 있습니다. 개인키는
            복사하거나 표시하지 않습니다.
          </p>
        </section>

        <SshTargetPanel
          commands={WINDOWS_COMMANDS}
          defaultUsername={DEFAULT_PC_CONTROL_CONFIG.pc.sshUser}
          host={DEFAULT_PC_CONTROL_CONFIG.pc.host}
          label="Windows PC"
          onOutput={setOutput}
          port={DEFAULT_PC_CONTROL_CONFIG.pc.sshPort}
          target="windows"
        />

        <SshTargetPanel
          commands={ROUTER_COMMANDS}
          host={DEFAULT_PC_CONTROL_CONFIG.router.host}
          label="ASUS router"
          onOutput={setOutput}
          port={DEFAULT_PC_CONTROL_CONFIG.router.sshPort}
          target="router"
        />

        <section className="border-t border-slate-200 py-6">
          <h2 className="text-lg font-semibold">Command output</h2>
          <pre
            aria-live="polite"
            className="mt-3 min-h-28 overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100"
          >
            {output}
          </pre>
        </section>
      </div>
    </main>
  );
}
