// Parametri di default del modello e catalogo eventi geopolitici iniziale.
// Il docente può modificarli per ogni partita dalla dashboard (parametri ed eventi personalizzati).

const DEFAULT_PARAMS = {
  startingCash: 500000,          // cassa iniziale (€)
  fixedCostPerRound: 40000,      // costi fissi per round (€)
  outsideOption: 1.5,            // attrattività del "non acquisto": più alto = mercato più difficile
  sustainabilityPreference: 0.3, // quanto i clienti premiano la sostenibilità (0-1)
  holdingCostRate: 0.1,          // costo di magazzino per unità invenduta (% del costo unitario)
  start: { brand: 30, quality: 40, sustainability: 30 },
  decay: { brand: 0.05, quality: 0.08, sustainability: 0.05 }, // erosione per round se non si investe
  segments: {
    premium: { label: 'Fashion premium', refPrice: 180, elasticity: 1.5, baseDemand: 12000, unitCost: 55 },
    luxury:  { label: 'Luxury',          refPrice: 900, elasticity: 0.5, baseDemand: 2500,  unitCost: 220 },
  },
  markets: {
    EU:   { label: 'Europa',     demandWeight: 1.0 },
    US:   { label: 'Stati Uniti', demandWeight: 1.1 },
    ASIA: { label: 'Asia',       demandWeight: 1.2 },
  },
  channels: {
    ecommerce: { label: 'E-commerce diretto', reach: { premium: 1.0, luxury: 0.8 }, priceShare: 1.0, fixedCost: 5000 },
    boutique:  { label: 'Boutique monomarca', reach: { premium: 0.9, luxury: 1.25 }, priceShare: 1.0, fixedCost: 30000 },
    wholesale: { label: 'Wholesale / multibrand', reach: { premium: 1.35, luxury: 1.1 }, priceShare: 0.6, fixedCost: 0 },
  },
  scoreWeights: { cumProfit: 0.3, brand: 0.2, marketShare: 0.2, sustainability: 0.15, cash: 0.15 },
  judgmentWeight: 0.4,           // peso del giudizio finale del docente (0-1)
  preset: 'standard',
};

// Preset di difficoltà: modificano solo i parametri economici principali
const PRESETS = {
  facile: {
    label: 'Facile', startingCash: 700000, fixedCostPerRound: 30000, outsideOption: 1.0,
    segments: { premium: { baseDemand: 14000, elasticity: 1.3 }, luxury: { baseDemand: 3000, elasticity: 0.4 } },
  },
  standard: {
    label: 'Standard', startingCash: 500000, fixedCostPerRound: 40000, outsideOption: 1.5,
    segments: { premium: { baseDemand: 12000, elasticity: 1.5 }, luxury: { baseDemand: 2500, elasticity: 0.5 } },
  },
  sfidante: {
    label: 'Sfidante', startingCash: 400000, fixedCostPerRound: 50000, outsideOption: 2.2,
    segments: { premium: { baseDemand: 10000, elasticity: 1.8 }, luxury: { baseDemand: 2000, elasticity: 0.65 } },
  },
};

// Struttura effetti di un evento (tutti opzionali):
//  demandByMarket:  { EU, US, ASIA }        moltiplicatori di domanda (1 = nessun effetto)
//  demandBySegment: { premium, luxury }     moltiplicatori di domanda
//  costMultiplier:  numero                  moltiplicatore sul costo unitario per tutti
//  tariffByMarket:  { EU, US, ASIA }        dazio aggiuntivo sul costo unitario (0.15 = +15%)
//  lowSustainabilityBrandShock: numero      punti brand persi da chi ha sostenibilità < 40
//  sustainabilityPreferenceDelta: numero    aumento temporaneo della sensibilità green dei clienti
const DEFAULT_EVENTS = [
  { title: 'Dazi USA sui beni europei', description: 'Gli Stati Uniti introducono un dazio del 15% sui beni di moda importati.',
    effects: { tariffByMarket: { US: 0.15 }, demandByMarket: { US: 0.95 } } },
  { title: 'Rallentamento dei consumi in Cina', description: 'La crescita cinese rallenta e la domanda di lusso in Asia cala.',
    effects: { demandByMarket: { ASIA: 0.8 }, demandBySegment: { luxury: 0.9 } } },
  { title: 'Crisi logistica nel Mar Rosso', description: 'Le rotte marittime si allungano: noli e tempi di consegna aumentano.',
    effects: { costMultiplier: 1.12 } },
  { title: 'Passaporto digitale UE dei prodotti', description: 'Nuove regole UE su tracciabilità e sostenibilità: i consumatori premiano i brand trasparenti.',
    effects: { lowSustainabilityBrandShock: 6, sustainabilityPreferenceDelta: 0.3 } },
  { title: 'Boom del turismo in Europa', description: 'Flussi turistici record nelle capitali europee della moda.',
    effects: { demandByMarket: { EU: 1.15 }, demandBySegment: { luxury: 1.05 } } },
  { title: 'Rincaro delle materie prime', description: 'Cotone, pelle e metalli preziosi aumentano di prezzo.',
    effects: { costMultiplier: 1.08 } },
  { title: 'Scandalo sulla filiera produttiva', description: 'Un\'inchiesta giornalistica accende i riflettori sulle condizioni di lavoro nella filiera della moda.',
    effects: { lowSustainabilityBrandShock: 10, sustainabilityPreferenceDelta: 0.2 } },
  { title: 'Accordo commerciale UE-Asia', description: 'Riduzione dei dazi e semplificazione doganale verso i mercati asiatici.',
    effects: { tariffByMarket: { ASIA: -0.05 }, demandByMarket: { ASIA: 1.08 } } },
  { title: 'Dollaro forte', description: 'Il cambio favorevole spinge gli acquisti dei turisti americani.',
    effects: { demandByMarket: { US: 1.1, EU: 1.05 } } },
];

const SEGMENTS = ['premium', 'luxury'];
const MARKETS = ['EU', 'US', 'ASIA'];
const CHANNELS = ['ecommerce', 'boutique', 'wholesale'];
const CATEGORIES = ['abbigliamento', 'accessori', 'calzature', 'gioielli', 'pelletteria'];

module.exports = { DEFAULT_PARAMS, PRESETS, DEFAULT_EVENTS, SEGMENTS, MARKETS, CHANNELS, CATEGORIES };
