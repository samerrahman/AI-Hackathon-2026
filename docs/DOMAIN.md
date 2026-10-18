# Public domain

The study companion website is hosted at **https://brodidnot.study** by Firebase Hosting. Its Firebase project and Hosting site are both `ai-la-hackathon-2026`. The Firebase-provided `web.app` and `firebaseapp.com` addresses load the same Hosting release, then redirect browsers to `brodidnot.study`.

The domain is registered at Porkbun, which manages its DNS. For the root domain, Porkbun's **Host** field is blank:

| Type | Host | Value | Purpose |
| --- | --- | --- | --- |
| A | blank | `199.36.158.100` | Route the website to Firebase Hosting |
| TXT | blank | `hosting-site=ai-la-hackathon-2026` | Prove ownership and allow certificate renewal |

Keep the TXT record. Do not add other root A or AAAA records pointing to another host. The `www` subdomain has not been connected; this setup covers `brodidnot.study` only.

The custom-domain connection is configured in the Firebase Hosting project and the records are configured at Porkbun. `firebase.json` deploys the website but does not create or update either service's domain settings. No Porkbun or Firebase credentials belong in this repository.

Firebase's generated addresses cannot be removed from the default Hosting site. The redirect in `index.html` makes `brodidnot.study` the browser-facing address; it is a browser redirect, so direct HTTP requests to Firebase's addresses still receive the site's HTML. Saved notes are stored separately by browsers for each domain and do not transfer automatically.

Verified on 2026-10-17: Porkbun published the A and TXT records above, and `https://brodidnot.study` returned HTTP 200. The Firebase Hosting build serves Lucy's Teach Stu frontend as a preview with local note browsing. Interactive study, sample conversations, and voice still require the Express API to be deployed.
