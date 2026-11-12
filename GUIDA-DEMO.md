# Pubblicare la demo gratuita (15 minuti)

Alla fine avrai un indirizzo web, tipo `https://business-game-demo-xxxx.onrender.com`, da mandare al docente per provare il gioco.
**Costo: zero.** Non serve il Terminale e non serve installare niente sul Mac.

> **Limite della demo**: con il piano gratuito il sito si spegne dopo circa 15 minuti senza visite. Alla riaccensione, che richiede circa un minuto, **le partite vengono azzerate**.
> Va benissimo per provare il gioco e mostrarlo, anche in una lezione intera: mentre gli studenti sono collegati il sito resta acceso.
> Non va bene per le 3 sessioni vere in giorni diversi. Per quelle servirà la versione con database (vedi `GUIDA-PUBBLICAZIONE.md`).
> Sulle pagine compare la scritta "Versione demo", così nessuno si aspetta che i dati restino salvati.

---

## 1. Carica il progetto su GitHub

1. Vai su https://github.com e crea un account gratuito, se non ce l'hai.
2. In alto a destra premi **+ → New repository**.
   - Nome: `business-game`
   - Visibilità: **Private**
   - Premi **Create repository**.
3. Nella pagina che si apre premi il link **uploading an existing file**.
4. Estrai `business-game.zip` e apri la cartella `business-game`. Seleziona **tutto il contenuto** della cartella (non la cartella stessa) e trascinalo nella pagina di GitHub.
   - Controlla che nell'elenco ci siano **`render.yaml`**, `package.json`, `package-lock.json` e le cartelle `server`, `public` e `scripts`.
5. In fondo premi **Commit changes** e aspetta che il caricamento finisca.

## 2. Pubblica su Render

1. Vai su https://render.com e premi **Get Started**. Registrati con **GitHub**, così Render vede il tuo repository.
2. Nella dashboard premi **New → Blueprint**.
3. Scegli il repository `business-game`. Se non compare, premi *Configure account* e dai a Render l'accesso a quel repository.
4. Render legge il file `render.yaml` e propone il servizio **business-game-demo** (piano Free, regione Francoforte). Ti chiede due valori:
   - **TEACHER_EMAIL**: l'email con cui il docente entrerà (es. `docente@scuola.it`);
   - **TEACHER_PASSWORD**: una password di **almeno 10 caratteri**, scelta da te.
5. Premi **Apply** (o *Deploy Blueprint*).
6. Aspetta che lo stato diventi **Live**, di solito 3–5 minuti. In alto, sotto il nome del servizio, trovi l'indirizzo del sito.

La password resta solo nelle impostazioni segrete di Render: non è nel codice e non è su GitHub.

## 3. Prova che funzioni

1. Apri `https://…onrender.com/docente` ed entra con email e password del passo 2.
2. Crea una sessione di prova: compare il codice.
3. Dal telefono, o da una finestra in incognito, apri `https://…onrender.com` e inserisci il codice.
4. Nella dashboard premi **Avvia sessione 1**, poi apri un round: sul telefono compaiono le decisioni da prendere.

## 4. Cosa mandare al docente

- **Area docente:** `https://…onrender.com/docente`
- **Email e password** scelte al passo 2, in privato
- **Il file "Come funziona il Business Game"** (PDF), con la spiegazione del sito e del gioco
- Due avvisi:
  - è una **demo**: se il sito resta inutilizzato per un po', i dati si azzerano;
  - l'accesso è con **email e password**, non con l'account ChatGPT.

Consiglio per il docente: aprire il link 2–3 minuti prima di usarlo. Se il sito "dormiva", la prima apertura impiega circa un minuto.

---

## Cambiare email o password del docente

Su Render apri il servizio → **Environment** → modifica `TEACHER_EMAIL` o `TEACHER_PASSWORD` → **Save changes**. Il sito si riavvia da solo.

## Se qualcosa non va

- **Il login dice "Credenziali non valide"**: controlla la password su Render, in Environment. Deve avere almeno 10 caratteri, altrimenti il docente non viene creato.
- **Il sito ci mette tanto ad aprirsi**: è normale dopo una pausa, è il piano gratuito che si risveglia. Aspetta circa un minuto.
- **Il deploy fallisce**: verifica di aver caricato su GitHub anche `package-lock.json` e `render.yaml`, nella cartella principale del repository e non dentro una sottocartella.
