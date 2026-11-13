// Settori di gioco: Moda & lusso, Beauty & cosmesi, Food & beverage, Tech + settori personalizzati della docente.
// Ogni settore definisce segmenti (fasce di mercato), categorie di prodotto, canali di vendita, eventi tipici
// e qualche regola propria (peso del brand e della qualità, velocità con cui la qualità invecchia).

// Livelli in parole semplici → numeri del motore
const MARGIN = { basso: 1.15, medio: 1.0, alto: 0.85, molto_alto: 0.7 };            // moltiplicatore sul costo di un pezzo
const MARGIN_LABEL = { basso: 'basso', medio: 'medio', alto: 'alto', molto_alto: 'molto alto' };
const OBSOLESCENCE = { nessuno: 0, basso: 0.1, medio: 0.25, alto: 0.45, totale: 1 };  // quota di invenduto persa a ogni round
const OBSOLESCENCE_LABEL = { nessuno: 'nessuno', basso: 'basso', medio: 'medio', alto: 'alto', totale: 'scade: si perde tutto' };
const SENSITIVITY = { poco: 0.5, abbastanza: 1.0, molto: 1.6 };                     // elasticità al prezzo
const CHANNEL_TYPES = {
  diretto: { label: 'Vendita diretta online', desc: 'Costo fisso basso e incassate tutto il prezzo.', priceShare: 1, fixedCost: 5000 },
  propri: { label: 'Negozi propri', desc: 'Costo fisso alto, ma è il canale migliore per le fasce alte: i clienti esigenti comprano in negozio.', priceShare: 1, fixedCost: 30000 },
  rivenditori: { label: 'Rivenditori', desc: 'Raggiungete molti più clienti tramite i negozi di altri, ma incassate solo una parte del prezzo.', priceShare: 0.6, fixedCost: 0 },
};

// Un canale "tipo" si adatta ai segmenti: i negozi propri funzionano meglio con i clienti poco sensibili al prezzo
function channelFromType(type, segments, label) {
  const t = CHANNEL_TYPES[type] || CHANNEL_TYPES.diretto;
  const reach = {};
  for (const [k, s] of Object.entries(segments)) {
    const premiumish = s.elasticity < 0.9;
    reach[k] = type === 'propri' ? (premiumish ? 1.25 : 0.9) : type === 'rivenditori' ? (premiumish ? 1.1 : 1.35) : (premiumish ? 0.8 : 1.0);
  }
  return { label: label || t.label, type, desc: t.desc, reach, priceShare: t.priceShare, fixedCost: t.fixedCost };
}

const GENERAL_EVENTS = [
  { title: 'Crisi logistica nel Mar Rosso', description: 'Le rotte marittime si allungano: noli e tempi di consegna aumentano.', effects: { costMultiplier: 1.12 } },
  { title: 'Rincaro delle materie prime', description: 'Le materie prime aumentano di prezzo su tutti i mercati.', effects: { costMultiplier: 1.08 } },
  { title: 'Dazi USA sulle importazioni', description: 'Gli Stati Uniti introducono un dazio del 15% sui prodotti importati.', effects: { tariffByMarket: { US: 0.15 }, demandByMarket: { US: 0.95 } } },
  { title: 'Rallentamento dei consumi in Asia', description: 'La crescita asiatica rallenta e i consumatori rimandano gli acquisti.', effects: { demandByMarket: { ASIA: 0.82 } } },
  { title: 'Accordo commerciale UE-Asia', description: 'Riduzione dei dazi e semplificazione doganale verso i mercati asiatici.', effects: { tariffByMarket: { ASIA: -0.05 }, demandByMarket: { ASIA: 1.08 } } },
  { title: 'Dollaro forte', description: 'Il cambio favorevole spinge gli acquisti dei consumatori americani.', effects: { demandByMarket: { US: 1.1, EU: 1.05 } } },
];

