import { randomBytes } from "node:crypto";
import type { Response } from "express";
import type { CallbackOutcome } from "./connection.service.js";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** JSON safe to embed inside a <script> element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * The OAuth popup/tab landing page: tells the opener (only at the app's origin) and closes, or
 * falls back to a redirect to `${appUrl}/jira?jira=...`. Inline script runs under a per-response
 * CSP nonce; the opener policy is relaxed so the app window can still be reached.
 */
export function sendCallbackPage(res: Response, outcome: CallbackOutcome, appUrl: string): void {
  const nonce = randomBytes(16).toString("base64");
  const app = new URL(appUrl);
  const back = new URL("/jira", app);
  if (outcome.result) back.searchParams.set("jira", outcome.result);
  const script = `<script nonce="${nonce}">
(function(){
  var target=${scriptJson(back.toString())};
  try{
    if(window.opener&&!window.opener.closed){
      window.opener.postMessage({source:"spacescope-jira-oauth",status:${scriptJson(outcome.status)}},${scriptJson(app.origin)});
      window.close();
      return;
    }
  }catch(e){}
  location.replace(target);
})();
</script>`;
  const title = escapeHtml(outcome.title);
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;background:#0b1020;color:#e6e9f2;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:20px">${title}</h1><p style="opacity:.8">${escapeHtml(outcome.message)}</p>
<p style="opacity:.6">Returning to the app…</p>${script}
</div></body>`;
  res
    .status(200)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "Cross-Origin-Opener-Policy": "unsafe-none",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    })
    .send(html);
}
