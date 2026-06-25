# Screen To Inner Time MVP

A free, personal-first meditation PWA that turns screen urges into master-guided inner practice.

## What is implemented

- Day Mode home screen with 15-minute primary sitting and 30-minute deep sitting.
- Close-Eyes Mode starts by default during a sitting.
- Day Mode can be enabled during a sitting for visible controls.
- Gentle pause before ending early.
- Before check-in: "What pulled me toward the screen?"
- After check-in: "How do I feel now?"
- Local practice logs, weekly stats, and screen-shift self-report.
- Local admin passcode, created on first admin visit.
- Admin audio upload, preview, publish/draft toggle, download backup, and delete.
- Audio-first PWA shell with manifest and service worker.

## Run locally

From this folder:

```bash
npm run dev
```

Open:

```text
http://localhost:4173/
```

Admin:

```text
http://localhost:4173/admin/media/
```

On first admin visit, create an owner passcode. It is stored locally in this browser.

Uploaded audio and admin data are runtime-only local files. They are intentionally not committed to GitHub:

- `media/uploads/`
- `data/admins.json`
- `data/media-catalog.json`

Use Admin > Media after running locally to upload permitted recordings again.

## Private MVP guardrails

- Upload only your own or permitted audio.
- Do not publicly host Vishvas, YouTube, or other third-party content without permission.
- Normal users cannot upload or download media in this MVP.
- Reflections and practice logs stay on the current device.
- This is a practice support tool, not medical or mental-health treatment.

## Production path

Before public launch, replace local-only admin/media storage with:

- Supabase Auth for owner/editor roles.
- Supabase Storage for private audio objects.
- Row-level security for media/session metadata.
- A permission workflow for source credits and public publishing.
- Optional user accounts only if cross-device sync becomes necessary.
