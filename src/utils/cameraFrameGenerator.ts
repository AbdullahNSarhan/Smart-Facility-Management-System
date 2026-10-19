/**
 * Generates an air-gapped local JPEG frame (data:image/jpeg) representing
 * the live camera capture from Node 3 (ip_node3) when direct LAN hardware
 * is unreachable or in local simulation mode.
 */
export interface CameraFrameOptions {
  ipNode3: string;
  mode: 'STANDBY' | 'MOTION' | 'FACE_VERIFIED' | 'UNAUTHORIZED';
  subjectName?: string;
  confidence?: number;
  timestamp: string;
  doorState: 'OPEN' | 'CLOSED';
}

export function generateBiometricCameraJpeg(opts: CameraFrameOptions): string {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. Background: Architectural server airlock vestibule perspective
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 540);
  bgGrad.addColorStop(0, '#070D19');
  bgGrad.addColorStop(0.55, '#0F192A');
  bgGrad.addColorStop(1, '#09101D');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 960, 540);

  // Subtle architectural perspective lines (corridor walls, ceiling grid, airlock door frame)
  ctx.strokeStyle = 'rgba(0, 210, 255, 0.10)';
  ctx.lineWidth = 1;

  // Perspective corridor lines
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(240, 110);
  ctx.moveTo(960, 0);
  ctx.lineTo(720, 110);
  ctx.moveTo(0, 540);
  ctx.lineTo(240, 440);
  ctx.moveTo(960, 540);
  ctx.lineTo(720, 440);
  ctx.stroke();

  // Inner airlock bulkhead door frame
  ctx.fillStyle = '#0B1322';
  ctx.fillRect(240, 110, 480, 330);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(240, 110, 480, 330);

  // Server rack vertical LED columns visible through armored glass panel
  ctx.fillStyle = '#060A12';
  ctx.fillRect(310, 140, 340, 270);
  ctx.strokeStyle = 'rgba(0, 210, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(310, 140, 340, 270);

  for (let r = 0; r < 4; r++) {
    const rx = 340 + r * 75;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(rx, 155, 52, 240);
    for (let y = 168; y < 380; y += 16) {
      ctx.fillStyle = (y + r * 8) % 32 === 0 ? 'rgba(0, 245, 155, 0.55)' : 'rgba(0, 210, 255, 0.35)';
      ctx.fillRect(rx + 6, y, 8, 3);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.15)';
      ctx.fillRect(rx + 20, y, 24, 2);
    }
  }

  // Magnetic Reed & Solenoid status indicator on doorframe
  const isDoorClosed = opts.doorState === 'CLOSED';
  ctx.fillStyle = isDoorClosed ? 'rgba(0, 245, 155, 0.85)' : 'rgba(255, 46, 84, 0.9)';
  ctx.fillRect(450, 116, 60, 8);

  // 2. Subject rendering when in MOTION, FACE_VERIFIED, or UNAUTHORIZED state
  if (opts.mode !== 'STANDBY') {
    // Subtle ambient rim glow behind subject
    const subjGlow = ctx.createRadialGradient(480, 270, 20, 480, 270, 190);
    if (opts.mode === 'FACE_VERIFIED') {
      subjGlow.addColorStop(0, 'rgba(0, 245, 155, 0.22)');
    } else if (opts.mode === 'UNAUTHORIZED') {
      subjGlow.addColorStop(0, 'rgba(255, 46, 84, 0.22)');
    } else {
      subjGlow.addColorStop(0, 'rgba(0, 210, 255, 0.20)');
    }
    subjGlow.addColorStop(1, 'rgba(7, 13, 25, 0)');
    ctx.fillStyle = subjGlow;
    ctx.fillRect(260, 100, 440, 380);

    // Engineer torso & shoulders silhouette
    ctx.fillStyle = '#162238';
    ctx.beginPath();
    ctx.moveTo(355, 460);
    ctx.quadraticCurveTo(365, 345, 435, 335);
    ctx.lineTo(525, 335);
    ctx.quadraticCurveTo(595, 345, 605, 460);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Lanyard & smart badge on chest
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.65)';
    ctx.beginPath();
    ctx.moveTo(455, 335);
    ctx.lineTo(480, 395);
    ctx.lineTo(505, 335);
    ctx.stroke();
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(464, 395, 32, 44);
    ctx.strokeStyle = '#00F59B';
    ctx.strokeRect(464, 395, 32, 44);

    // Head & facial contour
    ctx.fillStyle = '#1E2D4A';
    ctx.beginPath();
    ctx.ellipse(480, 245, 52, 66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = opts.mode === 'FACE_VERIFIED' ? '#00F59B' : opts.mode === 'UNAUTHORIZED' ? '#FF2E54' : '#00D2FF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Biometric 68-point style geometric mesh overlay on face
    ctx.strokeStyle = opts.mode === 'FACE_VERIFIED'
      ? 'rgba(0, 245, 155, 0.65)'
      : opts.mode === 'UNAUTHORIZED'
      ? 'rgba(255, 46, 84, 0.65)'
      : 'rgba(0, 210, 255, 0.65)';
    ctx.lineWidth = 1;

    const landmarks: [number, number][] = [
      [458, 228], [502, 228], // Eyes
      [480, 250],             // Nose bridge
      [464, 276], [496, 276], // Mouth corners
      [440, 240], [520, 240], // Cheekbones
      [480, 202],             // Forehead center
      [480, 298],             // Chin
    ];

    // Connect mesh triangles
    const edges: [number, number][] = [
      [7, 0], [7, 1], [0, 1], [0, 2], [1, 2],
      [5, 0], [6, 1], [5, 3], [6, 4], [2, 3],
      [2, 4], [3, 4], [3, 8], [4, 8], [5, 2], [6, 2]
    ];
    ctx.beginPath();
    edges.forEach(([a, b]) => {
      ctx.moveTo(landmarks[a][0], landmarks[a][1]);
      ctx.lineTo(landmarks[b][0], landmarks[b][1]);
    });
    ctx.stroke();

    // Landmark nodes
    ctx.fillStyle = opts.mode === 'FACE_VERIFIED' ? '#00F59B' : '#00D2FF';
    landmarks.forEach(([lx, ly]) => {
      ctx.beginPath();
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Target bounding box around face
    const boxColor = opts.mode === 'FACE_VERIFIED' ? '#00F59B' : opts.mode === 'UNAUTHORIZED' ? '#FF2E54' : '#00D2FF';
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 2;
    const bx = 405, by = 160, bw = 150, bh = 175, corner = 18;

    // Corner brackets
    ctx.beginPath();
    // Top-left
    ctx.moveTo(bx, by + corner); ctx.lineTo(bx, by); ctx.lineTo(bx + corner, by);
    // Top-right
    ctx.moveTo(bx + bw - corner, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + corner);
    // Bottom-left
    ctx.moveTo(bx, by + bh - corner); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + corner, by + bh);
    // Bottom-right
    ctx.moveTo(bx + bw - corner, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - corner);
    ctx.stroke();

    // Label below bounding box
    ctx.fillStyle = 'rgba(7, 13, 25, 0.88)';
    ctx.fillRect(bx, by + bh + 8, bw + 60, 26);
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by + bh + 8, bw + 60, 26);

    ctx.fillStyle = boxColor;
    ctx.font = '600 12px monospace';
    const labelText =
      opts.mode === 'FACE_VERIFIED'
        ? `MATCH: ${opts.subjectName || 'ENG_SARHAN'} (${(opts.confidence ?? 99.4).toFixed(1)}%)`
        : opts.mode === 'UNAUTHORIZED'
        ? 'UNREGISTERED BIOMETRIC VECTOR'
        : 'MOTION DETECTED · ANALYZING';
    ctx.fillText(labelText, bx + 8, by + bh + 25);
  } else {
    // Standby reticle in center
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(480, 270, 36, 0, Math.PI * 2);
    ctx.moveTo(430, 270); ctx.lineTo(460, 270);
    ctx.moveTo(500, 270); ctx.lineTo(530, 270);
    ctx.moveTo(480, 220); ctx.lineTo(480, 250);
    ctx.moveTo(480, 290); ctx.lineTo(480, 320);
    ctx.stroke();

    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.font = '500 12px monospace';
    ctx.fillText('OPTICAL SENSOR STANDBY · AWAITING PIR MOTION TRIGGER', 295, 335);
  }

  // 3. Top & Bottom Optical Camera OSD (On-Screen Display) Scrim
  ctx.fillStyle = 'rgba(5, 10, 20, 0.78)';
  ctx.fillRect(0, 0, 960, 38);
  ctx.fillRect(0, 502, 960, 38);

  ctx.fillStyle = '#E2E8F0';
  ctx.font = '600 13px monospace';
  ctx.fillText(`CAM_03 · FACE RECOGNITION NODE [${opts.ipNode3}]`, 18, 24);

  ctx.fillStyle = '#00D2FF';
  ctx.fillText(`RES: 1920x1080 · MJPEG · DOOR: ${opts.doorState}`, 620, 24);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 12px monospace';
  ctx.fillText(`FRAME TS: ${opts.timestamp}`, 18, 525);

  const statusColor =
    opts.mode === 'FACE_VERIFIED' ? '#00F59B' : opts.mode === 'UNAUTHORIZED' ? '#FF2E54' : '#00D2FF';
  ctx.fillStyle = statusColor;
  ctx.fillText(`STATE: ${opts.mode}`, 740, 525);

  return canvas.toDataURL('image/jpeg', 0.92);
}
