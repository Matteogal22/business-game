// Motore di simulazione: funzione pura, nessun accesso al database. Vale per qualsiasi settore.
// Input: parametri della partita (settore incluso), stato precedente dei gruppi, decisioni, eventi attivi, moduli del round.
// Output: nuovi KPI per gruppo + punteggio scomposto e classifica.
const { MARKETS, SOURCING, CREDIT } = require('./defaults');
const { MARGIN, OBSOLESCENCE } = require('./sectors');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

// Combina gli effetti di tutti gli eventi attivi nel round
function aggregateEvents(events, segmentKeys) {
  const agg = {
    demandByMarket: Object.fromEntries(MARKETS.map((m) => [m, 1])),
    demandBySegment: Object.fromEntries(segmentKeys.map((s) => [s, 1])),
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
    for (const s of segmentKeys) {
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

// Un segmento "di prestigio" (clienti poco sensibili al prezzo) penalizza i prezzi troppo bassi
const isPrestige = (seg) => seg.elasticity < 0.8;

/**
 * @param {object} params   parametri partita (vedi paramsForSector)
 * @param {Array}  players  [{ groupId, startup:{segment,market,category}, prev:{cash,brand,quality,sustainability,inventory,cumProfit}, decision }]
 * @param {Array}  events   [{ title, effects }]
 * @param {object} modules  moduli attivi in questo round: { sourcing, credit, ... }
 */
function simulateRound(params, players, events, modules = {}) {
  const segKeys = Object.keys(params.segments);
  const ev = aggregateEvents(events, segKeys);
  const susPref = (params.sustainabilityPreference || 0) + ev.sustainabilityPreferenceDelta;
  const wBrand = (params.weights && params.weights.brand) ?? 0.9;
  const wQuality = (params.weights && params.weights.quality) ?? 0.6;
  const firstChannel = Object.keys(params.channels)[0];

  // 1) aggiorna asset (brand, qualità, sostenibilità) e calcola attrattività
  const rows = players.map((p) => {
    const d = p.decision;
    const seg = params.segments[p.startup.segment];
    const ch = params.channels[d.channel] || params.channels[firstChannel];
    const cat = (params.categories && params.categories[p.startup.category]) || { margin: 'medio', obsolescence: 'medio' };
    const src = modules.sourcing ? SOURCING[d.sourcing] || SOURCING.europa : null;
    const shock = p.prev.sustainability < 40 ? ev.lowSustainabilityBrandShock : 0;

    const brand = clamp(grow(p.prev.brand, d.marketing, params.decay.brand) - shock, 0, 100);
    const quality = clamp(grow(p.prev.quality, d.design, params.decay.quality) + (src ? src.quality : 0), 0, 100);
    const sustainability = clamp(grow(p.prev.sustainability, d.sustainability, params.decay.sustainability) + (src ? src.sustainability : 0), 0, 100);

    // Gli aumenti di costo dovuti agli eventi colpiscono di più le filiere lunghe (produzione lontana)
    const eventCost = 1 + (ev.costMultiplier - 1) * (src ? src.eventExposure : 1);
    const unitCost = seg.unitCost
      * (MARGIN[cat.margin] || 1)
      * (src ? src.cost : 1)
      * (1 + (quality - 50) / 150)
      * (1 + (sustainability - 50) / 300)
      * eventCost
      * (1 + ev.tariffByMarket[p.startup.market]);

    const priceRatio = d.price / seg.refPrice;
    let priceFactor = Math.pow(priceRatio, -seg.elasticity);
    if (isPrestige(seg) && priceRatio < 0.6) priceFactor *= priceRatio / 0.6; // prezzo troppo basso: perde prestigio
    const attractiveness = priceFactor
      * Math.pow((brand + 5) / 50, wBrand)
      * Math.pow((quality + 5) / 50, wQuality)
      * Math.max(0.2, 1 + susPref * (sustainability - 50) / 100)
      * ((ch.reach && ch.reach[p.startup.segment]) || 1);

    return { p, d, seg, ch, cat, src, brand, quality, sustainability, unitCost, attractiveness, shock };
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
      * ev.demandByMarket[market] * (ev.demandBySegment[segment] ?? 1);
    const sumA = list.reduce((s, r) => s + r.attractiveness, 0) + (params.outsideOption || 0);
    for (const r of list) { r.poolDemand = D; r.demand = sumA > 0 ? D * r.attractiveness / sumA : 0; r.competitors = list.length; }
  }

  // 3) conto economico
  const results = rows.map((r) => {
    const { p, d, ch, cat } = r;
    const available = p.prev.inventory + d.production;
    const sold = Math.min(available, r.demand);
    const lost = Math.max(0, r.demand - sold);
    const leftover = available - sold;
    // Deperibilità della categoria: parte dell'invenduto si perde (passa di stagione, scade, diventa obsoleto)
    const obs = OBSOLESCENCE[cat.obsolescence] ?? 0.25;
    const spoiled = leftover * obs;
    const inventory = leftover - spoiled;
    const revenue = sold * d.price * (ch.priceShare ?? 1);
    const productionCost = d.production * r.unitCost;
    const holdingCost = inventory * r.unitCost * (params.holdingCostRate || 0);
    const fixed = params.fixedCostPerRound + (ch.fixedCost || 0);
    let totalCosts = productionCost + d.marketing + d.design + d.sustainability + fixed + holdingCost;
    let profit = revenue - totalCosts;
    let cash = p.prev.cash + profit;
    // Modulo fido bancario: la cassa negativa è un debito che costa interessi
    let interest = 0;
    if (modules.credit && cash < 0) {
      interest = -cash * CREDIT.interestRate;
      totalCosts += interest; profit -= interest; cash -= interest;
    }
    return {
      groupId: p.groupId,
      revenue: round2(revenue),
      units_sold: Math.round(sold),
      lost_sales: Math.round(lost),
      inventory: Math.round(inventory),
      total_costs: round2(totalCosts),
      profit: round2(profit),
      cum_profit: round2(p.prev.cumProfit + profit),
      cash: round2(cash),
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
        spoiled: Math.round(spoiled),
        interest: round2(interest),
        sourcing: r.src ? d.sourcing : null,
        costs: {
          production: round2(productionCost), marketing: d.marketing, design: d.design,
          sustainability: d.sustainability, fixed: round2(fixed), holding: round2(holdingCost), interest: round2(interest),
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
    const parts = {};
    for (const [k, field] of Object.entries(comps)) {
      const pts = norm[k](r[field]);
      parts[k] = { points: round2(pts), weight: round2((w[k] || 0) / wSum) };
      s += (w[k] || 0) * pts;
    }
    r.score = round2(s / wSum);
    r.details.scoreParts = parts; // per spiegare il punteggio a studenti e docente
  }
  const ranked = [...results].sort((a, b) => b.score - a.score || b.cum_profit - a.cum_profit);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return { results, aggregatedEvents: ev };
}

module.exports = { simulateRound, aggregateEvents, grow, isPrestige };
