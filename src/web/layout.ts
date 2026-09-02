export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const NAV = [
  ["/", "Today"],
  ["/tasks", "Tasks"],
  ["/projects", "Projects"],
  ["/study", "Study"],
  ["/money", "Money"],
  ["/rooms", "Rooms"],
  ["/watchlist", "Watchlist"],
  ["/desk", "Desk"],
  ["/search", "Search"],
  ["/chat", "Ask"],
];

/**
 * Server-rendered, no build step, no framework. Fast on a phone over a bad
 * connection and identical on a desktop browser — which is the requirement.
 */
export function page(title: string, active: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#121917">
<title>${escapeHtml(title)} · Second Steven</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Sven">
<style>
:root{
  color-scheme:light dark;
  --bg:#EFF2F1; --surface:#fff; --surface-2:#E3E9E7;
  --ink:#141D1B; --ink-2:#4D5A57; --ink-3:#788682;
  --line:#C9D2CF; --accent:#0A6B74; --accent-ink:#075158; --accent-soft:#DAECEE;
  --signal:#A9500B; --signal-soft:#F6E7D6; --ok:#3F7A46;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#121917; --surface:#1A2321; --surface-2:#222D2A;
  --ink:#E5EBE8; --ink-2:#9CAAA5; --ink-3:#748280;
  --line:#2F3C39; --accent:#54C6D0; --accent-ink:#8FDDE4; --accent-soft:#16383C;
  --signal:#E39146; --signal-soft:#3A2A17; --ok:#6FB177;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;padding-bottom:env(safe-area-inset-bottom)}
a{color:var(--accent-ink);text-decoration:none}
header{position:sticky;top:0;z-index:10;background:var(--surface);
  border-bottom:1px solid var(--line);padding:env(safe-area-inset-top) 0 0}
.bar{display:flex;align-items:center;gap:12px;padding:12px 16px;max-width:1000px;margin:0 auto}
.bar b{font-size:1.02rem;letter-spacing:-.02em}
nav{display:flex;gap:2px;overflow-x:auto;padding:0 12px 8px;max-width:1000px;
  margin:0 auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
nav::-webkit-scrollbar{display:none}
nav a{padding:6px 12px;border-radius:999px;font-size:.88rem;color:var(--ink-2);white-space:nowrap}
nav a.on{background:var(--accent-soft);color:var(--accent-ink);font-weight:600}
main{max-width:1000px;margin:0 auto;padding:20px 16px 64px}
h1{font-size:1.5rem;letter-spacing:-.02em;margin:0 0 4px}
h2{font-size:1.05rem;letter-spacing:-.01em;margin:28px 0 10px;color:var(--ink)}
.muted{color:var(--ink-2);font-size:.92rem;margin:0 0 18px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;
  padding:14px 16px;margin-bottom:8px}
.card h3{margin:0 0 4px;font-size:1rem;letter-spacing:-.01em}
.card p{margin:0;color:var(--ink-2);font-size:.92rem}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.tag{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3);
  border:1px solid var(--line);border-radius:4px;padding:2px 7px;white-space:nowrap}
.tag.due{color:var(--signal);border-color:var(--signal);background:var(--signal-soft)}
.tag.ok{color:var(--ok);border-color:var(--ok)}
.grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
form{margin:0}
textarea,input[type=text],input[type=search]{width:100%;background:var(--surface);
  color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:12px 14px;
  font:inherit;font-size:16px;resize:vertical}
textarea:focus,input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{background:var(--accent);color:var(--bg);border:0;border-radius:10px;
  padding:11px 18px;font:inherit;font-weight:600;cursor:pointer;margin-top:8px}
button:active{opacity:.85}
.empty{color:var(--ink-3);font-size:.92rem;padding:18px 0}
.hit{border-left:2px solid var(--accent);padding-left:12px;margin-bottom:14px}
.hit time{display:block;font-size:.74rem;color:var(--ink-3);margin-bottom:2px}
.msg{margin-bottom:14px}
.msg .who{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3)}
.msg.me .bubble{background:var(--accent-soft)}
.bubble{background:var(--surface);border:1px solid var(--line);border-radius:10px;
  padding:11px 14px;margin-top:3px;white-space:pre-wrap}
.flash{background:var(--accent-soft);border:1px solid var(--accent);color:var(--accent-ink);
  border-radius:10px;padding:11px 14px;margin-bottom:16px;font-size:.92rem}
@media (min-width:760px){ main{padding:28px 20px 80px} h1{font-size:1.8rem} }
</style>
</head>
<body>
<header>
  <div class="bar"><b>Second Steven</b><span class="tag">console</span></div>
  <nav>${NAV.map(([href, label]) =>
    `<a href="${href}"${href === active ? ' class="on"' : ""}>${label}</a>`).join("")}</nav>
</header>
<main>${body}</main>
</body></html>`;
}

export const MANIFEST = JSON.stringify({
  name: "Second Steven",
  short_name: "Sven",
  start_url: "/",
  display: "standalone",
  background_color: "#121917",
  theme_color: "#121917",
  icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }],
});
