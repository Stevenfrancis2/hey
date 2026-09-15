/** Escapes single quotes too, so this stays safe in attribute contexts. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Grouped so the desktop sidebar reads as a shape rather than a list of twelve.
 * The order is his day: what is happening now, then the businesses, then the rest.
 */
const NAV: [string, string, string][] = [
  ["/", "Today", "now"],
  ["/tasks", "Tasks", "now"],
  ["/projects", "Projects", "now"],
  ["/calendar", "Calendar", "now"],
  ["/desk", "Desk", "now"],
  ["/farm", "Farm", "work"],
  ["/money", "Money", "work"],
  ["/study", "Study", "work"],
  ["/watchlist", "Watchlist", "work"],
  ["/decisions", "Decisions", "work"],
  ["/rooms", "Rooms", "life"],
  ["/body", "Body", "life"],
  ["/search", "Search", "life"],
  ["/chat", "Chat", "life"],
];
const GROUPS: [string, string][] = [["now", "Now"], ["work", "Work"], ["life", "Life"]];

/**
 * Server-rendered, no build step, no framework, no web fonts, no JavaScript.
 * That is not minimalism for its own sake — it is why this opens instantly on a
 * phone on Lebanese mobile data, which is the only performance target that
 * matters here. Every class name below is load-bearing: pages.ts emits them.
 */
