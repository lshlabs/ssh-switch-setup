import { useEffect, useRef, useState } from 'react';
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { PcControl } from '@pc-control/capacitor-pc-control';
import { confirmationCode, parsePairingBootstrap, parsePairingStatus, type PairedPcInfo } from '@pc-control/pairing-protocol';

/** Secure setup is isolated from the existing manual/WOL/VPN onboarding. */
export function SetupPairing({ onPaired, onComplete, onBusy }: { onPaired: (info: PairedPcInfo) => Promise<void>; onComplete: () => void; onBusy: (value: boolean) => void }) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState('Windows Setup의 QR을 스캔하거나 전체 JSON을 붙여 넣으세요.');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const active = useRef<{ endpoint: string; requestId: string; requestSecret: string } | null>(null);
  const mounted = useRef(true);
  async function cancel() {
    generation.current++;
    const session = active.current; active.current = null;
    if (session) await PcControl.cancelSetupPairing(session).catch(() => undefined);
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void cancel(); };
  }, []);
  async function pair(raw: string) {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    const run = ++generation.current;
    const check = () => { if (!mounted.current || generation.current !== run) throw new Error('페어링을 중단했습니다.'); };
    try {
      const bootstrap = parsePairingBootstrap(JSON.parse(raw));
      const identity = await PcControl.ensureSshIdentity(); check();
      if (!identity.publicKey) throw new Error('SSH 공개키를 생성하지 못했습니다.');
      const response = await PcControl.startSetupPairing({
        endpoint: bootstrap.pairingEndpoint, oneTimeToken: bootstrap.oneTimeToken,
        tlsCertificateFingerprint: bootstrap.tlsCertificateFingerprint, deviceName: 'Android PC Control',
      });
      active.current = { endpoint: bootstrap.pairingEndpoint, requestId: response.started.requestId, requestSecret: response.requestSecret };
      check();
      const code = await confirmationCode(bootstrap.oneTimeToken, identity.publicKey, bootstrap.pairingIdentityFingerprint);
      if (code !== response.started.confirmationCode) throw new Error('확인 코드가 다릅니다.');
      setMessage(`Windows 화면의 코드 ${code}와 비교한 후 PC에서 등록을 승인하세요.`);
      while (Date.now() < bootstrap.expiresAt) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); check();
        const session = active.current!;
        const status = parsePairingStatus((await PcControl.getSetupPairingStatus(session)).status); check();
        if (status.requestId !== session.requestId) throw new Error('페어링 요청이 일치하지 않습니다.');
        if (status.state === 'pending' || status.state === 'registering') continue;
        if (status.state !== 'verifying') throw new Error(`페어링 상태: ${status.state}`);
        const info = status.pc;
        if (info.hostId !== bootstrap.hostId || info.currentLanIp !== new URL(bootstrap.pairingEndpoint).hostname || info.sshHostKeyFingerprint !== bootstrap.pairingIdentityFingerprint) throw new Error('PC 보안 정보가 일치하지 않습니다.');
        setMessage('호스트 키 확인 및 실제 SSH 공개키 인증 중…');
        const scanned = await PcControl.scanSshHostKey({ host: info.currentLanIp, port: info.sshPort }); check();
        if (scanned.fingerprint !== info.sshHostKeyFingerprint) throw new Error('SSH 호스트 키가 다릅니다. 연결을 차단했습니다.');
        const result = await PcControl.executeSshCommand({
          target: 'windows', host: info.currentLanIp, port: info.sshPort, username: info.sshUsername,
          temporaryHostKeyAlgorithm: scanned.algorithm, temporaryHostKeyFingerprint: scanned.fingerprint,
          expectedHostFingerprint: scanned.fingerprint, command: 'hostname', connectTimeoutMs: 10000, commandTimeoutMs: 5000,
        }); check();
        if (result.exitCode !== 0) throw new Error('SSH 인증 테스트 실패');
        const proof = await PcControl.completeSetupPairing({ ...session, challenge: status.challenge }); check();
        if (!proof.result.verified) throw new Error('키 소유 증명 실패');
        await PcControl.trustSshHostKey({ host: info.currentLanIp, port: info.sshPort, algorithm: scanned.algorithm, fingerprint: scanned.fingerprint }); check();
        await onPaired(info); check();
        const done = await PcControl.finalizeSetupPairing(session);
        if (!done.result.completed) throw new Error('Windows 등록 확정 실패. 다시 페어링하세요.');
        active.current = null;
        onComplete();
        setMessage('SSH 인증 및 페어링 완료. 아래 계속 버튼으로 설정을 이어가세요.');
        return;
      }
      throw new Error('페어링이 만료되었습니다. PC에서 새 QR을 생성하세요.');
    } catch (error) {
      await cancel();
      if (mounted.current) setMessage(error instanceof Error ? error.message : '페어링 실패');
    } finally { if (mounted.current) { setBusy(false); onBusy(false); } }
  }
  async function scan() {
    try {
      const result = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
      if (result.barcodes[0]?.rawValue) await pair(result.barcodes[0].rawValue);
    } catch { setMessage('QR 스캔을 사용할 수 없습니다. PC의 JSON을 붙여 넣거나 수동 설정을 사용하세요.'); }
  }
  return <section aria-label="Windows HTTPS 페어링">
    <button type="button" disabled={busy} onClick={() => void scan()}>Windows QR 스캔</button>
    <textarea aria-label="Windows 페어링 JSON" value={text} onChange={(event) => setText(event.target.value)} disabled={busy} maxLength={8192} />
    <button type="button" disabled={busy || !text.trim()} onClick={() => void pair(text)}>JSON으로 페어링</button>
    {busy && <button type="button" onClick={() => void cancel()}>페어링 중단</button>}
    <p role="status">{message}</p>
  </section>;
}
