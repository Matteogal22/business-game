// Motore di simulazione: funzione pura, nessun accesso al database.
// Input: parametri della partita, stato precedente di ogni gruppo, decisioni del round, eventi attivi.
// Output: nuovi KPI per gruppo + punteggio e classifica.
const { MARKETS, SEGMENTS } = require('./defaults');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

// Combina gli effetti di tutti gli eventi attivi nel round
function aggregateEvents(events) {
  const agg = {
    demandByMarket: Object.fromEntries(MARKETS.map((m) => [m, 1])),
    demandBySegment: Object.fromEntries(SEGMENTS.map((s) => [s, 1])),
    costMultiplier: 1,
    tariffByMarket: Object.fromEntries(MARKETS.map((m) => [m, 0])),
    lowSustainabilityBrandShock: 0,
    sustainabilityPreferenceDelta: 0,
  };
  for (const ev of events) {
    const e = ev.effects || {};
    for (const m of MARKETS) {
      if (e.demandByMarket && Number.isFinite(e.demandByMarket[m])) agg.demandByMarket[m] *= e.demandByMarket[m];
      if (e.tariffByMarket && Number.isFinite(e.tariffByMarket[m])) agg.tariffByMarket[m] += e.tariffByMarket[m];
    }
    for (const s of SEGMENTS) {
      if (e.demandBySegment && Number.isFinite(e.demandBySegment[s])) agg.demandBySegment[s] *= e.demandBySegment[s];
    }
    if (Number.isFinite(e.costMultiplier)) agg.costMultiplier *= e.costMultiplier;
    if (Number.isFinite(e.lowSustainabilityBrandShock)) agg.lowSustainabilityBrandShock += e.lowSustainabilityBrandShock;
    if (Number.isFinite(e.sustainabilityPreferenceDelta)) agg.sustainabilityPreferenceDelta += e.sustainabilityPreferenceDelta;
  }
  return agg;
}

// Investimento con rendimenti decrescenti: si avvicina a 100 ma non lo supera
function grow(level, spend, decay, scale = 20000, power = 12) {
  const gain = power * Math.log(1 + Math.max(0, spend) / scale);
  return clamp(level + gain * (1 - level / 100) - decay * level, 0, 100);
}

/**
 * @param {object} params   parametri partita (vedi DEFAULT_PARAMS)
 * @param {Array}  players  [{ groupId, startup:{segment,market}, prev:{cash,brand,quality,sustainability,inventory,cumProfit}, decision }]
 * @param {Array}  events   [{ title, effects }]
 */
