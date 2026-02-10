## IP Viewer (Persian RTL)

### Run

```bash
npm install
npm run dev
```

### Google Maps mode

Map is rendered in Google Embed mode using fetched latitude/longitude.\
No API key is required.

### IP info API

Detailed fields (ISP, city, country, coordinates) use `ipwho.is` (no key).

### Build

```bash
npm run lint
npm run build
```

### Deploy to Netlify

1. Connect the `ip-fa` project to Netlify.
2. Build command: `npm run build`
3. Publish directory: `out`

`netlify.toml` is already configured with the same build/publish defaults.
