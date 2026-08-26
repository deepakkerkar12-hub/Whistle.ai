# Whistle.ai

## Vision extraction setup

This app uses a server-side OpenAI Vision call. Never add `OPENAI_API_KEY` to `app.js`, `index.html`, or a browser setting.

1. Deploy this folder to Vercel (or another Node serverless host that supports the `api/extract.js` route).
2. Add `OPENAI_API_KEY` as an environment variable in the host's project settings.
3. Open the deployed URL and upload the front and back pack images.

The endpoint sends the two user-selected pack images to the OpenAI Responses API with `store: false` and requests strict structured JSON. No uploaded images are written to a database by this project.
