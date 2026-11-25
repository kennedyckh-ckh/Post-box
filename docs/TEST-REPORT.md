# Test report

Tests were run in a Linux test environment (Node 22, Chromium for the browser checks). **Mocked and live results are reported separately. No live request to the HKU service was made.** Nothing here shows that the app works on Render, because it has not been deployed there.

## 1. Summary

| Kind | What | Result |
|---|---|---|
| Automated (real code, real database, no network) | 120 tests in 7 files | 120 passed, 0 failed |
| Automated, **mocked** HKU responses | The 30 AI tests (inside the 120) use either the built-in simulator or a fake replacement for the network call (9 of them test the HKU provider itself: request construction and error handling). None contacts the real service. | passed |
| Static checks | TypeScript strict type-check, ESLint, production build | all clean |
| Manual in a browser (Chromium) | main screens for participants, facilitators, projector, AI usage | worked; see section 4 |
| Automated accessibility scan (axe-core 4.14.1, WCAG 2.0/2.1/2.2 A/AA + best practice) in a browser | 20 page and tab states | 0 violations after one fix (heading order) |
| Phone-width check (390 px) | 9 screens and 9 facilitator tabs | no sideways scrolling after two fixes |
| Clean-checkout rehearsal of the deployment commands | install, build, start, first administrator, sign-in, create and start a session, **restart**, sign in again | worked (this is not Render) |
| **Live HKU request** | – | **NOT RUN** |
| **Deployment on Render, redeploy check on Render** | – | **NOT RUN** |

Commands: `npm test` (120 tests), `npm run typecheck`, `npm run lint`, `npm run build`.

Tests per file: `foundations` 23, `workspace` 23, `submission` 12, `sharing` 20, `ai` 30, `hardening` 11, `race` 1.
**Real defects found while testing, now fixed:** a rejected AI edit or publication surfaced as a server error instead of a clear message; one AI lookup answered “not found” before checking sign-in (found by the every-endpoint test); the clean-checkout build failed when the machine's `NODE_ENV` was not `production` (found by the deployment rehearsal, not by a test); and two screens overflowed a phone-width screen (found by the phone check). Other first-run test failures were mistakes in the tests themselves (for example test text that contained an author's name) and were corrected in the tests.

**Post-box update:** `tests/postbox.test.ts` (3 tests) covers the Post-box template, required choice with an option from the facilitator's list, one answer per person per statement, changing an answer, class counts by option and by group, hidden entries not counted, renamed options counted as “other”, projector counts for revealed statements only with no names or reasons, duplicating a session, and the choice kept in submissions and exports. Full suite at this update: 135 passed, 0 failed (`npm test`), plus typecheck, lint and build.

## 2. The brief's required scenarios (section 17) and the test that covers each

| Required scenario | Test (file → title) | Kind |
|---|---|---|
| Two participants contribute concurrently without overwriting | workspace → two participants write at the same time without overwriting each other | automated |
| Cannot reach another group's entry or attachment by changing a URL or request | workspace → a participant sees only their own group's entries and cannot reach another group's by id or url; … cannot download a private picture | automated |
| A facilitator cannot access an unauthorised session | foundations → a facilitator cannot see or change another facilitator's session, and admins get no automatic access | automated |
| Refresh restores the participant and saved work | foundations → restores the session after a refresh (same cookie) and on another device; hardening → survives the database being closed and reopened | automated |
| Cross-device recovery does not allow takeover by name | foundations → does not let anyone take over an identity by typing the same name; throttles recovery-code guessing | automated |
| Seat caps hold during simultaneous joins | race → 12 separate processes race for 5 seats: exactly 5 get in | automated, **separate processes** |
| A submission contains every entry acknowledged as saved | submission → snapshots everything saved before it … | automated |
| Repeated clicks do not duplicate a submission | submission → repeated clicks and retries do not create duplicate submissions | automated |
| Reopening one group leaves other groups unchanged | submission → reopening one group's submission leaves every other group unchanged | automated |
| Hidden or locked stages cannot be bypassed by direct requests | workspace → locked, hidden and disabled stages cannot be reached through direct requests; hardening → every endpoint is protected on the server (4 tests) | automated |
| Stage release does not publish private work | sharing → nothing is visible to other groups before the facilitator publishes it, and releasing a stage publishes nothing; workspace → opening a later stage never changes earlier responses | automated |
| Anonymous publication does not expose identities through metadata or source links | sharing → anonymous items carry no names, groups or ids …; pictures in shared items are visible under a generic file name | automated |
| Presentation mode has no unpublished drafts or private details | sharing → needs the secret link, shows only items approved for it …; summaries and discussion questions stay hidden until separately switched on | automated |
| Unpublishing removes access through the application | sharing → unpublishing removes access through the application | automated |
| Removing a participant revokes access without deleting their contributions | foundations → removing revokes access … ; workspace → removing a participant keeps their entries and attribution | automated |
| Duplicating a session gives a clean activity with a new join code | submission → a duplicate is a clean activity … | automated |
| Restarting or redeploying preserves responses and attachments | hardening → responses, pictures, sign-ins and recovery codes survive the database being closed and reopened; plus the clean-checkout restart rehearsal | automated (in-process) and manual (process restart). **Not tested on Render.** |
| AI failure does not stop normal collaborative work | ai → works with no AI at all … | automated, mocked failure |
| Invalid AI source ids are detected before publication | ai → a live (mocked) reply is validated …; invalid source ids are caught before publication even if the stored draft was tampered with | automated, mocked |
| Changing source entries marks AI outputs potentially outdated | ai → marks an analysis as potentially outdated … | automated |
| Simulated output is clearly different from live output | ai → simulated output is labelled …; publishing needs the demo acknowledgement … | automated |
| Exports separate original, edited and AI content | sharing → identified exports carry names …; ai → exports AI drafts, edits and sources in their own section | automated |

