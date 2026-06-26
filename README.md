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
- Prime owner admin access, provisioned by the deployment owner.
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

Admin login is not self-service. The prime owner account must already exist in the local backend data, or be provisioned by starting the backend with `INNER_TIME_OWNER_NAME` and `INNER_TIME_OWNER_PASSCODE` environment variables on a clean data folder. Only the prime owner can assign other admins or reset assigned admin passcodes.

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

The production backend is prepared for Netlify + Supabase:

- Netlify hosts the static PWA and runs `/api/admins` and `/api/media` as serverless functions.
- Supabase Storage stores uploaded master audio in a private bucket.
- Netlify Blobs stores the small admin list and media catalog.
- The prime owner admin is provisioned only from Netlify environment variables.
- Browser uploads use a short-lived Supabase signed upload token, so large 15/30 minute files do not pass through the Netlify Function body.

### Netlify environment variables

Set these in Netlify > Site configuration > Environment variables:

```text
INNER_TIME_OWNER_NAME=Garima
INNER_TIME_OWNER_PASSCODE=<your private owner passcode>
INNER_TIME_SESSION_SECRET=<long random secret>
SUPABASE_URL=<your Supabase project URL>
SUPABASE_ANON_KEY=<your Supabase anon/publishable key>
SUPABASE_SERVICE_ROLE_KEY=<your Supabase service role key>
SUPABASE_STORAGE_BUCKET=inner-time-audio
```

Create a private Supabase Storage bucket named `inner-time-audio`. Do not expose the service role key in the browser or commit it to GitHub.

After deploying on Netlify, log in at `/admin/login/`, upload audio in `/admin/media/`, publish the recording, then confirm it appears in `/session/15/` or `/session/30/`.
