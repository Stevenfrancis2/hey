# Connecting Google Drive and Calendar

About ten minutes, once. The code is already written — you are only creating credentials.

Everything else in the system works without this. Skip it and nothing breaks.

---

## 1 · Make a project

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)**
2. Top bar → project dropdown → **New Project**
3. Name it `second-steven` → **Create**, then make sure it's selected

## 2 · Turn on the two APIs

**APIs & Services → Library**, then search for and **Enable** each:

- **Google Drive API**
- **Google Calendar API**

## 3 · Consent screen

**APIs & Services → OAuth consent screen**

- User type: **External** → Create
  *(External sounds wrong for a personal tool, but Internal requires a Workspace
  organisation. External with yourself as the only test user is correct here.)*
- App name `Second Steven`, your email for both support and developer contact
- **Save and continue** through Scopes — you don't need to add any here
- **Test users → Add users → your own Gmail address.** Miss this and Google
  blocks the login with "app has not completed verification"
- Save. Leave it in **Testing**; you never need to publish it

> A refresh token from an app in Testing expires after **seven days**. That is a
> Google policy, not a bug in this. When Drive or Calendar stops working, send
> `/connect` again — it takes five seconds. To stop that permanently, click
> **Publish app**; for a personal-use app with only your own account, Google
> does not require verification review.

## 4 · Credentials

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

- Application type: **Web application**
- Name: `second-steven`
- **Authorised redirect URIs → Add URI** — this must match *exactly*:

```
https://YOUR-APP.fly.dev/auth/google/callback
```

Replace `YOUR-APP` with your real Fly app name. If you also want it to work
locally, add a second URI:

```
http://localhost:8080/auth/google/callback
```

- **Create**. Copy the **Client ID** and **Client secret**.

## 5 · Give them to the app

```bash
fly secrets set \
  GOOGLE_CLIENT_ID="...apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="GOCSPX-..."
```

Locally, put the same two values in `.env`.

## 6 · Connect

Send **`/connect`** to the bot. It replies with a link — open it, choose your
account, approve.

Google will warn **"Google hasn't verified this app"**. That is expected for an
app in Testing. Click **Advanced → Go to Second Steven (unsafe)**. It is your own
app, with your own credentials, talking to your own account.

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
| `redirect_uri_mismatch` | The URI in Google Cloud doesn't match byte for byte. Check `https` vs `http`, and no trailing slash. |
| "has not completed verification" and no Advanced link | Your email isn't in **Test users**. |
| "Google returned no refresh token" | You approved before. Revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), then `/connect` again. |
| Worked, then stopped after a week | The Testing-mode seven-day expiry. Send `/connect`, or publish the app. |
| `/drive` says nothing new | Correct if nothing changed — it only fetches files whose modified time moved. |
