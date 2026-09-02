# The dossier

**`second-steven-dossier.pdf`** — everything Steven has said about this project, organised,
plus every decision made and why, and his own messages verbatim at the back.

Its purpose is narrow and important: **if this project ever has to restart** — a new session,
a new machine, a different assistant, or six months from now when the detail has gone — hand
over this one file and nothing has to be brainstormed again.

Regenerate after a significant conversation:

```bash
pip install reportlab
python3 docs/export/build-dossier.py
```

Section 9 is the primary source: his messages, exactly as sent. Everything above it is derived.
Where the two ever disagree, section 9 wins.

This is the *conversation* record. The *system* record is separate and automatic — the nightly
Markdown + JSON archive delivered over Telegram at 03:00, or on `/export`.
