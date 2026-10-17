# Security review

Date: 2026-10-17. Scope: local source review and isolated release tests. This is not an independent penetration-test certification or an authorization to operate.

## Authentication and identity

`packages/core/src/auth.ts`, `passwords.ts`, `scripts/bootstrap.ts` and the initialization migration replace unauthenticated first-visitor setup. A server operator issues a random 256-bit token; only its SHA-256 digest and one-hour expiry are stored. Initialization locks a persistent singleton inside a PostgreSQL transaction, consumes the token, and permanently records completion. Deleting accounts cannot reopen setup. Legacy assessments require the operator's explicit `--adopt-legacy`; their project/organization ownership and original evidence remain unchanged. Existing installations with users are marked initialized by migration; an operator must audit those existing identities before exposure.

New passwords require 15–200 Unicode characters, normalize NFC, accept spaces, reject repeated and a small set of common/application secrets, and use asynchronous Argon2id (64 MiB, 3 iterations, 1 lane, random salts). At most four hashing operations run per web process. Legacy salted scrypt verification remains for migration compatibility, with rehash after eligible successful login. Existing shorter passwords require administrator recovery before enforcing a new organization-wide minimum; there is no claim that all legacy credentials already meet the new policy.

Sessions contain random 256-bit bearer secrets; the database stores only hashes. Cookies are HttpOnly, SameSite Strict, Path=/, eight-hour expiry, Secure with HTTPS APP_ORIGIN. Expiration, disabled users and active-project organization are checked on the server. Logout deletes the session. Disabling or recovering an account revokes prior sessions. Mutations reject mismatched Origin, cross-site Fetch Metadata and cookie-authenticated requests without Origin. JSON bodies are streamed with a 40 KB cap; the proxy also caps bodies.

Administrator invitations and recovery use expiring single-use tokens under a row lock. Roles and organization come from the issuer's stored record, never the recipient. Tokens are shown once, stored hashed, expire in 24 hours and are transferred through a trusted out-of-band channel. Issuance is audited; recovery does not replace a user's identity or rewrite decisions. Local operator recovery exists for a lost administrator. This is **not email verification**. No MFA, SSO or verified email service is implemented. The common-secret list is deliberately small; deployment still needs an appropriate compromised-password service/list and identity assurance policy. Per-account throttling exists; distributed/per-network throttling needs deployment review.

Reference: [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). These implementation choices do not establish NIST assurance-level or FIPS certification.

## Authorization

The sole API dispatcher is `apps/web/app/api/[...path]/route.ts`; there are no server actions. Public routes are health/auth status/login/token acceptance/setup. Every resource read/write resolves an authenticated session and its active project. Assessment, finding, remediation, review, comparison, report, package and screenshot IDs are checked against that project before use. Project switching and account management check organization ownership. The same role checks apply independently of UI controls.

Viewer is the read-only reviewer role. Operators scan, create journeys, request retests and record remediation claims. Reviewers additionally record observations, export drafts/packages and verify issues. Administrators manage policies, accounts and deletion. Roles apply to all projects within the organization; finer project membership is not implemented. CLI/worker core helpers are trusted service entry points, not independently authenticated APIs.

The deterministic negative matrix exercises anonymous 401, role 403, foreign assessment/source/screenshot/report/manifest/OpenACR/package/digest 404, foreign writes/deletion/project-switch 404, forged reviewer replacement and user administration. Protected payloads are not returned on denial. `tests/e2e/assurance.spec.ts` records exact expectations.

## Scanner boundary

`security.ts` validates permitted public HTTPS origin/path, forbids credentials/fragments/IP literals/nondefault ports and checks every DNS answer for reserved/private ranges. Native Chromium pins a public IPv4 answer, blocks proxies/QUIC, and routes every document/subresource through scope/method restrictions; contexts block service workers, WebSockets, popups and downloads. Document redirects must remain in scope. POST requires explicit target and journey consent. Limits: 4 URLs, 12 steps, 400 requests, 120 seconds, 1 MB DOM/state, 10 MB raw output/state, 2,000 violation nodes/state, 5 MB screenshot/state, 64 MB source files/assessment. Screenshots capture the viewport, not unbounded full page height.

Native execution is a development/test boundary. A browser exploit could compromise its host worker; it is not recommended for untrusted operational targets. Compose defines a credential-free browser service without DB network or artifact mounts. Its internal-only network reaches public HTTPS through `scripts/egress.ts`, which denies private/reserved DNS answers and pins each CONNECT to a checked IP. Only the proxy has external routing. There is no general internal-network exception; the native lab is exact loopback origin plus generated site path and opt-in environment.

**Network/container enforcement is NOT VERIFIED**: the attempted container build failed from host disk exhaustion before startup. Linux Chromium sandbox support, actual routing isolation, secret mounts, TLS and OS resource limits require execution on a host with sufficient free disk. [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) distinguishes application checks from network isolation; they are not treated as equivalent here.

## Evidence and sensitive content

Source JSON, DOM and PNG files are private, bounded and hashed. New evidence uses canonical JSON SHA-256; PNG/report/package hashes cover bytes. Downloads verify retained hashes before returning bytes. Packages verify source JSON, DOM and PNG against stored digests and include bounded baseline/retest lineage. Histories append; conformance remains a separate reviewer decision. Hashes are not signatures or externally anchored integrity. Database/storage administrators remain trusted.

HTML renders as escaped text, not executable source. Raw HTML/screenshots may contain sensitive data. Optional AI is disabled by default. Ollama uses an explicitly configured local service; cloud inference requires server opt-in plus administrator project consent. Payloads omit DOM, HTML, journey values and selectors. No provider fallback or automatic retry incurs cloud requests. Cloud billing/quotas remain the operator's responsibility; a free-tier label cannot guarantee zero billing. Use `AI_PROVIDER=none` or local Ollama for zero cloud inference charges.

CSP, nosniff, frame denial, referrer/permission policies and HTTPS HSTS are configured. CSP still permits inline scripts/styles for Next rendering; a nonce-based stricter policy is future work. Filesystem encryption, external signatures, audit-log anchoring, secret-manager integration, email/MFA/SSO and third-party assessment remain deployment gates.
