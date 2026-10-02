TTT TERMINAL - run it from a folder on your PC
==============================================

1. Keep these three files together in one folder:
     Start-Terminal.bat   <- double-click this
     TTT-Server.ps1       (local data helper, uses built-in Windows PowerShell)
     TTT-Terminal.html    (the terminal itself)

2. Double-click Start-Terminal.bat.
   A small window opens ("data helper") and the terminal opens in your browser
   at http://localhost:8787. Keep that small window open while you trade;
   close it when you are done.

Why the helper? Browsers do not let a web page read Yahoo Finance, Nasdaq or
news feeds directly. The helper runs only on your PC (localhost, not reachable
from other computers), fetches those sources for the page, and caches them
briefly. It can only fetch the market-data and news sites listed at the top of
TTT-Server.ps1.

Troubleshooting
- "Windows protected your PC": click More info -> Run anyway (the files are
  plain text; open them in Notepad if you want to check them first).
- If you downloaded these files as a zip, right-click the zip -> Properties ->
  tick "Unblock" before you extract it.
- If the window says the port is in use, the helper is already running; just
  open http://localhost:8787 in your browser.
- Opening TTT-Terminal.html directly (double-clicking it) still works for the
  TradingView heat map and chart, but futures, news, earnings and the calendar
  need the helper.
