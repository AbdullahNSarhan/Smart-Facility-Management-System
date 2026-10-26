import { isPrivateNodeIp } from '../validators/managementSchemas.js';
import { managementError } from './facilityManagement.js';

/** Fixed path + literal registered private IP. Redirects and oversized/non-JPEG bodies are rejected. */
export async function readCameraSnapshot(ip, fetchSnapshot = fetch, {port=80,path='/capture.jpg'} = {}) {
  if (!isPrivateNodeIp(ip)) throw managementError(409, 'CAMERA_ADDRESS_INVALID', 'Register a private LAN IPv4 address for Node 3');
  if(!Number.isInteger(port)||port<1||port>65535||!/^\/[a-zA-Z0-9_/-]+(?:\.(?:json|jpg))?$/.test(path))throw managementError(409,'CAMERA_ADDRESS_INVALID','Invalid registered camera port or path');
  let response;
  try {
    response = await fetchSnapshot(`http://${ip}${port===80?'':`:${port}`}${path}`, {
      redirect: 'manual', signal: AbortSignal.timeout(4000), headers: { Accept: 'image/jpeg' }
    });
    if (response.status !== 200 || !/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel();
      throw managementError(502, 'CAMERA_INVALID_RESPONSE', 'Camera must return a JPEG frame without redirects');
    }
    const maxBytes = 2 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw managementError(502, 'CAMERA_FRAME_TOO_LARGE', 'Camera frame exceeds 2 MiB');
    }
    const reader = response.body.getReader(), parts = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > maxBytes) throw managementError(502, 'CAMERA_FRAME_TOO_LARGE', 'Camera frame exceeds 2 MiB');
        parts.push(Buffer.from(chunk.value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const jpeg = Buffer.concat(parts);
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9)
      throw managementError(502, 'CAMERA_INVALID_JPEG', 'Camera returned an invalid JPEG envelope');
    return jpeg;
  } catch (err) {
    if (err.status && err.code) throw err;
    throw managementError(502, 'CAMERA_UNAVAILABLE', 'Camera is unavailable or the capture request timed out');
  }
}
