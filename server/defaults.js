// Parametri di default del modello. Il settore (segmenti, categorie, canali, eventi) arriva da sectors.js.
// La docente può modificare i parametri di ogni partita dalla dashboard.
const { BUILTIN } = require('./sectors');

const MARKETS = ['EU', 'US', 'ASIA'];
const MODULE_KEYS = ['marketReport', 'credit', 'sourcing', 'awards'];
const SOURCING = {
  italia: { label: 'Italia', cost: 1.3, quality: 3, sustainability: 2, eventExposure: 0.5 },
  europa: { label: 'Europa', cost: 1.1, quality: 1, sustainability: 1, eventExposure: 1 },
  asia: { label: 'Asia', cost: 0.85, quality: -1, sustainability: -2, eventExposure: 1.5 },
};
const CREDIT = { interestRate: 0.08 }; // interessi per round sulla cassa negativa

const BASE_ECONOMY = {
  startingCash: 500000,          // cassa iniziale (€)
  fixedCostPerRound: 40000,      // costi fissi per round (€)
  outsideOption: 1.5,            // attrattività del "non acquisto": più alto = mercato più difficile
  sustainabilityPreference: 0.3, // quanto i clienti premiano la sostenibilità (0-1)
  holdingCostRate: 0.1,          // costo di magazzino per unità invenduta (% del costo unitario)
  start: { brand: 30, quality: 40, sustainability: 30 },
  markets: {
    EU: { label: 'Europa', demandWeight: 1.0 },
    US: { label: 'Stati Uniti', demandWeight: 1.1 },
    ASIA: { label: 'Asia', demandWeight: 1.2 },
  },
  scoreWeights: { cumProfit: 0.3, brand: 0.2, marketShare: 0.2, sustainability: 0.15, cash: 0.15 },
  judgmentWeight: 0.4,           // peso del giudizio finale del docente (0-1)
  preset: 'standard',
  modules: { marketReport: false, credit: false, sourcing: false, awards: false },
};

// Preset di difficoltà: cassa e spese fisse assolute, domanda ed elasticità relative al settore scelto
const PRESETS = {
  facile: { label: 'Facile', startingCash: 700000, fixedCostPerRound: 30000, outsideOption: 1.0, demandMult: 1.15, elasticityMult: 0.87 },
  standard: { label: 'Standard', startingCash: 500000, fixedCostPerRound: 40000, outsideOption: 1.5, demandMult: 1, elasticityMult: 1 },
  sfidante: { label: 'Sfidante', startingCash: 400000, fixedCostPerRound: 50000, outsideOption: 2.2, demandMult: 0.82, elasticityMult: 1.2 },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// Parametri completi di una partita a partire da un settore
function paramsForSector(key, sector) {
  const p = clone(BASE_ECONOMY);
  p.sector = { key, label: sector.label, productWord: sector.productWord, rules: sector.rules || [] };
  p.segments = clone(sector.segments);
  p.sectorBase = clone(sector.segments);         // valori originali, per i preset
  p.categories = clone(sector.categories);
  p.channels = clone(sector.channels);
  p.weights = clone(sector.weights || { brand: 1.0, quality: 0.6 });
  p.decay = clone(sector.decay || { brand: 0.05, quality: 0.08, sustainability: 0.05 });
  return p;
}

function applyPreset(p, presetKey) {
  const pr = PRESETS[presetKey];
  if (!pr) return p;
  p.preset = presetKey;
  p.startingCash = pr.startingCash; p.fixedCostPerRound = pr.fixedCostPerRound; p.outsideOption = pr.outsideOption;
  for (const [k, base] of Object.entries(p.sectorBase || {})) {
    if (!p.segments[k]) continue;
    p.segments[k].baseDemand = Math.round(base.baseDemand * pr.demandMult);
    p.segments[k].elasticity = Math.round(base.elasticity * pr.elasticityMult * 100) / 100;
  }
  return p;
}

// Compatibilità: le partite create prima dei settori sono partite di moda
const DEFAULT_PARAMS = paramsForSector('moda', BUILTIN.moda);
const DEFAULT_EVENTS = BUILTIN.moda.events;

module.exports = { DEFAULT_PARAMS, BASE_ECONOMY, PRESETS, DEFAULT_EVENTS, MARKETS, MODULE_KEYS, SOURCING, CREDIT, paramsForSector, applyPreset, clone };
