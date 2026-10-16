# Using Shared Clipboard on corporate and government networks

Findings from an access review on 2026-10-16. The site is
`https://hello-world.rayan65.workers.dev/`.

## Classifications: what was verified

| Source | Result | Status |
|---|---|---|
| Google Safe Browsing | "No unsafe content found" (updated 2026-10-16) | ✅ Verified |
| HSTS preload list | `workers.dev` is covered by the `.dev` preload, so browsers only connect over HTTPS | ✅ Verified |
| securityheaders.com | Grade **A** before this change. Permissions-Policy has since been added. | ✅ Verified |
| Fortinet FortiGuard | The public lookup returned HTTP 403 to automated access | ⚠️ Not verified |
| Broadcom/Symantec Site Review | Blocked by a CAPTCHA | ⚠️ Not verified |
| Cisco Talos | The lookup did not complete (bot challenge) | ⚠️ Not verified |
| Palo Alto Networks, Zscaler | Public lookups need a CAPTCHA or account login, so they weren't attempted | ⚠️ Not verified |

The automated checks didn't try to get past any CAPTCHA or access control. Each lookup below takes a few seconds by hand. Look up both `hello-world.rayan65.workers.dev` and `workers.dev`:

- Talos: https://talosintelligence.com/reputation_center/lookup?search=hello-world.rayan65.workers.dev
- FortiGuard: https://www.fortiguard.com/webfilter?q=hello-world.rayan65.workers.dev
- Symantec: https://sitereview.bluecoat.com/
- Palo Alto: https://urlfiltering.paloaltonetworks.com/
- Zscaler: https://sitereview.zscaler.com/

## How `workers.dev` is treated

**Documented:**
- `*.workers.dev` is a shared, free developer-hosting domain that is heavily abused for phishing. Researchers counted tens of thousands of phishing URLs on it over a few months.
- Security teams and filters therefore often treat the *whole* domain with suspicion, or block it outright, regardless of what an individual site does.

**Assumptions (not verified per vendor):**
- Individual subdomains often inherit the parent domain's category, typically something like "Information Technology", "Web Hosting" or "Newly Observed/Uncategorized".
- An accurate category for this service would be something like **Personal Storage / Online Storage / File Sharing**. Many enterprise policies block that category on purpose.

## What the site does to look like what it is

- **No impersonation:** a plain title and description, no brand imitation, and an explicit "personal tool; not affiliated with any company or service" note on the password screen.
- **Strict security headers:** CSP, HSTS, `nosniff`, no framing, no referrer, Permissions-Policy, COOP and CORP. JSON API responses carry `nosniff`, a deny-all CSP and CORP too.
- **Correct MIME types** for HTML, CSS, JS, SVG, PNG and JSON. No downloads, scripts from other origins, trackers or redirects.
- **`noindex, nofollow`**, so the tool doesn't appear in search results. Categorization crawlers can still read the page and its description.

## DLP and policy: blocking may be correct, not a false positive

The site exists to move text between devices, which is a classic data-exfiltration channel. Expect, and respect, these controls:

- **SSL inspection and DLP:** organisations with TLS inspection can read everything sent, including the clipboard text and the password in the `Authorization` header. Don't use a password you use anywhere else.
- **"Personal storage / file sharing" categories** are commonly blocked on purpose. A block in that category is the correct classification working as intended.
- **Clipboard and paste controls:** endpoint or browser DLP may block pasting sensitive data into any website. That applies regardless of domain.

The legitimate route is to ask your IT or security team for an exception, or to use your organisation's approved tool. Nothing in this project is designed to avoid inspection, DLP or monitoring.

## Custom domain: worth it?

**Helps:**
- Removes the shared-`workers.dev` reputation problem, so the site gets its own reputation.
- Easier for IT to allow-list a single host.
- Looks more trustworthy.

**Doesn't help:**
- A brand-new domain usually falls into "Newly Registered/Observed Domains", which strict policies block for roughly 30+ days.
- Once categorized correctly (personal storage), it is blocked wherever that category is blocked.

**Costs and setup:**
- About **$10–15/year**, e.g. a `.com` at cost through Cloudflare Registrar. Not purchased.
- Setup is a few dashboard steps: register or move DNS to Cloudflare, then add a *Custom Domain* to the `hello-world` Worker. Cloudflare issues the certificate automatically. No code change is needed, because the app uses relative URLs and same-origin auth.

**Verdict:** worth it only if you need IT to allow-list it, or if you see blocks specifically because of `workers.dev`. It won't get the site past deliberate personal-storage or DLP policies, and it shouldn't.

## Recategorization requests (drafts, not submitted)

Only submit these if a lookup shows an **inaccurate** category, such as *Phishing*, *Malicious* or *Malware*. Don't ask for a category that hides the site's purpose.

> **URL:** https://hello-world.rayan65.workers.dev/
> **Suggested category:** Personal Storage / Online Storage (or the provider's closest equivalent)
> **Description:** A single-user, password-protected web clipboard that lets the owner copy plain text between their own phone and computer. It hosts no downloads, no third-party content and no login for any other service, and it imitates no brand. Source code: https://github.com/rayan65/Hello-World/tree/master/clipboard

Official submission pages:
- Talos: https://talosintelligence.com/reputation_center/support (Web Categorization Requests)
- FortiGuard: https://www.fortiguard.com/faq/wfratingsubmit
- Symantec: https://sitereview.bluecoat.com/
- Palo Alto: https://urlfiltering.paloaltonetworks.com/ (Request Change)
- Zscaler: https://sitereview.zscaler.com/
