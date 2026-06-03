# Dot Dipper 💎

A calm, ad-free **diamond-dot / paint-by-number** game that runs entirely in the
browser — no backend, no accounts, no tracking. Built to be played on a phone.

## What it does

- **Library of pictures.** Keep several projects on the go; progress is saved
  automatically in the browser (localStorage).
- **Full-screen editor.** A zoomable, pannable grid of numbered "gem" cells.
  Pick a color and the cells that need it light up — tap or drag to fill them in.
  No mistakes possible, plus undo and an eraser.
- **Three ways to start a picture:**
  1. **📷 Upload a photo** from the device.
  2. **✨ AI image** — type a description and get a generated picture
     ([Pollinations.ai](https://pollinations.ai), keyless, safe filter on). The free
     anonymous tier is **rate-limited** (~1 image every 15s) and may watermark, so it
     can be slow or busy; the app retries and tells you to wait. For more reliable,
     watermark-free results, paste a free token (see below).
  3. **🖼️ Samples** — built-in pictures that work fully offline.
- Any image is automatically **posterized** (resized + color-reduced via
  median-cut quantization) into a dot grid. You choose the size and number of colors.
- **Installable (PWA).** Add it to a phone's home screen and it works offline.

## Play it on a phone

It's a static site, so GitHub Pages hosts it for free.

1. Merge this branch into `main`.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   (The included workflow at `.github/workflows/pages.yml` deploys on every push to `main`.)
3. Wait for the **Deploy to GitHub Pages** action to finish, then open the URL it
   prints (typically `https://<user>.github.io/dot-dipper/`).
4. On the phone, open that URL in the browser and choose **"Add to Home Screen."**

> Prefer the simpler classic Pages? You can instead set Source to
> "Deploy from a branch" → `main` / root. The site lives at the repo root, so no
> build step is needed either way.

## Run locally

Because it uses ES modules and a service worker, serve it over HTTP (not `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## How it's built

Plain HTML/CSS/vanilla-JS ES modules — no framework, no build step.

| File | Role |
| --- | --- |
| `index.html` / `css/styles.css` | App shell and styling |
| `js/app.js` | Home screen + new-picture flow + routing |
| `js/editor.js` | Zoom/pan grid, gem placement, palette, progress, confetti |
| `js/process.js` | Image → grid (resize + posterize) |
| `js/quantize.js` | Median-cut color quantization |
| `js/samples.js` | Built-in offline sample pictures |
| `js/ai.js` | Photo upload + keyless AI generation |
| `js/storage.js` | Project persistence (localStorage) |
| `sw.js` / `manifest.json` | Offline support + installable PWA |

## Making AI generation more reliable (optional, free)

Pollinations' anonymous tier is throttled and occasionally returns a
rate-limit/payment wall. To get faster, watermark-free generation for free:

1. Register an app at **https://auth.pollinations.ai** (GitHub login) to get a token.
2. Paste it into `POLLINATIONS_TOKEN` at the top of `js/ai.js`.

The token sits in client code (it's a free-tier token, so the risk is low). If you'd
rather not bother, the photo-upload and sample options always work with no setup.

## A note for grown-ups

The AI image option uses a free, public generation service with its `safe` flag
enabled and kid-friendly prompt styling. It is **not** a closed/curated system,
so occasionally results can be unexpected — worth a glance. The photo-upload and
sample options make no external requests at all.
