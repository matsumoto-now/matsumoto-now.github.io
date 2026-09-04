/** Feature toggles.
 *
 *  Set a flag to `false` and rebuild (push) to remove a feature from the site:
 *  cards disappear, their data is no longer fetched, and disabled pages are not
 *  built at all (their nav links vanish too).
 *
 *  Example: if Weathernews declines public use of the pollen data, set
 *  `pollen: false` and push — nothing else to change.
 */
export const features = {
  /* dashboard cards — the dashboard is emergency-first: what is wrong right now,
     who to call, and recent earthquakes. Weather and air cards are on the
     weather page, so the dashboard stays scannable in an emergency. */
  warnings: true, // JMA warnings & advisories banner
  emergencyContacts: true, // fire / police / medical contact cards (static, no data feed)
  quakesPreview: true, // "Recent earthquakes" card

  /* weather-page cards */
  currentConditions: true, // "Right now" card (AMeDAS)
  hourlyTemperature: true, // 24 h temperature chart
  weekOutlook: true, // 7-day strip
  precipitationChart: true, // 24 h precipitation-probability chart
  airQuality: true, // Open-Meteo modelled air quality
  uv: true, // UV index card
  // 暑さ指数 (WBGT) and the official 熱中症警戒アラート from 環境省. Free to
  // republish under PDL 1.0 with 出典: 環境省 — no permission needed. Seasonal:
  // the ministry runs the service from late April to 21 October only.
  heatIndex: true,
  // Live temperature at every AMeDAS station inside the city limits. Matsumoto
  // spans 610 m downtown to 1,510 m at Kamikochi, so one number cannot speak
  // for the whole city.
  stationMap: true,
  moon: true, // moon phase & rise/set — computed locally, no data source
  // Soramame measured station values — OFF until Nagano Prefecture (station
  // operator) confirms republication; the Soramame API manual asks to inquire
  // for non-national stations. Data pipeline is ready (scripts/fetch-air-data.mjs).
  measuredAir: false,
  pollen: false, // Weathernews Pollen Robo — OFF until Weathernews confirms public-site use

  /* whole pages (also hidden from the nav) */
  weatherPage: true, // weather, forecast, air quality, UV (and pollen when enabled)
  earthquakesPage: true,
  alertsPage: true,
  busesPage: true, // city bus route/stop map (GTFS open data)
  sheltersPage: true, // evacuation shelters & AED map (GSI + city open data)
  medicalPage: true, // emergency medical contacts page (static, verified facts)
  safetyPage: true, // crime statistics from Nagano police open data (yearly)
  firePage: true, // fire & rescue page: 119, fire bureau contacts, wildfire rules
  // Household waste page: the collection calendar for all 41 districts (parsed
  // out of the city's per-district PDFs), calendar subscriptions, and where to
  // take what the trucks will not.
  garbagePage: true,

  // Scraped 松本広域消防局 content on the fire page: the live incident feed, 119
  // dispatch counters, wildfire-advisory status and yearly fire statistics — OFF
  // until the bureau confirms republication (their site carries no open-data
  // licence, so consent has to be asked for). The rest of the fire page needs no
  // permission and stays visible: 119, their published phone number and address,
  // links to their own pages, and the wildfire rules (from city open data).
  // Pipelines are ready: scripts/fetch-fire-data.mjs, scripts/fetch-fire-stats.mjs.
  fireLiveData: false,

  // The searchable 1,710-item 「ごみ処理辞典（ごみだす）」 on the waste page — OFF until
  // 環境業務課 confirms it falls under the CC BY 4.0 open-data listing that already
  // covers the collection calendar and the sorting guide, which the dictionary
  // pages themselves are not named in. The rest of the waste page needs no
  // permission and stays up, linking the city's own dictionary and its
  // eight-language sorting-guide PDFs. Pipeline is ready:
  // scripts/fetch-garbage-dictionary.mjs.
  garbageDictionary: false,

  resourcesPage: true,
} as const;

export type FeatureKey = keyof typeof features;
