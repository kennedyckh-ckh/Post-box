# Putting the app on Render: step by step

You need: a GitHub account, a Render account, and (optional, later) the HKU API key and endpoint. This guide assumes no technical background.

**What was verified and what was not.** The build and start commands in `render.yaml` were run on a clean copy of the code in a test environment, and the app was restarted to confirm that accounts, sessions and sign-ins survive a restart. **It has not been deployed to Render itself**, so the Render screens below follow Render's documented workflow and may differ slightly from what you see. Check each step against the screen.

## 1. Put the code on GitHub
1. Create a new **private** repository on GitHub (private is safer because it contains your configuration).
2. Upload the project folder contents to it (the folder with `package.json` and `render.yaml` at the top level).
3. Do **not** upload any file called `.env` (the project's `.gitignore` already prevents it), and never paste a key into any file.

## 2. Create the service on Render
1. In Render choose **New → Blueprint**, connect GitHub and pick the repository. Render reads `render.yaml`.
2. It will show one web service called `groupwork` on the **Starter** plan with a **2 GB disk**. A disk is required (it holds the database and uploaded pictures) and Render offers disks on paid plans only; check Render's current pricing page.
3. It asks for three values (these create the first administrator, once):
   - `BOOTSTRAP_ADMIN_EMAIL`: your email
   - `BOOTSTRAP_ADMIN_NAME`: your name
   - `BOOTSTRAP_ADMIN_PASSWORD`: a long temporary password (at least 10 characters)
4. The other three AI settings (`HKU_API_KEY`, `HKU_API_ENDPOINT`, `HKU_API_VERSION`) can be left empty for now. `AI_PROVIDER` stays `simulated` (built-in demo, nothing leaves the server).
5. Press **Apply** and wait for the first deploy to finish (a few minutes).

## 3. First sign-in
1. Open the address Render gives you (for example `https://groupwork-xxxx.onrender.com`) and press **Facilitator sign in**.
2. Sign in with the email and temporary password. You are asked to choose a new password. Do that.
3. In Render, open the service → **Environment** and **delete** the three `BOOTSTRAP_ADMIN_*` settings. (They only work when there are no accounts, but there is no reason to keep a password there.)
4. In the app, open **Administration** to add other facilitators. You see each temporary password once; pass it on privately. They must choose their own at first sign-in.

## 4. Check that data survives a redeploy (do this once, before real use)
1. Create a test session, start it, join it from your phone, and write one entry with a picture.
2. In Render press **Manual Deploy → Deploy latest commit** (or restart the service).
3. When it is back, sign in again as the participant (refresh the page; if you were signed out, use the recovery code) and check the entry and picture are still there.
If anything is missing, the disk is not mounted at `/var/data`: stop and check the **Disks** tab and that `DATA_DIR` is `/var/data`.

## 5. Turning on the HKU AI service (optional)
You do this in Render, never in this app or in a chat.
1. Service → **Environment**. Set:
   - `AI_PROVIDER` = `hku`
   - `HKU_API_KEY` = your key (use Render's secret/“sync: false” field)
   - `HKU_API_ENDPOINT` = the **complete** request URL from the HKU developer portal, exactly as shown (including the deployment part and `?api-version=...` if the portal's URL has it). The app uses it as given and does not add or guess any part.
   - `HKU_API_VERSION` = leave empty unless the portal gives the version separately and the URL does not contain it. It is added only if the URL does not already have `api-version`.
   - `AI_MODEL` = `gpt-4.1-nano` (a label; if the gateway needs the name inside the request, also set `AI_SEND_MODEL` = `1`)
2. Save; Render restarts the service.
3. In the app open **AI usage** and press **Test the connection**. It sends one harmless word. “Settings present” means only that the settings exist; **the test is what shows whether a live request works.**
4. Then try the **AI analysis** tab with a small, harmless sample before using it with real work.
If the test fails, the message says which kind of problem it is (key rejected, address not found, busy, timed out). If a message names a missing setting, fix that setting. If it keeps failing, ask HKU support for a working example request (with the key blanked out) and compare it with `docs/DEPLOY-RENDER.md` section 5.
The app never switches to the demo by itself when live AI fails.

## 6. Backups and restoring
The database and the pictures are on the disk. A disk is not a backup. Do at least one of these (and check Render's own disk snapshot options on the Disks tab):
- **Make a backup (safe while the app is running).** In Render open the service's **Shell** and run `npm run backup`. It prints the folder it made (inside `/var/data/backups/`) and checks the copy. Download it somewhere safe. Backups contain personal data: keep them as protected as the live data.
- **Restore.** In the Shell run `npm run restore -- /var/data/backups/backup-<the folder name>`. The current data is not deleted; it is moved to `/var/data/replaced-<time>/`. Then **restart the service straight away** (the running app still has the old files open until it restarts, so anything people save between the restore and the restart is lost; tell participants to stop first). A damaged backup is refused and nothing is changed.
- The file `/var/data/secret.key` is the key that lets participants see their recovery code again. Backups deliberately leave it out (so a backup alone cannot reveal codes). Keep it on the disk; if it is ever lost, participants just choose “Make a new code” on their session page.
- Deleting a session in the app does **not** delete backups made earlier. Delete old backups yourself when your retention rules say so.
- Rehearse a restore once, with a test session, before you need it.

## 7. Everyday checks
- `https://<your address>/api/health` should show `{"ok":true}`.
- Run **one** instance only. Do not scale to two.
- Share the join code with participants; they can read how their information is used at `/notice`.
- When you finish with a class: archive the session (read-only) or delete it (permanent, see the README for exactly what is removed).

## Troubleshooting
| What you see | Likely cause | What to do |
|---|---|---|
| Sign-in says “Cross-site request blocked” | The address the browser uses differs from what the host reports | Set `PUBLIC_HOST` to your public host name (for example `groupwork.example.org`) |
| Everyone seems to share one “too many attempts” lock | `TRUST_PROXY` not set, so all visitors look like one address | Set `TRUST_PROXY` to `1` |
| Data disappears after a deploy | No disk, or `DATA_DIR` not on the disk | Add the disk and set `DATA_DIR=/var/data` |
| Build fails on `<Html>` | Wrong `NODE_ENV` during build | The project's build script already forces the right value; make sure you use `npm run build` |
| Participants cannot join | Joining closed, session not started, group full, wrong PIN | The message on the join page says which |
