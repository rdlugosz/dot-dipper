// Client-side AI image generation via Pollinations.ai (no backend).
//
// Pollinations' anonymous tier is heavily rate-limited (roughly one image every
// 15 seconds) and may add a small watermark. Passing a `referrer` is the
// documented way for keyless web apps to use it. For more reliable, watermark-
// free results, register a FREE token at https://auth.pollinations.ai and paste
// it below — it unlocks the "seed" tier (about one image every 5 seconds).
const POLLINATIONS_TOKEN = 'sk_3bFrcN8CA522T25Pq5Iqk2RZq99R0ANB'; // free seed-tier token

const REFERRER = (typeof location !== 'undefined' && location.hostname) || 'dot-dipper';
const delay = ms => new Promise(r => setTimeout(r, ms));

// Reads an image off the system clipboard (e.g. after copying a picture from a
// web page or the photos app), avoiding a save-to-files round trip.
export async function clipboardToImage() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    throw new Error('Pasting isn\'t supported in this browser — try "Upload photo" instead.');
  }
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error('Couldn\'t read the clipboard. Copy an image first, then allow clipboard access.');
  }
  for (const item of items) {
    const type = item.types.find(t => t.startsWith('image/'));
    if (type) return blobToImage(await item.getType(type));
  }
  throw new Error('No image found on the clipboard. Copy a picture first, then tap Paste.');
}

export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that file.')); };
    img.src = url;
  });
}

export async function generateImage(prompt, { size = 640, seed } = {}) {
  // Steer toward kid-friendly, simple imagery and enable the provider's safe flag.
  const styled = `${prompt}, cute, colorful, simple bold shapes, children's illustration, clip art style, plain background`;
  const params = new URLSearchParams({
    width: size, height: size, nologo: 'true', safe: 'true',
    seed: seed ?? Math.floor(Math.random() * 1e6), referrer: REFERRER,
  });
  if (POLLINATIONS_TOKEN) params.set('token', POLLINATIONS_TOKEN);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?${params}`;

  const headers = { Accept: 'image/*' };
  if (POLLINATIONS_TOKEN) headers.Authorization = `Bearer ${POLLINATIONS_TOKEN}`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await delay(5000); // wait out the per-IP rate window, then retry
    try {
      const resp = await fetch(url, { headers });
      // 402 (the "x402" pay/queue wall) and 429 both mean "rate-limited, retry".
      if (resp.status === 402 || resp.status === 429) { lastErr = rateError(); continue; }
      if (!resp.ok) throw new Error(`The image service returned an error (${resp.status}).`);
      const blob = await resp.blob();
      if (!blob.type.startsWith('image/')) { lastErr = rateError(); continue; }
      return await blobToImage(blob);
    } catch (e) {
      lastErr = e; // network hiccup — retry
    }
  }
  throw lastErr || new Error('Could not generate an image.');
}

function rateError() {
  const e = new Error('The free AI service is busy right now.');
  e.code = 'rate';
  return e;
}

function blobToImage(blob) {
  // A same-origin object URL — the canvas won't be tainted, so pixels are readable.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode the image.')); };
    img.src = url;
  });
}
