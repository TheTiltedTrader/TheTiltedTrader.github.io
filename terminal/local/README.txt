TTT TERMINAL - run it from a folder on your PC
==============================================

1. Save TTT-Terminal.html anywhere on your PC and double-click it.

2. The first time, a "Connect live data" screen walks you through a one-time,
   ~5 minute setup of a free Cloudflare Worker that relays the market data
   and news. It runs in Cloudflare's cloud - nothing is installed or run on
   your PC, so it works with Windows Smart App Control. You can reopen the
   screen any time with the CONNECT DATA button (shown while not connected).

Why a relay? Browsers do not let a web page read Yahoo Finance, Nasdaq or
news feeds directly. The relay fetches only the market-data and news sites
the terminal uses (listed at the top of its code) and answers only this page.

Optional, for PCs that allow scripts (NOT ones with Smart App Control on):
Start-Terminal.bat + TTT-Server.ps1 run the same relay locally instead of on
Cloudflare. Keep all three files in one folder and double-click the .bat.
