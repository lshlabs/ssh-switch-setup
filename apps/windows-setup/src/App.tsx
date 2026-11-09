import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import QRCode from 'qrcode';
import type { PairingBootstrap, PairedPcInfo } from '@pc-control/pairing-protocol';

type PcInfo = PairedPcInfo & { accounts: string[]; sshInstalled: boolean; adapterName?: string };
type PendingRequest = {
  requestId: string;
  deviceName: string;
  sshPublicKeyFingerprint: string;
  confirmationCode: string;
  expiresAt: number;
};
type PairingView = {
  bootstrap: PairingBootstrap;
  pending?: PendingRequest;
  paired?: string;
  completed: boolean;
  phase:
    | 'pending'
    | 'registering'
    | 'verifying'
    | 'verified'
    | 'completed'
    | 'cancelling'
    | 'cancelled'
    | 'rejected'
    | 'expired'
    | 'failed';
};

export default function App() {
  const [info, setInfo] = useState<PcInfo>();
  const [selectedUser, setSelectedUser] = useState('');
  const [pairing, setPairing] = useState<PairingView>();
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pairingActive = pairing !== undefined;
  const closingRef = useRef(false);
  const completedAt = useRef<number | null>(null);

  useEffect(() => {
    void invoke<PcInfo>('get_pc_connection_info')
      .then((value) => {
        setInfo(value);
        setSelectedUser(value.sshUsername);
      })
      .catch((reason: unknown) => setError(String(reason)));
  }, []);

  useEffect(() => {
    if (!pairingActive) return;
    const timer = window.setInterval(() => {
      void invoke<PairingView>('get_pairing_state')
        .then((value) => {
          if (value.completed && completedAt.current === null) completedAt.current = Date.now();
          if (
            value.completed &&
            completedAt.current !== null &&
            Date.now() - completedAt.current >= 10_000 &&
            !closingRef.current
          ) {
            closingRef.current = true;
            void invoke('stop_pairing')
              .then(() => {
                setPairing(undefined);
                setQr('');
              })
              .catch((reason: unknown) => {
                setError(String(reason));
              });
          } else if (!value.completed) setPairing(value);
        })
        .catch(() => {});
    }, 800);
    return () => window.clearInterval(timer);
  }, [pairingActive]);

  async function prepare() {
    setBusy(true);
    setError('');
    try {
      await invoke('prepare_openssh');
      setInfo(await invoke<PcInfo>('get_pc_connection_info'));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError('');
    try {
      const state = await invoke<PairingView>('start_pairing', { sshUsername: selectedUser });
      closingRef.current = false;
      completedAt.current = null;
      setPairing(state);
      setQr(
        await QRCode.toDataURL(JSON.stringify(state.bootstrap), {
          errorCorrectionLevel: 'M',
          width: 256,
          margin: 2,
        }),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function decide(approved: boolean) {
    if (!pairing?.pending) return;
    setBusy(true);
    setError('');
    try {
      await invoke('decide_pairing', { requestId: pairing.pending.requestId, approved });
      setPairing(await invoke<PairingView>('get_pairing_state'));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError('');
    try {
      await invoke('stop_pairing');
      setPairing(undefined);
      setQr('');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError('');
    try {
      await invoke('revoke_pairing');
      await invoke('stop_pairing');
      setPairing(undefined);
      setQr('');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8">
        <p className="text-sm text-sky-700">PC Control for Windows</p>
        <h1 className="text-3xl font-semibold">휴대폰과 PC 연결</h1>
      </header>
      {error && (
        <div role="alert" className="mb-6 rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}
      {!info ? (
        <p>PC 정보를 확인하고 있어요…</p>
      ) : (
        <>
          <section className="mb-6 rounded-2xl border p-5">
            <h2 className="mb-3 text-lg font-semibold">PC 준비</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>PC</dt>
              <dd>{info.displayName}</dd>
              <dt>LAN 주소</dt>
              <dd>{info.currentLanIp}</dd>
              <dt>SSH 포트</dt>
              <dd>{info.sshPort}</dd>
              <dt>SSH 서버</dt>
              <dd>{info.sshInstalled ? '설치됨' : '설치 필요'}</dd>
              <dt>유선 어댑터</dt>
              <dd>{info.adapterName ?? '확인 필요'}</dd>
              <dt>MAC 후보</dt>
              <dd>{info.macAddressCandidate ?? '확인 필요'}</dd>
            </dl>
            <button
              type="button"
              className="action mt-4"
              disabled={busy}
              onClick={() => void prepare()}
            >
              OpenSSH 준비
            </button>
          </section>
          <section className="rounded-2xl border p-5">
            <h2 className="mb-3 text-lg font-semibold">연결 허용</h2>
            <label className="block text-sm">
              PC Control에서 사용할 Windows 계정
              <select
                className="mt-2 w-full rounded-lg border p-2"
                value={selectedUser}
                disabled={Boolean(pairing)}
                onChange={(event) => setSelectedUser(event.target.value)}
              >
                {info.accounts.map((user) => (
                  <option key={user} value={user}>
                    {user}
                  </option>
                ))}
              </select>
            </label>
            {!pairing ? (
              <button
                type="button"
                className="action mt-4"
                disabled={busy || !info.sshInstalled}
                onClick={() => void start()}
              >
                페어링 시작
              </button>
            ) : (
              <>
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 font-medium">
                      휴대폰 앱에서 이 PC를 선택하거나 QR을 스캔하세요.
                    </p>
                    <p className="text-sm text-gray-600">두 방법을 동시에 사용할 수 있어요.</p>
                    <p className="mt-2 text-sm text-gray-600">
                      연결을 다시 시도하려면 페어링을 종료한 뒤 새로 시작하세요.
                    </p>
                  </div>
                  {qr && <img src={qr} alt="PC Control 페어링 QR 코드" className="w-64" />}
                </div>
                {pairing.pending && (
                  <div className="mt-5 rounded-xl bg-sky-50 p-4">
                    <p>{pairing.pending.deviceName}에서 연결을 요청했어요.</p>
                    <p className="my-3 text-3xl font-semibold tracking-wider">
                      {pairing.pending.confirmationCode}
                    </p>
                    <p className="mb-4 text-sm">
                      휴대폰에 같은 코드가 표시되는지 확인하세요. 연결 키 지문:{' '}
                      {pairing.pending.sshPublicKeyFingerprint}
                    </p>
                    <div className="flex gap-3">
                      <button type="button" disabled={busy} onClick={() => void decide(false)}>
                        거절
                      </button>
                      <button
                        type="button"
                        className="action"
                        disabled={busy}
                        onClick={() => void decide(true)}
                      >
                        연결 허용
                      </button>
                    </div>
                  </div>
                )}
                {pairing.phase === 'registering' && (
                  <p className="mt-5" role="status">
                    Windows 관리자 승인과 SSH 키 등록을 기다리고 있어요.
                  </p>
                )}
                {pairing.phase === 'cancelling' && (
                  <p className="mt-5" role="status">
                    등록한 연결 키를 취소하고 있어요.
                  </p>
                )}
                {pairing.phase === 'failed' && (
                  <div className="mt-5" role="alert">
                    <p>연결 키 등록 또는 정리에 실패했어요. 등록 취소를 다시 시도해주세요.</p>
                    <button type="button" disabled={busy} onClick={() => void revoke()}>
                      등록 취소 다시 시도
                    </button>
                  </div>
                )}
                {pairing.paired && (
                  <div className="mt-5 rounded-xl bg-green-50 p-4">
                    <p>
                      {pairing.paired}의 연결 키를 등록했어요. 휴대폰에서 연결 확인과 저장을
                      완료하세요.
                    </p>
                    <button
                      type="button"
                      className="mt-3 text-sm underline"
                      disabled={busy}
                      onClick={() => void revoke()}
                    >
                      이 휴대폰의 등록 취소
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="mt-5 text-sm underline"
                  onClick={() => void stop()}
                >
                  페어링 종료
                </button>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
