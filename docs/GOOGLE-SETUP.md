# Connecting Google Drive and Calendar

About ten minutes, once. The code is already written — you are only creating credentials.

Everything else in the system works without this. Skip it and nothing breaks.

> **Updated September 2026.** Google moved all of this. What used to be
> *APIs & Services → OAuth consent screen* is now its own section called
> **Google Auth Platform**, split across four tabs — Branding, Audience,
> Data Access and Clients. If a guide tells you to click "OAuth consent
> screen", it was written before the change and the menu item is gone.

---

## 1 · Make a project

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)**
2. Top bar → project dropdown → **New Project**
3. Name it `second-steven` → **Create**, then make sure it's selected

## 2 · Turn on the two APIs

**APIs & Services → Library**, then search for and **Enable** each:

- **Google Drive API**
- **Google Calendar API**

## 3 · Google Auth Platform

Left menu → **Google Auth Platform**. If the project has never had auth set up,
it shows a **Get started** button; that walks you through Branding and Audience
in one flow. Otherwise use the tabs directly.

**Branding**
- App name: `Second Steven`
- User support email: your own
- Developer contact email: your own
- Save

**Audience**
- User type: **External**
  *(External sounds wrong for a personal tool, but Internal requires a Google
  Workspace organisation. External with only your own account is correct here.)*

**Data Access** — you do not need to add scopes by hand. The app asks for what
it needs at connect time. For reference, it requests exactly two:

| Scope | Why |
|---|---|
| `drive.readonly` | Read-only. It indexes your files; it never writes or deletes. |
| `calendar` | Read *and* write, so it can create events you ask for. |

## 4 · Publish it — do not leave it in Testing

Still on **Audience**, under Publishing status, click **Publish app** and confirm.

This matters more than it looks. **An app left in Testing has every refresh
token expire after exactly seven days** — that is Google policy, not a bug here.
Leave it in Testing and Drive and Calendar quietly stop working every week and
you have to reconnect. In Production the token lasts until you revoke it.

You will *not* be asked to complete verification for this. Verification is
required to remove the warning screen and to go past 100 users; Google's own
rules make an explicit exception for an app whose only user is you. You stay
unverified, you see one warning screen at connect time, and you click past it.

## 5 · Create the OAuth client

**Google Auth Platform → Clients → Create client**
*(the old path, APIs & Services → Credentials → Create Credentials → OAuth client ID,
still works and lands in the same place)*

- Application type: **Web application**
- Name: `second-steven`
- **Authorised redirect URIs → Add URI** — this must match *exactly*:

```
https://YOUR-APP.fly.dev/auth/google/callback
```

Replace `YOUR-APP` with your real Fly app name. To use it locally as well, add a
second URI:

```
http://localhost:8080/auth/google/callback
```

- **Create**. Copy the **Client ID** and **Client secret**.

## 6 · Give them to the app

```bash
fly secrets set \
  GOOGLE_CLIENT_ID="...apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="GOCSPX-..."
```

Locally, put the same two values in `.env`.

## 7 · Connect

Send **`/connect`** to the bot. It replies with a link — open it, choose your
account, approve.

Google will warn **"Google hasn't verified this app"**. Expected, as above.
Click **Advanced → Go to Second Steven (unsafe)**. It is your own app, with your
own credentials, talking to your own account.

Done. Check it:

- `/drive` — syncs and reports how many files it indexed
- Ask the bot *"what's on my calendar this week?"*

---

## What it can do once connected

| | |
|---|---|
| **Drive** | Read-only. A nightly sync at 02:00 pulls new and changed files into the same memory as everything else, so a spec sheet you dropped in a folder is findable from a voice note. Google Docs and Sheets are exported as text; PDFs and images are indexed by name and link only. |
| **Calendar** | Read *and* write. It can check your week, find a free slot of a given length, and create events. It confirms before creating anything involving other people. |

Only sync one folder instead of your whole Drive:

```bash
fly secrets set GOOGLE_DRIVE_FOLDER_ID="the-id-from-the-folder-url"
```

The id is the last part of the folder's URL in Drive.

**Shared with your friend:** put the bank-project folder in Drive, share it with
him, and point `GOOGLE_DRIVE_FOLDER_ID` at it. Both of you drop things in; the
assistant indexes it. That is the shared space you asked for, without building one.

## If something goes wrong

| Symptom | Cause |
|---|---|
| Can't find "OAuth consent screen" in the menu | It's now **Google Auth Platform**, split into Branding / Audience / Data Access / Clients. |
| `redirect_uri_mismatch` | The URI in Google Cloud doesn't match byte for byte. Check `https` vs `http`, the port, and no trailing slash. |
| "has not completed verification" and no Advanced link | Your account isn't allowed to consent. If you left the app in Testing, add yourself under **Audience → Test users**; better, publish it (step 4). |
| "Google returned no refresh token" | You approved before. Revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), then `/connect` again. |
| Worked, then stopped after a week | The app is still in **Testing**. Publish it — step 4. |
| `/drive` says nothing new | Correct if nothing changed — it only fetches files whose modified time moved. |