export function page(title: string, active: string, body: string): string {
  const links = (cls: string) =>
    GROUPS.map(([key, label]) => `
      <div class="${cls}-group"><span class="${cls}-label">${label}</span>
      ${NAV.filter(([, , g]) => g === key)
        .map(([href, text]) =>
          `<a href="${href}"${href === active ? ' class="on" aria-current="page"' : ""}>${text}</a>`)
        .join("")}</div>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#EFF2F1" media="(prefers-color-scheme:light)">
<meta name="theme-color" content="#101614" media="(prefers-color-scheme:dark)">
<title>${escapeHtml(title)} · Second Steven</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Sven">
<style>
:root{
  color-scheme:light dark;
  --bg:#EFF2F1; --surface:#fff; --surface-2:#E6ECEA;
  --raise:0 1px 2px rgba(20,29,27,.05); --raise-2:0 4px 16px -4px rgba(20,29,27,.12);
  --ink:#141D1B; --ink-2:#4D5A57; --ink-3:#778682;
  --line:#D4DCD9; --line-2:#C2CCC8;
  --accent:#0A6B74; --accent-ink:#065C64; --accent-soft:#DCEDEF;
  --signal:#A0490A; --signal-soft:#F8E9DA; --ok:#37703E; --ok-soft:#DFEEE1;
  --radius:12px; --gut:clamp(16px,4vw,24px);
}
@media (prefers-color-scheme:dark){:root{
  --bg:#101614; --surface:#18211F; --surface-2:#212B28;
  --raise:0 1px 2px rgba(0,0,0,.4); --raise-2:0 4px 16px -4px rgba(0,0,0,.5);
  --ink:#E6ECE9; --ink-2:#9DABA6; --ink-3:#74827F;
  --line:#2B3633; --line-2:#3A4643;
  --accent:#4FC3CD; --accent-ink:#8CDCE3; --accent-soft:#12343880;
  --signal:#E3934C; --signal-soft:#37281799; --ok:#6FB177; --ok-soft:#1D3121;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--accent-ink);text-decoration:none}
a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.skip{position:absolute;left:-9999px}
.skip:focus{left:var(--gut);top:8px;z-index:50;background:var(--surface);
  padding:10px 14px;border-radius:8px;box-shadow:var(--raise-2)}

/* shell */
.shell{display:block}
.side{display:none}
header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--line);
  padding:env(safe-area-inset-top) 0 0}
.bar{display:flex;align-items:center;gap:10px;padding:13px var(--gut) 11px}
.bar b{font-size:1.05rem;letter-spacing:-.021em}
.dot{width:7px;height:7px;border-radius:50%;background:var(--ok);flex:none}
.tabs{display:flex;gap:4px;overflow-x:auto;padding:0 var(--gut) 9px;
  -webkit-overflow-scrolling:touch;scrollbar-width:none;scroll-snap-type:x proximity}
.tabs::-webkit-scrollbar{display:none}
.tabs-label{display:none}
.tabs-group{display:contents}
.tabs a{padding:9px 14px;border-radius:999px;font-size:.9rem;font-weight:500;
  color:var(--ink-2);white-space:nowrap;scroll-snap-align:start;
  border:1px solid transparent;transition:background .15s,color .15s}
.tabs a:hover{background:var(--surface-2);text-decoration:none}
.tabs a.on{background:var(--accent-soft);color:var(--accent-ink);font-weight:650;
  border-color:color-mix(in srgb,var(--accent) 30%,transparent)}
main{padding:22px var(--gut) 72px;max-width:1040px;margin:0 auto}

/* type */
h1{font-size:clamp(1.55rem,4.4vw,2rem);line-height:1.18;letter-spacing:-.028em;
  margin:0 0 6px;font-weight:680}
h2{font-size:1.06rem;letter-spacing:-.014em;margin:34px 0 12px;font-weight:650}
h2:first-of-type{margin-top:26px}
h3{margin:0 0 4px;font-size:1rem;letter-spacing:-.012em;font-weight:620}
.muted{color:var(--ink-2);font-size:.94rem;margin:0 0 20px;max-width:64ch}

/* cards */
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  padding:15px 17px;margin-bottom:9px;box-shadow:var(--raise);
  transition:border-color .15s,box-shadow .15s,transform .15s}
.card p{margin:0;color:var(--ink-2);font-size:.93rem}
.card p+p{margin-top:5px}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:14px}
.grid{display:grid;gap:9px;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))}
.tag{font-size:.69rem;text-transform:uppercase;letter-spacing:.075em;font-weight:650;
  color:var(--ink-3);background:var(--surface-2);border:1px solid var(--line);
  border-radius:6px;padding:3px 8px;white-space:nowrap;flex:none}
.tag.due{color:var(--signal);background:var(--signal-soft);
  border-color:color-mix(in srgb,var(--signal) 40%,transparent)}
.tag.ok{color:var(--ok);background:var(--ok-soft);
  border-color:color-mix(in srgb,var(--ok) 40%,transparent)}

/* forms */
form{margin:0}
textarea,input[type=text],input[type=search],input[type=number],select{width:100%;
  background:var(--surface);color:var(--ink);border:1px solid var(--line-2);
  border-radius:var(--radius);padding:12px 14px;font:inherit;font-size:16px;resize:vertical;
  transition:border-color .15s,box-shadow .15s}
textarea:focus,input:focus,select:focus{outline:none;border-color:var(--accent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
button{background:var(--accent);color:var(--bg);border:0;border-radius:var(--radius);
  padding:12px 20px;font:inherit;font-weight:650;cursor:pointer;margin-top:10px;
  min-height:44px;transition:filter .15s,transform .06s}
button:hover{filter:brightness(1.08)}
button:active{transform:translateY(1px)}

/* bits */
.empty{color:var(--ink-3);font-size:.93rem;padding:22px 0;border:1px dashed var(--line);
  border-radius:var(--radius);text-align:center;margin-bottom:9px}
.hit{border-left:2px solid var(--accent);padding:2px 0 2px 14px;margin-bottom:16px}
.hit time{display:block;font-size:.73rem;color:var(--ink-3);margin-bottom:3px;
  letter-spacing:.03em;font-variant-numeric:tabular-nums}
.msg{margin-bottom:16px}
.msg .who{font-size:.7rem;text-transform:uppercase;letter-spacing:.09em;
  color:var(--ink-3);font-weight:650}
.bubble{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  padding:12px 15px;margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere;
  box-shadow:var(--raise)}
.msg.me .bubble{background:var(--accent-soft);
  border-color:color-mix(in srgb,var(--accent) 26%,transparent)}
/* chat: history scrolls, composer stays put, newest at the bottom like every
   other chat he uses. The alternative is typing at the top and reading down. */
.chat{display:flex;flex-direction:column;gap:0;height:calc(100dvh - 190px);min-height:340px}
.log{flex:1;overflow-y:auto;padding:4px 2px 14px;overscroll-behavior:contain}
.composer{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--line);
  padding:12px 0 calc(12px + env(safe-area-inset-bottom));display:flex;gap:9px;align-items:flex-end}
.composer textarea{flex:1;max-height:160px;min-height:48px;margin:0}
.composer button{margin:0;flex:none}
.composer button[disabled]{opacity:.55;cursor:progress}
.msg:last-child{margin-bottom:0}
.flash{background:var(--accent-soft);border:1px solid var(--accent);color:var(--accent-ink);
  border-radius:var(--radius);padding:12px 15px;margin-bottom:18px;font-size:.93rem}

/* Desktop gets a real sidebar. Twelve pills in a scroll strip is fine on a
   phone and miserable on a laptop, where half of them are always off-screen. */
@media (min-width:900px){
  .shell{display:grid;grid-template-columns:232px minmax(0,1fr);
    max-width:1280px;margin:0 auto;min-height:100vh}
  header{display:none}
  .side{display:block;border-right:1px solid var(--line);padding:26px 14px 40px;
    position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto}
  .side .brand{display:flex;align-items:center;gap:9px;padding:0 10px 22px;
    font-weight:680;letter-spacing:-.021em}
  .side-group{display:block;margin-bottom:20px}
  .side-label{display:block;font-size:.67rem;text-transform:uppercase;letter-spacing:.11em;
    color:var(--ink-3);font-weight:680;padding:0 10px 7px}
  .side a{display:block;padding:8px 10px;border-radius:9px;font-size:.94rem;font-weight:500;
    color:var(--ink-2);margin-bottom:1px;transition:background .13s,color .13s}
  .side a:hover{background:var(--surface-2);color:var(--ink);text-decoration:none}
  .side a.on{background:var(--accent-soft);color:var(--accent-ink);font-weight:640}
  main{padding:40px 44px 96px;max-width:860px;margin:0}
  .card:hover{border-color:var(--line-2);box-shadow:var(--raise-2);transform:translateY(-1px)}
  h2{margin-top:40px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media print{.side,header{display:none}.shell{display:block}main{padding:0;max-width:none}}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <aside class="side">
    <div class="brand"><span class="dot"></span>Second Steven</div>
    ${links("side")}
  </aside>
  <div>
    <header>
      <div class="bar"><span class="dot"></span><b>Second Steven</b></div>
      <nav class="tabs" aria-label="Sections">${links("tabs")}</nav>
    </header>
    <main id="main">${body}</main>
  </div>
</div>
</body></html>`;
}

export const MANIFEST = JSON.stringify({
  name: "Second Steven",
  short_name: "Sven",
  start_url: "/",
  display: "standalone",
  background_color: "#101614",
  theme_color: "#101614",
  icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }],
});
