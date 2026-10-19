<div align="center">

# 🌐 IP Viewer

**Minimal, ultra-fast IP intelligence & geolocation aggregator.**  
Detects public IPv4/IPv6, ISP, ASN, approximate location coordinates, and connection topology in milliseconds.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react)](https://react.dev/)
[![PHP](https://img.shields.io/badge/PHP-8.1+-777BB4?style=flat-square&logo=php&logoColor=white)](https://www.php.net/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

---

## ✨ Highlights

- **⚡ Blazing Fast**: Parallel asynchronous querying with early-stop logic (sub-second response).
- **🛡️ 100% Free & Keyless**: Combines 15+ verified public endpoints with automatic failover. No API keys needed.
- **🌍 Resilient & Accessible**: Fully tested and optimized for all global networks, including Iranian ASNs (Irancell, MCI, Shatel, Asiatech).
- **🎯 Smart Proxy Isolation**: Detects client IP from CDN/proxy headers (`CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`) while preventing server-side datacenter leakage.
- **🧩 Clean Decoupled Stack**: Modern Next.js 16 frontend + PSR-4 compliant PHP micro-backend.

---

## 🏗️ Architecture

```
my-ip/
├── src/                          # Next.js 16 Frontend (React 19, Tailwind CSS)
│   ├── app/                      # App router & pages
│   └── lib/                      # Shared TypeScript types & helpers
├── backend/                      # PSR-4 PHP Backend
│   ├── public/                   # HTTP gateway & .htaccess rewrite rules
│   ├── src/                      # Models, Services, & Support classes
│   └── server.php                # CLI router for local development
├── netlify.toml                  # Production deployment & security headers
└── next.config.ts                # Next.js proxy rewrites to PHP backend
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** 20+
- **PHP** 8.1+ (with `curl` and `openssl` enabled)

### 2. Setup
```bash
# Clone the repository
git clone git@github.com:khodelaw123/my-ip.git
cd my-ip

# Install frontend dependencies
npm install
```

### 3. Run Locally

Open two terminal sessions:

```bash
# Terminal 1: Start the PHP backend (runs on http://127.0.0.1:8000)
npm run dev:backend

# Terminal 2: Start the Next.js frontend (runs on http://localhost:3000)
npm run dev
```

Visit [`http://localhost:3000`](http://localhost:3000) in your browser. Next.js automatically rewrites `/api/*` to the PHP backend.

---

## 📦 Production Build

```bash
npm run lint     # Lint check
npm run build    # Production build
npm run start    # Start production server
```

Deployable to **Netlify** or **Vercel** for the frontend, with the PHP backend running on any standard web host (Apache, Nginx, LiteSpeed, Docker, or cPanel).
