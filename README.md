# SIGNAL — Crypto Intelligence Terminal

Real-time token intelligence terminal powered by the Dexscreener API.

Live data: new pairs, gainers, volume leaders across SOL, ETH, BASE, BSC, ARB.

## Deploy to Vercel

### Option A: One-Click (Easiest)

1. Push this folder to a GitHub repo
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your repo
4. Vercel auto-detects Vite — just click **Deploy**
5. Done. You'll get a `.vercel.app` URL in ~60 seconds.

### Option B: Vercel CLI

```bash
# Install Vercel CLI globally
npm i -g vercel

# Navigate to this project folder
cd signal-terminal

# Install dependencies
npm install

# Test locally first
npm run dev

# Deploy to Vercel
vercel

# Follow the prompts:
#   - Set up and deploy? Y
#   - Which scope? (select your account)
#   - Link to existing project? N
#   - Project name: signal-terminal
#   - Directory: ./
#   - Override settings? N

# Deploy to production
vercel --prod
```

### Option C: Drag & Drop

1. Run `npm install && npm run build` locally
2. Go to [vercel.com/new](https://vercel.com/new)
3. Drag the `dist` folder onto the page
4. Done.

## Local Development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`

## Tech Stack

- **Vite** — Build tool
- **React 18** — UI
- **Dexscreener API** — Live market data (no API key needed)
- **Geist** — Typography (Vercel's typeface)

## API Endpoints Used

- `GET /token-profiles/latest/v1` — Latest token profiles
- `GET /token-boosts/latest/v1` — Boosted tokens  
- `GET /tokens/v1/{chain}/{addresses}` — Pair data by token address
- `GET /latest/dex/search?q={query}` — Search tokens

No API key required. Dexscreener's public API is rate-limited but generous for personal use.
