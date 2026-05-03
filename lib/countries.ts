// Country-name → ISO 3166-1 alpha-2 mapping.
//
// BrandProfile.markets stores human-readable strings ("India", "SEA",
// "MEA", "United States"). The Google Trends connector wants ISO codes
// ("IN", "US", "GB"). This mapping lives in one place so both the
// ingest layer (driving fan-out geo) and any future UI dropdown can
// translate consistently.
//
// We keep the map intentionally short — the most common 30 markets
// for our buyer base. Anything unmatched falls through to the explicit
// `gtrendsGeoOverride` (env / credential) and finally to 'IN' (the
// reference brand's primary market).

const MAP: Record<string, string> = {
  // Single-country names
  'india': 'IN',
  'united states': 'US',
  'usa': 'US',
  'us': 'US',
  'united kingdom': 'GB',
  'uk': 'GB',
  'great britain': 'GB',
  'canada': 'CA',
  'australia': 'AU',
  'germany': 'DE',
  'france': 'FR',
  'spain': 'ES',
  'italy': 'IT',
  'netherlands': 'NL',
  'brazil': 'BR',
  'mexico': 'MX',
  'argentina': 'AR',
  'japan': 'JP',
  'south korea': 'KR',
  'korea': 'KR',
  'china': 'CN',
  'singapore': 'SG',
  'indonesia': 'ID',
  'philippines': 'PH',
  'thailand': 'TH',
  'vietnam': 'VN',
  'malaysia': 'MY',
  'south africa': 'ZA',
  'nigeria': 'NG',
  'egypt': 'EG',
  'uae': 'AE',
  'saudi arabia': 'SA',
  'turkey': 'TR',
  'israel': 'IL',
  // Region aliases — pick the largest single-market proxy. SEA → SG
  // because SG drives the most Google Trends volume in the region;
  // operators wanting per-market splits should set markets explicitly.
  'sea': 'SG',
  'south east asia': 'SG',
  'mea': 'AE',
  'middle east': 'AE',
  'apac': 'IN',
  'eu': 'DE',
  'europe': 'DE',
  'latam': 'BR',
  'latin america': 'BR',
};

/** Resolve a free-text country / region name to a Google-Trends-friendly
 *  ISO 3166-1 alpha-2 code. Returns undefined when the input doesn't
 *  match any mapping — callers should fall back to 'IN' (or whatever the
 *  legacy default is). */
export function countryToIso(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase();
  if (key.length === 2) return key.toUpperCase(); // already ISO
  return MAP[key];
}

/** Pick the primary geo for a brand from its markets list. Resolves
 *  the first market string to an ISO code; falls back to 'IN' if no
 *  market is set or none resolve. */
export function primaryGeoForBrand(markets: string[] | undefined): string {
  for (const m of markets ?? []) {
    const iso = countryToIso(m);
    if (iso) return iso;
  }
  return 'IN';
}
