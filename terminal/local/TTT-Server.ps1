# TTT Terminal - local data helper (Windows PowerShell 5.1+ / PowerShell 7)
#
# Serves TTT-Terminal.html at http://localhost:8787 and fetches market data /
# news for it. Browsers block a web page from reading Yahoo Finance, Nasdaq
# and most RSS feeds directly; this helper runs on your PC and does it for the
# page. Nothing to install - double-click Start-Terminal.bat.
#
# Only the hosts listed in $AllowedHosts can be fetched, and the server only
# listens on localhost (not reachable from other machines).

param([int]$Port = 8787, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PagePath = Join-Path $Root 'TTT-Terminal.html'

$AllowedHosts = @(
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'finance.yahoo.com',
  'api.nasdaq.com', 'nfs.faireconomy.media', 'api.exchange.coinbase.com',
  'feeds.content.dowjones.io', 'search.cnbc.com', 'www.cnbc.com', 'www.investing.com',
  'news.google.com', 'www.federalreserve.gov', 'oilprice.com', 'seekingalpha.com', 'www.coindesk.com'
)
# seconds to cache each host's responses (keeps refreshes fast and polite)
$CacheSeconds = @{
  'query1.finance.yahoo.com' = 15; 'query2.finance.yahoo.com' = 15; 'api.exchange.coinbase.com' = 10
  'api.nasdaq.com' = 1800; 'nfs.faireconomy.media' = 1800
}
$Cache = @{}

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

function Send-Bytes($Response, [int]$Status, [string]$ContentType, [byte[]]$Bytes) {
  $Response.StatusCode = $Status
  if ($ContentType) { $Response.ContentType = $ContentType }
  $Response.Headers.Add('Access-Control-Allow-Origin', '*')
  $Response.Headers.Add('Cache-Control', 'no-store')
  $Response.ContentLength64 = $Bytes.Length
  $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
}
function Send-Text($Response, [int]$Status, [string]$Text) {
  Send-Bytes $Response $Status 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($Text))
}

function Invoke-Upstream([Uri]$Uri) {
  $req = [Net.HttpWebRequest]::Create($Uri)
  $req.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
  $req.Accept = 'application/json, application/rss+xml, application/xml, text/xml, */*'
  $req.Headers.Add('Accept-Language', 'en-US,en;q=0.9')
  $req.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
  $req.Timeout = 15000
  $req.ReadWriteTimeout = 15000
  try { $resp = $req.GetResponse() }
  catch [Net.WebException] {
    $resp = $_.Exception.Response
    if (-not $resp) { throw }
  }
  try {
    $ms = New-Object IO.MemoryStream
    $resp.GetResponseStream().CopyTo($ms)
    return @{ Status = [int]$resp.StatusCode; Type = $resp.ContentType; Body = $ms.ToArray() }
  } finally { $resp.Close() }
}

function Handle-Proxy($Response, [string]$Target) {
  $uri = $null
  if (-not [Uri]::TryCreate($Target, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https') {
    Send-Text $Response 400 'Missing or bad ?url='; return
  }
  if ($AllowedHosts -notcontains $uri.Host) { Send-Text $Response 403 "Host not allowed: $($uri.Host)"; return }

  $key = $uri.AbsoluteUri
  $hit = $Cache[$key]
  if ($hit -and $hit.Expires -gt (Get-Date)) { Send-Bytes $Response $hit.Status $hit.Type $hit.Body; return }

  $r = Invoke-Upstream $uri
  $ttl = 120
  if ($CacheSeconds.ContainsKey($uri.Host)) { $ttl = $CacheSeconds[$uri.Host] }
  if ($r.Status -eq 200) {
    $Cache[$key] = @{ Status = 200; Type = $r.Type; Body = $r.Body; Expires = (Get-Date).AddSeconds($ttl) }
    if ($Cache.Count -gt 500) { $Cache.Clear() }
  }
  Send-Bytes $Response $r.Status $r.Type $r.Body
}

function Handle-Page($Response) {
  if (-not (Test-Path $PagePath)) { Send-Text $Response 404 "TTT-Terminal.html not found next to this script ($Root)"; return }
  $html = [IO.File]::ReadAllText($PagePath, [Text.Encoding]::UTF8)
  # tell the page it can use this helper for data
  $html = $html.Replace('<head>', '<head><script>window.TTT_LOCAL_PROXY = true;</script>')
  Send-Bytes $Response 200 'text/html; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($html))
}

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() }
catch {
  Write-Host "Could not start on port $Port. It may already be running - try opening http://localhost:$Port/" -ForegroundColor Yellow
  Write-Host $_.Exception.Message
  if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  TTT TERMINAL - local data helper' -ForegroundColor Cyan
Write-Host "  Running at $url"
Write-Host '  Keep this window open while you use the terminal. Close it to stop.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $target = $ctx.Request.QueryString['url']
      $path = $ctx.Request.Url.AbsolutePath
      if ($ctx.Request.HttpMethod -eq 'OPTIONS') {
        $res.Headers.Add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        $res.Headers.Add('Access-Control-Allow-Headers', '*')
        Send-Bytes $res 204 $null ([byte[]]@())
      }
      elseif ($target) { Handle-Proxy $res $target }
      elseif ($path -eq '/' -or $path -eq '/index.html' -or $path -eq '/TTT-Terminal.html') { Handle-Page $res }
      elseif ($path -eq '/ping') { Send-Text $res 200 'ok' }
      else { Send-Text $res 404 'Not found' }
    }
    catch {
      try { Send-Text $res 502 ("upstream error: " + $_.Exception.Message) } catch { }
    }
    finally { try { $res.Close() } catch { } }
  }
}
finally { $listener.Stop() }
