# Private data proxy (5 minutes, free)

Browsers block a web page from reading Yahoo Finance, Nasdaq, and most RSS feeds directly (CORS).
The terminal works out of the box through public CORS proxies. Those proxies are rate-limited and
sometimes go down, and Nasdaq (earnings) blocks most of them. Your own Cloudflare Worker fixes that.

1. Create a free account at https://dash.cloudflare.com, then open **Workers & Pages → Create → Create Worker**.
2. Name it (for example `ttt-proxy`), click **Deploy**, then **Edit code**.
3. Replace the code with the contents of [`worker.js`](worker.js) and click **Deploy**.
4. Copy the worker URL (for example `https://ttt-proxy.yourname.workers.dev`).
5. In the terminal, press **S** (Settings), paste the URL into **Your CORS proxy URL**, then click **Save & Reload**.
   You can untick "Fall back to public CORS proxies" once the worker is running.

The worker:
- only fetches from the allow-listed hosts in `ALLOWED_HOSTS`. Add a host there if you add a custom feed from another site.
- only answers pages served from the origins in `ALLOWED_ORIGINS`. Add yours if you host the page somewhere else, for example a local file server.
- caches quotes for 15–20 s and the calendar and earnings for 30 min, so a refresh stays fast and you stay far under the free tier's 100k requests/day.

**Using the local file (`TTT-Terminal.html`)?** A page opened from a folder on your PC sends the origin `null`.
`ALLOWED_ORIGINS` in `worker.js` already includes `null`, so the worker works with the local file without changes.
