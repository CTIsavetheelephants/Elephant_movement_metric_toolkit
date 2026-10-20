# Metrics receiver (Google Apps Script)

This powers the calculator's **Send to the CTI** button. It runs free inside STE's Google Workspace, with no server.

When a partner clicks the button (and only then), the calculator posts the metrics file here. The receiver:

1. checks it is a calculator metrics file, and refuses anything that contains locations or fix times
2. saves it, plus the run report, to a private Drive folder
3. e-mails you with both files attached; your reply goes to the partner's contact address. If the results were made with an outdated calculator, the subject starts with `[OUTDATED CALCULATOR v…]` (below the required minimum) or `[OLDER CALCULATOR v…]` (a newer version exists). Nothing is refused.

To flag outdated calculators, the receiver reads the public `version.json` from the GitHub Pages site (`VERSION_URL` in `Code.gs`). The calculator does its **own** update check against that same file. The receiver is not involved.

**Legacy:** version 1.0.0 copies (handed out through Google Drive) still ask the receiver for updates (`?check=version`). `doGet` answers them with the GitHub `version.json`, so they show the update banner with the new link. You can delete that block once nobody uses 1.0.0.

## One-time setup (about 10 minutes)

1. In Google Drive, create a private folder **"Elephant metrics submissions"**. Copy its ID from the address bar (the part after `/folders/`).
2. Go to <https://script.google.com>, click **New project**, and name it "Elephant Metrics receiver". If the project already exists, open it instead.
3. Replace the contents of `Code.gs` with this folder's `Code.gs`. Paste the folder ID into `FOLDER_ID`, and check `NOTIFY_EMAIL` and `VERSION_URL`.
4. Click **Deploy → New deployment → Web app**:
   - *Execute as:* **Me**. The files are saved with your Drive permissions.
   - *Who has access:* **Anyone**. Partners don't need Google accounts.
5. Authorise when asked (Drive, Gmail and "connect to an external service", which is needed to read `version.json`). Then copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).
6. Put that URL in `calculator/release.config.json` as `receiverUrl`, and release a new calculator version.

Without a `receiverUrl`, the Send button instead downloads the file and opens an e-mail to you for the partner to attach it.

**Changing the script later** (for example, after pasting a new `Code.gs`): use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. That keeps the same URL, so calculators already handed out keep working. Fill in `FOLDER_ID` again, because the copy in this repo only has a placeholder. Before deploying, choose `testVersionCheck` in the function menu and click **Run**: it asks for any new permissions and logs the version note.

## What a public receiver URL exposes

The web app URL is inside every copy of the calculator, and now on GitHub, so treat it as public. Anyone who has it can:

- **Open it in a browser:** they see a one-line "this address receives metric files" page. They see nothing from your Drive.
- **Ask `?check=version`:** they get the same public `version.json` that is already on the GitHub Pages site.
- **Post a file to it:**
  - It is saved to your submissions folder and e-mailed to you, but only if it looks like a calculator metrics file (required columns present, no location/time columns, under ~20 MB).
  - Someone could deliberately send junk or many files (spam). This would use your Drive space and your daily Apps Script e-mail quota.
  - If that ever happens, make a new deployment (new URL), put it in `release.config.json`, release a new version, and delete the old deployment.

They **cannot**:
- read, list or delete anything in your Drive
- read your e-mail
- see other partners' submissions
- run any other code as you

The script only does what `doPost`/`doGet` in `Code.gs` do. Your e-mail address (`NOTIFY_EMAIL`, also the calculator's `sendEmail`) is visible in `Code.gs` on GitHub and in the calculator page.

## Limits

- Apps Script accepts posts up to ~50 MB and Gmail attachments up to 25 MB.
- A typical metrics file is 0.1-2 MB.
- Consumer and Workspace accounts have a daily e-mail quota (100 / 1,500 recipients a day). That is far above what this needs.
