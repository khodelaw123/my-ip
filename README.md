# IP Viewer

A Next.js app that detects and displays your public IPv4/IPv6 address, ISP, city, country, and approximate map location.

## Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS

## Features

- IPv4 and IPv6 detection from multiple providers
<<<<<<< HEAD
- Server-side aggregation at `GET /api/network-intel` (client only calls internal API)
- Approximate location map using OpenStreetMap embed URL
=======
- Client-side aggregation with server fallback at `GET /api/network-intel`
- Approximate location map using Google Maps embed URL (no API key required)
>>>>>>> b94caad247085f28ad7e8ee381e8bb06d9156b14
- Provider failover with timeout and early-stop logic

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Available Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## Production Build

```bash
npm run lint
npm run build
npm run start
```

## API Notes

The server route `src/app/api/network-intel/route.ts` queries multiple public IP/geo providers (for example `ipify`, `ipwho.is`, `ipapi`, `ipinfo`, `ip.sb`, `freeipapi`) and merges the best available data.

No provider API keys are required in the current setup.

## Netlify

This project should be deployed as a Next.js runtime app (not static `out` export).

- Build command: `npm run build`
- Do not use `publish = "out"`
- If Netlify UI has a publish directory set to `out`, clear it so the Next.js runtime can handle output correctly.