function simulateRound(params, players, events) {
  const ev = aggregateEvents(events);
  const susPref = (params.sustainabilityPreference || 0) + ev.sustainabilityPreferenceDelta;

  // 1) aggiorna asset (brand, qualità, sostenibilità) e calcola attrattività
  const rows = players.map((p) => {
    const d = p.decision;
    const seg = params.segments[p.startup.segment];
    const ch = params.channels[d.channel] || params.channels.ecommerce;
    const shock = p.prev.sustainability < 40 ? ev.lowSustainabilityBrandShock : 0;

    const brand = clamp(grow(p.prev.brand, d.marketing, params.decay.brand) - shock, 0, 100);
    const quality = grow(p.prev.quality, d.design, params.decay.quality);
    const sustainability = grow(p.prev.sustainability, d.sustainability, params.decay.sustainability);

    const unitCost = seg.unitCost
      * (1 + (quality - 50) / 150)
      * (1 + (sustainability - 50) / 300)
      * ev.costMultiplier
      * (1 + ev.tariffByMarket[p.startup.market]);

    const priceRatio = d.price / seg.refPrice;
    let priceFactor = Math.pow(priceRatio, -seg.elasticity);
    // Nel lusso un prezzo troppo basso diluisce il posizionamento
    if (p.startup.segment === 'luxury' && priceRatio < 0.6) priceFactor *= priceRatio / 0.6;
    const attractiveness = priceFactor
      * Math.pow((brand + 5) / 50, 0.9)
      * Math.pow((quality + 5) / 50, 0.6)
      * Math.max(0.2, 1 + susPref * (sustainability - 50) / 100)
      * ((ch.reach && ch.reach[p.startup.segment]) || 1);

    return { p, d, seg, ch, brand, quality, sustainability, unitCost, attractiveness, shock };
  });

  // 2) ripartisce la domanda di ogni mercato (segmento x area geografica) tra i concorrenti presenti
  const pools = {};
  for (const r of rows) {
    const key = r.p.startup.segment + '|' + r.p.startup.market;
    (pools[key] = pools[key] || []).push(r);
  }
  for (const [key, list] of Object.entries(pools)) {
    const [segment, market] = key.split('|');
    const D = params.segments[segment].baseDemand
      * ((params.markets[market] && params.markets[market].demandWeight) || 1)
      * ev.demandByMarket[market] * ev.demandBySegment[segment];
    const sumA = list.reduce((s, r) => s + r.attractiveness, 0) + (params.outsideOption || 0);
    for (const r of list) { r.poolDemand = D; r.demand = sumA > 0 ? D * r.attractiveness / sumA : 0; r.competitors = list.length; }
  }

  // 3) conto economico
  const results = rows.map((r) => {
    const { p, d, ch } = r;
    const available = p.prev.inventory + d.production;
    const sold = Math.min(available, r.demand);
    const lost = Math.max(0, r.demand - sold);
    const inventory = available - sold;
    const revenue = sold * d.price * (ch.priceShare ?? 1);
    const productionCost = d.production * r.unitCost;
    const holdingCost = inventory * r.unitCost * (params.holdingCostRate || 0);
    const fixed = params.fixedCostPerRound + (ch.fixedCost || 0);
    const totalCosts = productionCost + d.marketing + d.design + d.sustainability + fixed + holdingCost;
    const profit = revenue - totalCosts;
    return {
      groupId: p.groupId,
      revenue: round2(revenue),
      units_sold: Math.round(sold),
      lost_sales: Math.round(lost),
      inventory: Math.round(inventory),
      total_costs: round2(totalCosts),
      profit: round2(profit),
      cum_profit: round2(p.prev.cumProfit + profit),
      cash: round2(p.prev.cash + profit),
      brand: round2(r.brand),
      quality: round2(r.quality),
      sustainability: round2(r.sustainability),
      market_share: round2(r.poolDemand > 0 ? (sold / r.poolDemand) * 100 : 0),
      details: {
        unitCost: round2(r.unitCost),
        attractiveness: round2(r.attractiveness),
        demand: Math.round(r.demand),
        poolDemand: Math.round(r.poolDemand),
        competitorsInMarket: r.competitors,
        brandShockFromEvents: r.shock,
        costs: {
          production: round2(productionCost), marketing: d.marketing, design: d.design,
          sustainability: d.sustainability, fixed: round2(fixed), holding: round2(holdingCost),
        },
      },
    };
  });

  // 4) punteggio: ogni componente normalizzata 0-100 tra i gruppi, poi media pesata
  const w = params.scoreWeights;
  const comps = { cumProfit: 'cum_profit', brand: 'brand', marketShare: 'market_share', sustainability: 'sustainability', cash: 'cash' };
  const norm = {};
  for (const [k, field] of Object.entries(comps)) {
    const vals = results.map((r) => r[field]);
    const min = Math.min(...vals), max = Math.max(...vals);
    norm[k] = (v) => (max === min ? 50 : ((v - min) / (max - min)) * 100);
  }
  const wSum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  for (const r of results) {
    let s = 0;
    for (const [k, field] of Object.entries(comps)) s += (w[k] || 0) * norm[k](r[field]);
    r.score = round2(s / wSum);
  }
  const ranked = [...results].sort((a, b) => b.score - a.score || b.cum_profit - a.cum_profit);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return { results, aggregatedEvents: ev };
}

module.exports = { simulateRound, aggregateEvents };
