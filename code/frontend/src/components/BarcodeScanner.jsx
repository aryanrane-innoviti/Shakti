import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import Modal from './Modal.jsx';

// 1D symbologies commonly printed on device / SKU labels. Restricting the
// decoder to these (rather than every format) keeps it fast and avoids the
// camera locking onto an unintended 2D/QR code in frame.
const FORMATS_1D = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
];

/**
 * Camera-driven 1D barcode reader. Opens the rear camera, decodes a serial off
 * the physical label, and calls onDetected(text) once with the first good read
 * (the camera then stops). Falls back to a clear message if the camera is
 * blocked / unavailable — the caller still offers manual entry.
 */
export default function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  // Keep the latest callback without restarting the camera every render.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS_1D);
    const reader = new BrowserMultiFormatReader(hints);

    (async () => {
      try {
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current,
          (result, _err, ctrl) => {
            if (!active || !result) return; // _err is the per-frame "not found" — ignore
            const text = result.getText();
            if (text && text.trim()) {
              ctrl.stop();
              onDetectedRef.current(text.trim());
            }
          }
        );
        if (!active) { controls.stop(); return; }
        controlsRef.current = controls;
      } catch (e) {
        if (!active) return;
        const name = e && e.name;
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Camera permission was denied. Allow camera access (and use HTTPS), then try again — or type the serial manually.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No usable camera was found on this device. Type the serial manually instead.'
            : 'Could not start the camera. Type the serial manually instead.'
        );
      }
    })();

    return () => {
      active = false;
      try { controlsRef.current?.stop(); } catch { /* already stopped */ }
    };
  }, []);

  return (
    <Modal
      title="Scan barcode"
      onClose={onClose}
      actions={<button onClick={onClose}>Cancel</button>}
    >
      {error ? (
        <p style={{ color: 'crimson', margin: 0 }}>{error}</p>
      ) : (
        <>
          <p className="meta" style={{ marginTop: 0 }}>
            Point the rear camera at the 1D barcode on the device label. It captures automatically.
          </p>
          <div className="barcode-viewport">
            <video ref={videoRef} muted playsInline />
            <div className="barcode-reticle" />
          </div>
        </>
      )}
    </Modal>
  );
}
