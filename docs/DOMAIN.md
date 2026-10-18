# Public domain

Teach Stu is served by **Vercel** (project `ai-hackathon-2026`) at **https://www.brodidnot.study**. The bare domain `https://brodidnot.study` permanently redirects (308) to `www`. The Vercel address `https://ai-hackathon-2026-two.vercel.app` serves the same Production deployment.

The domain is registered at Porkbun, which manages its DNS:

| Type | Host | Value | Purpose |
| --- | --- | --- | --- |
| A | blank | `76.76.21.21` | Route the bare domain to Vercel |
| CNAME | `www` | `cname.vercel-dns.com` | Route `www` to Vercel |
| TXT | blank | `hosting-site=ai-la-hackathon-2026` | Left over from Firebase Hosting; harmless, safe to delete |

Do not add other root A/AAAA records or other `www` records; they make Vercel report an invalid configuration. Both domains are configured in Vercel under **Settings → Domains**, which also issues the HTTPS certificates. No Porkbun or Vercel credentials belong in this repository.

Vercel needs `STEPFUN_API_KEY` and a stable random `SESSION_SECRET` in its Production environment variables. Production deploys from `main`; a preview can be promoted from the Vercel dashboard while a PR waits for review.

History: the site was first a static Firebase Hosting build (`ai-la-hackathon-2026.web.app`), which could not run the `/api` server without a paid plan. On 2026-10-18 DNS moved to Vercel. The Firebase hostnames still redirect browsers to `brodidnot.study` via the script in `index.html`.

Verified on 2026-10-18: Porkbun's nameservers and 1.1.1.1 returned the A and CNAME records above, `https://www.brodidnot.study/api/health` returned `{"ok":true}` from Vercel with a valid certificate, and `https://brodidnot.study` returned a 308 to `www`.
