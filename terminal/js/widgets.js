// TradingView embeds (free, real-time streaming widgets).
// https://www.tradingview.com/widget-docs/

const BASE = 'https://s3.tradingview.com/external-embedding/embed-widget-';

export function mountTV(host, kind, config) {
  if (!host) return;
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'tradingview-widget-container';
  wrap.style.cssText = 'width:100%;height:100%';
  const inner = document.createElement('div');
  inner.className = 'tradingview-widget-container__widget';
  inner.style.cssText = 'width:100%;height:100%';
  const s = document.createElement('script');
  s.src = `${BASE}${kind}.js`;
  s.async = true;
  s.type = 'text/javascript';
  s.textContent = JSON.stringify(config);
  wrap.append(inner, s);
  host.append(wrap);
}

export function tickerTape(host, cfg) {
  const symbols = [
    ...cfg.instruments.filter(i => i.tv).map(i => ({ proName: i.tv, title: i.label })),
    { proName: 'CBOE:VIX', title: 'VIX' },
    { proName: 'TVC:DXY', title: 'DXY' },
    { proName: 'TVC:US10Y', title: 'US10Y' },
    { proName: 'FX:EURUSD', title: 'EURUSD' },
    { proName: 'FX:USDJPY', title: 'USDJPY' },
  ];
  mountTV(host, 'ticker-tape', {
    symbols, showSymbolLogo: false, isTransparent: true, displayMode: 'compact', colorTheme: 'dark', locale: 'en',
  });
}

export function heatmap(host, cfg) {
  mountTV(host, 'stock-heatmap', {
    exchanges: [], dataSource: cfg.heatmapSource, grouping: 'sector', blockSize: 'market_cap_basic',
    blockColor: 'change', locale: 'en', symbolUrl: '', colorTheme: 'dark', hasTopBar: true,
    isDataSetEnabled: true, isZoomEnabled: true, hasSymbolTooltip: true, isMonoSize: false,
    width: '100%', height: '100%',
  });
}

export function chart(host, symbol, cfg) {
  mountTV(host, 'advanced-chart', {
    autosize: true, symbol, interval: cfg.chartInterval, timezone: 'America/New_York', theme: 'dark',
    style: '1', locale: 'en', backgroundColor: 'rgba(0,0,0,1)', gridColor: 'rgba(40,40,40,0.6)',
    allow_symbol_change: true, hide_side_toolbar: true, calendar: false, withdateranges: true,
    studies: ['STD;VWAP'], support_host: 'https://www.tradingview.com',
  });
}

export function econCalendar(host) {
  mountTV(host, 'events', {
    colorTheme: 'dark', isTransparent: true, width: '100%', height: '100%', locale: 'en',
    importanceFilter: '0,1', countryFilter: 'us',
  });
}

export function newsTimeline(host) {
  mountTV(host, 'timeline', {
    feedMode: 'market', market: 'index', isTransparent: true, displayMode: 'regular',
    width: '100%', height: '100%', colorTheme: 'dark', locale: 'en',
  });
}
