// Keyless, client-side AI image generation via Pollinations.ai.
// No API key and no backend: we just request an image URL and load it with CORS
// enabled so its pixels can be read for posterizing.

export function loadImage(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the image.'));
    img.src = src;
  });
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

export function generateImage(prompt, { size = 640, seed } = {}) {
  // Steer toward kid-friendly, simple imagery and enable the provider's safe flag.
  const styled = `${prompt}, cute, colorful, simple bold shapes, children's illustration, clip art style, plain background`;
  const s = seed ?? Math.floor(Math.random() * 1e6);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}`
    + `?width=${size}&height=${size}&nologo=true&safe=true&seed=${s}`;
  return loadImage(url, true);
}
