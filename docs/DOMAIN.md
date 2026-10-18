# Public domain

The study companion website is hosted at **https://brodidnot.study** by Firebase Hosting. Its Firebase project and Hosting site are both `ai-la-hackathon-2026`. The Firebase-provided address, https://ai-la-hackathon-2026.web.app, remains available.

The domain is registered at Porkbun, which manages its DNS. For the root domain, Porkbun's **Host** field is blank:

| Type | Host | Value | Purpose |
| --- | --- | --- | --- |
| A | blank | `199.36.158.100` | Route the website to Firebase Hosting |
| TXT | blank | `hosting-site=ai-la-hackathon-2026` | Prove ownership and allow certificate renewal |

Keep the TXT record. Do not add other root A or AAAA records pointing to another host. The `www` subdomain has not been connected; this setup covers `brodidnot.study` only.

The custom-domain connection is configured in the Firebase Hosting project and the records are configured at Porkbun. `firebase.json` deploys the website but does not create or update either service's domain settings. No Porkbun or Firebase credentials belong in this repository.

Verified on 2026-10-17: Porkbun published the A and TXT records above, and `https://brodidnot.study` returned HTTP 200 with the Miso page title. This is the Hosting-only preview; interactive study and voice still require the Express API to be deployed.