const BUILTIN = {
  moda: {
    label: 'Moda & lusso', icon: '◆', productWord: 'pezzi',
    rules: ['Stagionalità: l\'abbigliamento invenduto perde valore', 'Il brand conta moltissimo', 'Canali: boutique, e-commerce, wholesale'],
    weights: { brand: 1.0, quality: 0.6 }, decay: { brand: 0.05, quality: 0.08, sustainability: 0.05 },
    segments: {
      premium: { label: 'Fashion premium', refPrice: 180, elasticity: 1.5, baseDemand: 12000, unitCost: 55 },
      luxury: { label: 'Luxury', refPrice: 900, elasticity: 0.5, baseDemand: 2500, unitCost: 220 },
    },
    categories: {
      abbigliamento: { label: 'Abbigliamento', margin: 'medio', obsolescence: 'alto' },
      calzature: { label: 'Calzature', margin: 'medio', obsolescence: 'medio' },
      pelletteria: { label: 'Pelletteria e borse', margin: 'alto', obsolescence: 'basso' },
      accessori: { label: 'Accessori', margin: 'alto', obsolescence: 'medio' },
      gioielli: { label: 'Gioielli', margin: 'molto_alto', obsolescence: 'nessuno' },
    },
    channels: {
      ecommerce: { label: 'E-commerce diretto', desc: 'Costo fisso basso e incassate tutto il prezzo. Raggiunge bene il premium, meno il lusso.', reach: { premium: 1.0, luxury: 0.8 }, priceShare: 1.0, fixedCost: 5000 },
      boutique: { label: 'Boutique monomarca', desc: 'Costo fisso alto, ma è il canale migliore per il lusso: i clienti luxury comprano in negozio.', reach: { premium: 0.9, luxury: 1.25 }, priceShare: 1.0, fixedCost: 30000 },
      wholesale: { label: 'Wholesale / multibrand', desc: 'Raggiungete molti più clienti tramite negozi multimarca, ma incassate solo il 60% del prezzo.', reach: { premium: 1.35, luxury: 1.1 }, priceShare: 0.6, fixedCost: 0 },
    },
    events: [
      { title: 'Dazi USA sui beni europei', description: 'Gli Stati Uniti introducono un dazio del 15% sui beni di moda importati.', effects: { tariffByMarket: { US: 0.15 }, demandByMarket: { US: 0.95 } } },
      { title: 'Rallentamento dei consumi in Cina', description: 'La crescita cinese rallenta e la domanda di lusso in Asia cala.', effects: { demandByMarket: { ASIA: 0.8 }, demandBySegment: { luxury: 0.9 } } },
      { title: 'Crisi logistica nel Mar Rosso', description: 'Le rotte marittime si allungano: noli e tempi di consegna aumentano.', effects: { costMultiplier: 1.12 } },
      { title: 'Passaporto digitale UE dei prodotti', description: 'Nuove regole UE su tracciabilità e sostenibilità: i consumatori premiano i brand trasparenti.', effects: { lowSustainabilityBrandShock: 6, sustainabilityPreferenceDelta: 0.3 } },
      { title: 'Boom del turismo in Europa', description: 'Flussi turistici record nelle capitali europee della moda.', effects: { demandByMarket: { EU: 1.15 }, demandBySegment: { luxury: 1.05 } } },
      { title: 'Rincaro delle materie prime', description: 'Cotone, pelle e metalli preziosi aumentano di prezzo.', effects: { costMultiplier: 1.08 } },
      { title: 'Scandalo sulla filiera produttiva', description: 'Un\'inchiesta giornalistica accende i riflettori sulle condizioni di lavoro nella filiera della moda.', effects: { lowSustainabilityBrandShock: 10, sustainabilityPreferenceDelta: 0.2 } },
      { title: 'Accordo commerciale UE-Asia', description: 'Riduzione dei dazi e semplificazione doganale verso i mercati asiatici.', effects: { tariffByMarket: { ASIA: -0.05 }, demandByMarket: { ASIA: 1.08 } } },
      { title: 'Dollaro forte', description: 'Il cambio favorevole spinge gli acquisti dei turisti americani.', effects: { demandByMarket: { US: 1.1, EU: 1.05 } } },
    ],
  },

  beauty: {
    label: 'Beauty & cosmesi', icon: '✦', productWord: 'confezioni',
    rules: ['Il marketing e gli influencer pesano più che altrove', 'I prodotti durano: poco invenduto perso (tranne il make-up di tendenza)', 'Canali: online, profumerie, farmacie'],
    weights: { brand: 1.15, quality: 0.55 }, decay: { brand: 0.07, quality: 0.08, sustainability: 0.05 },
    segments: {
      masstige: { label: 'Masstige', refPrice: 35, elasticity: 1.3, baseDemand: 40000, unitCost: 9 },
      prestige: { label: 'Prestige', refPrice: 110, elasticity: 0.7, baseDemand: 9000, unitCost: 24 },
    },
    categories: {
      skincare: { label: 'Skincare', margin: 'alto', obsolescence: 'basso' },
      makeup: { label: 'Make-up', margin: 'alto', obsolescence: 'medio' },
      profumi: { label: 'Profumi', margin: 'molto_alto', obsolescence: 'basso' },
      haircare: { label: 'Haircare', margin: 'medio', obsolescence: 'basso' },
    },
    channels: {
      online: { label: 'Online e social commerce', desc: 'Costo fisso basso, incassate tutto il prezzo. Funziona bene con il masstige e con chi ha un brand forte sui social.', reach: { masstige: 1.1, prestige: 0.9 }, priceShare: 1.0, fixedCost: 5000 },
      profumerie: { label: 'Profumerie e department store', desc: 'Il canale del prestige: grande visibilità, ma il rivenditore trattiene il 30% del prezzo.', reach: { masstige: 0.9, prestige: 1.3 }, priceShare: 0.7, fixedCost: 10000 },
      farmacie: { label: 'Farmacie e parafarmacie', desc: 'Molti clienti e grande fiducia, soprattutto per la skincare. Il rivenditore trattiene il 30% del prezzo.', reach: { masstige: 1.25, prestige: 0.95 }, priceShare: 0.7, fixedCost: 0 },
    },
    events: [
      { title: 'Trend virale sui social', description: 'Un trend sui social fa esplodere la domanda di prodotti accessibili.', effects: { demandBySegment: { masstige: 1.2 } } },
      { title: 'Nuovo regolamento UE sugli ingredienti', description: 'Alcuni ingredienti vengono vietati: riformulare costa e i consumatori premiano i brand trasparenti.', effects: { costMultiplier: 1.08, lowSustainabilityBrandShock: 5 } },
      { title: 'Ripresa del travel retail in Asia', description: 'Aeroporti e duty free asiatici tornano pieni di viaggiatori.', effects: { demandByMarket: { ASIA: 1.15 }, demandBySegment: { prestige: 1.1 } } },
      { title: 'Calo del potere d\'acquisto', description: 'L\'inflazione pesa sui bilanci familiari: si rinuncia ai prodotti più cari.', effects: { demandBySegment: { prestige: 0.85, masstige: 1.05 } } },
      { title: 'Rincaro del packaging', description: 'Vetro, plastica e cartone costano di più.', effects: { costMultiplier: 1.06 } },
      { title: 'Inchiesta sui test sugli animali', description: 'Un\'inchiesta giornalistica mette sotto accusa il settore: i clienti cercano brand etici.', effects: { lowSustainabilityBrandShock: 8, sustainabilityPreferenceDelta: 0.3 } },
      { title: 'Dazi USA sulle importazioni', description: 'Gli Stati Uniti introducono un dazio del 15% sui cosmetici importati.', effects: { tariffByMarket: { US: 0.15 }, demandByMarket: { US: 0.95 } } },
      { title: 'Dollaro forte', description: 'Il cambio favorevole spinge gli acquisti dei consumatori americani.', effects: { demandByMarket: { US: 1.1, EU: 1.05 } } },
    ],
  },

  food: {
    label: 'Food & beverage', icon: '●', productWord: 'confezioni',
    rules: ['I prodotti scadono: i freschi invenduti si perdono', 'Margini bassi e grandi volumi', 'Canali: supermercati, negozi specializzati, ristorazione'],
    weights: { brand: 0.85, quality: 0.75 }, decay: { brand: 0.05, quality: 0.06, sustainability: 0.05 },
    segments: {
      mass: { label: 'Mass market', refPrice: 3.5, elasticity: 1.8, baseDemand: 700000, unitCost: 1.0 },
      gourmet: { label: 'Gourmet', refPrice: 12, elasticity: 0.9, baseDemand: 120000, unitCost: 3.6 },
    },
    categories: {
      snack: { label: 'Snack', margin: 'medio', obsolescence: 'medio' },
      bevande: { label: 'Bevande', margin: 'medio', obsolescence: 'basso' },
      freschi: { label: 'Prodotti freschi', margin: 'basso', obsolescence: 'totale' },
      dolciario: { label: 'Dolciario', margin: 'alto', obsolescence: 'medio' },
    },
    channels: {
      gdo: { label: 'Supermercati (GDO)', desc: 'Volumi enormi, ma la catena trattiene il 35% del prezzo. Ideale per il mass market.', reach: { mass: 1.4, gourmet: 0.9 }, priceShare: 0.65, fixedCost: 0 },
      specializzati: { label: 'Negozi specializzati e gastronomie', desc: 'Clienti attenti alla qualità: il canale del gourmet. Costo fisso medio, il negozio trattiene il 15%.', reach: { mass: 0.7, gourmet: 1.3 }, priceShare: 0.85, fixedCost: 15000 },
      horeca: { label: 'Ristorazione e online', desc: 'Bar, ristoranti e vendita online: fanno conoscere il brand. Il partner trattiene il 10%.', reach: { mass: 0.85, gourmet: 1.1 }, priceShare: 0.9, fixedCost: 8000 },
    },
    events: [
      { title: 'Siccità in Europa', description: 'Raccolti scarsi: le materie prime agricole costano molto di più.', effects: { costMultiplier: 1.12 } },
      { title: 'Rincaro di grano ed energia', description: 'Produrre e trasportare costa di più per tutti.', effects: { costMultiplier: 1.08 } },
      { title: 'Etichetta nutrizionale obbligatoria', description: 'Arriva un\'etichetta a colori sui valori nutrizionali: i clienti premiano i prodotti sani e trasparenti.', effects: { lowSustainabilityBrandShock: 5, sustainabilityPreferenceDelta: 0.25 } },
      { title: 'Boom del cibo salutistico', description: 'I consumatori cercano prodotti di qualità, biologici e locali.', effects: { demandBySegment: { gourmet: 1.15, mass: 0.95 } } },
      { title: 'Inflazione sul carrello della spesa', description: 'Le famiglie tagliano gli acquisti non essenziali e scelgono i prezzi bassi.', effects: { demandBySegment: { gourmet: 0.85, mass: 1.05 } } },
      { title: 'Dazi USA sull\'agroalimentare europeo', description: 'Gli Stati Uniti introducono un dazio del 15% sui prodotti alimentari europei.', effects: { tariffByMarket: { US: 0.15 }, demandByMarket: { US: 0.95 } } },
      { title: 'Successo del made in Italy in Asia', description: 'Il cibo italiano diventa di moda nelle grandi città asiatiche.', effects: { demandByMarket: { ASIA: 1.15 } } },
      { title: 'Crisi logistica nel Mar Rosso', description: 'Le rotte marittime si allungano: noli e tempi di consegna aumentano.', effects: { costMultiplier: 1.1 } },
    ],
  },

  tech: {
    label: 'Tech', icon: '▲', productWord: 'dispositivi',
    rules: ['Ricerca e sviluppo decisivi: la qualità conta più che altrove', 'I prodotti invecchiano in fretta', 'Canali: online, catene di elettronica, rivenditori B2B'],
    weights: { brand: 0.85, quality: 0.95 }, decay: { brand: 0.05, quality: 0.14, sustainability: 0.05 },
    segments: {
      consumer: { label: 'Consumer', refPrice: 250, elasticity: 1.6, baseDemand: 12000, unitCost: 120 },
      professional: { label: 'Professional', refPrice: 1200, elasticity: 0.7, baseDemand: 1500, unitCost: 520 },
    },
    categories: {
      smartphone: { label: 'Smartphone e tablet', margin: 'medio', obsolescence: 'alto' },
      wearable: { label: 'Wearable', margin: 'alto', obsolescence: 'alto' },
      smarthome: { label: 'Smart home', margin: 'medio', obsolescence: 'medio' },
      software: { label: 'Software e app', margin: 'molto_alto', obsolescence: 'basso' },
    },
    channels: {
      online: { label: 'E-commerce diretto', desc: 'Costo fisso basso e incassate tutto il prezzo.', reach: { consumer: 1.0, professional: 0.85 }, priceShare: 1.0, fixedCost: 5000 },
      retail: { label: 'Catene di elettronica', desc: 'Grande visibilità verso il pubblico, ma la catena trattiene il 30% del prezzo.', reach: { consumer: 1.3, professional: 0.9 }, priceShare: 0.7, fixedCost: 0 },
      b2b: { label: 'Rivenditori e vendita B2B', desc: 'Il canale per le aziende: costo fisso alto per la rete commerciale, il partner trattiene il 20%.', reach: { consumer: 0.7, professional: 1.35 }, priceShare: 0.8, fixedCost: 20000 },
    },
    events: [
      { title: 'Crisi dei semiconduttori', description: 'I chip scarseggiano: produrre costa molto di più.', effects: { costMultiplier: 1.15 } },
      { title: 'Nuova normativa UE sulla privacy', description: 'Regole più severe sui dati: adeguarsi costa e i clienti europei diventano più prudenti.', effects: { demandByMarket: { EU: 0.95 }, costMultiplier: 1.04 } },
      { title: 'Guerra commerciale USA-Cina', description: 'Nuovi dazi sull\'elettronica: colpiti soprattutto USA e Asia.', effects: { tariffByMarket: { US: 0.2, ASIA: 0.1 } } },
      { title: 'Arriva un concorrente globale', description: 'Un colosso lancia un prodotto aggressivo nella fascia consumer.', effects: { demandBySegment: { consumer: 0.85 } } },
      { title: 'Incentivi alla digitalizzazione delle imprese', description: 'Contributi pubblici per le aziende che investono in tecnologia.', effects: { demandBySegment: { professional: 1.2 }, demandByMarket: { EU: 1.05 } } },
      { title: 'Boom dell\'intelligenza artificiale', description: 'Aziende e consumatori cercano dispositivi pronti per l\'AI.', effects: { demandBySegment: { professional: 1.15, consumer: 1.05 } } },
      { title: 'Direttiva UE sul diritto alla riparazione', description: 'I prodotti devono essere riparabili e durare di più: premiati i brand sostenibili.', effects: { lowSustainabilityBrandShock: 6, sustainabilityPreferenceDelta: 0.3 } },
      { title: 'Dollaro forte', description: 'Il cambio favorevole spinge gli acquisti dei consumatori americani.', effects: { demandByMarket: { US: 1.1, EU: 1.05 } } },
    ],
  },
};

module.exports = { BUILTIN, GENERAL_EVENTS, MARGIN, MARGIN_LABEL, OBSOLESCENCE, OBSOLESCENCE_LABEL, SENSITIVITY, CHANNEL_TYPES, channelFromType };