### HKU connection (required to be reported separately)

| Required check | Result |
|---|---|
| Request construction (URL used as given, `api-version` added once or not at all, `api-key` header, chat-completions body, no unconfirmed options, key never in body) | automated, **mocked** (3 tests) |
| Provider selection (`simulated` default; `hku` uses the settings; no silent fallback) | automated, mocked |
| Parsing of the reply and token counts | automated, mocked |
| Error handling: wrong key, wrong address, bad request, busy (retried a bounded number of times), server error, network failure, timeout, unreadable or empty reply, missing settings; messages never contain the key or address | automated, **mocked** (6 tests) |
| A minimal live connection test with harmless content | **Built** (the “Test the connection” button on the AI usage page sends one word and no participant data). **Not run**, because no key or endpoint was provided. |
| An actual workflow after credentials are set | **NOT RUN** |

## 3. Other things tested automatically

| Area | Tests |
|---|---|
| Accounts | first administrator from private settings only; forced password change; accounts only created by an administrator; lock after repeated failed sign-ins that survives a restart; cross-site writes refused |
| Joining | PIN required and guessing throttled; optional fields enforced only when configured; unique ids for identical names; joining closed / not started / new join code (existing participants unaffected); facilitator-assigned groups |
| Membership | move respects seat caps unless overridden and is recorded; cannot move into another session; removal frees the seat; restore needs an override if full |
| Stages | enabled / visible / locked-open-closed separate; legal transitions only; needs a started session; one stage always enabled; per-group open, close and exclusion; closed is read-only; reference panel shows only the group's own earlier work, labelled |
| Entries | tags from the stage list; table structure stored exactly; Traditional Chinese, emoji and accents unchanged; same retry does not duplicate; edit conflicts return the saved copy and a retry works; versions kept; group response conflict handling; polling returns “unchanged” until something changes |
| Files | PNG/JPEG accepted by content; HTML, SVG, scripts, fake extensions, PDFs from participants, empty and oversize files refused; location data removed from JPEG and PNG; facilitator PDFs downloadable only after release; unattached pictures cleaned up after a day |
| Submission | confirmation; required questions; representative option; presence warning; progress counts with empty and left-out groups; override needs and records a reason; versions and reopen notes |
| Sessions | archive makes everything read-only and restore brings it back; permanent delete needs the exact title and the owner, removes records and files of that session only, leaves a single audit line |
| Sharing | frozen snapshots and “differs from source”; labels stay consistent; one bulk switch; participant cannot publish; other facilitators cannot |
| Reactions / responses | one of each type, repeats harmless, scope limits, configurable types, stable sorting; prompts, approval, hiding, anonymity of commenters, withdraw |
| Export | identified vs de-identified; no secrets; CSV BOM, quoting and formula neutralisation; only session facilitators; every export recorded |
| AI | scope defaults to submitted work; preview excludes names; drafts private; edits validated; review before publish; demo acknowledgement; participants never see sources; questions revealed separately; projector shows summaries only when published, approved and switched on; too-long selections refused and nothing sent; prompt-injection text neutralised and cannot cause publishing; repeated request does not pay twice; concurrent double click refused; usage counted, demo kept separate, no prompts stored; per-facilitator limits enforced before the request; admin-only limits; test-connection |
| Protection | every endpoint tried with no sign-in, with a participant's sign-in only, and with a facilitator's sign-in only; admin routes refuse ordinary facilitators |
| Operations | backup taken while the app is running, restore into an empty folder, damaged backup refused and nothing changed; migrations back up the database first |

## 4. Manual checks in a browser (Chromium, one person, demo data)

Done: facilitator sign-in, session page and all tabs; participant join page (including the recovery code screen), session home, workspace (adding an entry through the real form), submit confirmation (showing the missing-required-question message), class board, projector page with an anonymous item, AI analysis tab, AI usage page (including the administrator section); Traditional Chinese displayed correctly in names, entries and tables.

Screenshots taken during the build are in the delivered outputs.

## 5. Accessibility

- Automated axe-core scan of 20 states (public pages, notice, facilitator dashboard, administration, AI usage, every session tab, participant home, workspace, class board, projector): after changing heading levels on three tabs, **0 violations**.
- Built in by design: skip link; visible focus outline; every field labelled; errors and confirmations announced (`role="alert"` / `status`); status never by colour alone (text labels on every badge); progress bars with text; tables with captions and header cells; tab controls with correct roles; confirmation before consequential actions; unsaved-work warning in the entry editor.
- **Not done:** testing with a screen reader; a complete keyboard-only walkthrough by a person; testing with browser zoom and text-size settings; testing on real phones or other browsers. Automated scans find only a share of accessibility problems. **WCAG 2.2 AA is the target; this app is not certified.**

## 6. What was not tested (and why it matters)

| Not tested | Why it matters |
|---|---|
| Deployment and redeploy on Render | Only Render proves the disk is mounted where the app writes. Follow `docs/DEPLOY-RENDER.md` section 4. |
| Any live HKU request | The real URL, key, header handling and reply format are unconfirmed until the connection test passes. |
| Real devices, Safari, Firefox | Only Chromium was used. |
| Load beyond the 12-process join race | Behaviour with a full lecture hall joining is unmeasured. |
| Independent security review or penetration test | The protections listed in the README are tested by this suite only. |
| Recovery from a lost disk | Backup and restore are tested; a real disaster is not. |
| Legal or institutional compliance (privacy law, school policy) | The participant notice describes the app and makes no compliance claim. |
