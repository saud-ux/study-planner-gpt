# Netlify Deployment

This app is ready to publish on Netlify as a public link. The frontend is static React, and OpenAI runs through Netlify Functions so the API key is never exposed in browser code.

## Deploy Settings

Use these settings in Netlify:

- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

These are already defined in `netlify.toml`, so Netlify should detect them automatically.

## Environment Variables

In Netlify, open:

Site configuration -> Environment variables

Add:

```text
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.4-mini
```

`OPENAI_MODEL` is optional. If you omit it, the function uses `gpt-5.4-mini`.

## Public Link

After deploying, Netlify gives you a public URL. Anyone with that link can open the app. User planner data is stored in that user's browser localStorage, while schedule generation calls your private Netlify Function.

## Local Development

Run the backend:

```bash
npm run dev
```

Run the React app:

```bash
npm run dev:client
```

Open:

```text
http://127.0.0.1:5173
```
