# Fashion & Luxury Business Game – v1

Web app per condurre in aula un business game in più sessioni (default: 3 sessioni da 90 minuti).
I gruppi di studenti creano una startup fashion o luxury e competono round dopo round, mentre il docente attiva eventi geopolitici e controlla l'intera partita.

- **Area studenti**: `https://tuo-sito/` – si entra solo con il codice della sessione, senza account.
- **Area docente**: `https://tuo-sito/docente`, oppure l'indirizzo scelto con la variabile `TEACHER_PATH` – riservata ai docenti presenti nella allowlist del server.

Stack: Node.js (≥ 20) + Express + SQLite (file unico, nessun servizio esterno). Frontend in HTML/JS semplice.

---

## 1. Avvio in locale

```bash
npm install
npm run add-teacher -- docente@scuola.it "Prof. Nome Cognome" "una-password-lunga"
npm start
```

Apri http://localhost:3000/docente per l'area docente e http://localhost:3000 per l'area studenti.
`npm test` esegue i test automatici su permessi, isolamento tra sessioni e una partita completa.

## 2. Docenti autorizzati

L'accesso docente **non** è aperto a chiunque abbia un account: il server accetta solo le identità presenti nella allowlist.

- File `config/teachers.json` (creato da `npm run add-teacher`), oppure variabile d'ambiente `TEACHERS_JSON` con lo stesso contenuto.
- Le password sono salvate solo come hash (scrypt).
- Per revocare un docente basta toglierlo dalla lista: entro un minuto le sue sessioni di login vengono invalidate.
- Ogni docente vede e gestisce solo le partite che ha creato.

> **Nota su "Accedi con ChatGPT"**: il brief chiedeva il login con l'account ChatGPT del docente. Oggi non esiste un provider di login "ChatGPT" generico, utilizzabile da un sito qualsiasi, su cui potersi appoggiare. La v1 usa quindi email + password verificate su una allowlist lato server, che soddisfa lo stesso requisito: deve essere un'identità docente autorizzata e configurata sul server, non un account qualunque.
> Se in futuro volete un login esterno (Google Workspace della scuola, Microsoft 365, o OpenAI se rendesse disponibile un login OIDC), il punto da estendere è `server/auth.js`. Basta che, dopo il login esterno, l'email verificata venga controllata contro la stessa allowlist prima di chiamare `createTeacherSession`.

## 3. Pubblicazione online

**Guida passo passo per Render: vedi `GUIDA-PUBBLICAZIONE.md`.** Il file `render.yaml` è già pronto; per altri hosting c'è il `Dockerfile`.


Serve un hosting Node con **disco persistente**, perché il database è un file. Funzionano per esempio Render (con Disk), Railway (con Volume), Fly.io (con Volume) o una VPS.

Variabili d'ambiente:

| Variabile | Valore |
|---|---|
| `NODE_ENV` | `production` (attiva i cookie `Secure`, quindi richiede HTTPS) |
| `DB_PATH` | percorso sul disco persistente, es. `/data/business-game.sqlite` |
| `TEACHERS_JSON` | contenuto di `config/teachers.json` |
| `TEACHER_PATH` | indirizzo dell'area docente al posto di `/docente`, es. `gestione-bg-7k2q` (4–64 caratteri: lettere, numeri, `-`, `_`) |
| `TRUST_PROXY` | `1` se l'hosting è dietro un proxy, come quasi sempre (serve al rate limit per IP) |
| `PORT` | di solito impostata dall'hosting |

Comando di build: `npm install`. Comando di avvio: `npm start`.
Backup: basta copiare il file SQLite.

## 4. Come si usa in aula

1. **Prima della lezione**: in `/docente` crei una nuova sessione (nome, sessioni d'aula, durata, numero di round). Il codice viene generato in automatico. Se vuoi, aggiusti i parametri del modello e gli eventi.
2. **Sessione 1**: premi *Avvia sessione 1*, poi *Proietta in aula*: schermo intero con codice, indirizzo del sito e timer in grande (Esc per uscire). I gruppi entrano, ricevono un **PIN di rientro** e configurano la startup (nome, segmento premium/luxury, categoria, mercato EU/US/Asia, posizionamento, valori).
3. **Round**: scegli gli eventi geopolitici e premi *Apri round*. I gruppi inviano le decisioni e possono modificarle finché il round è aperto. Con *Chiudi round e calcola* ottieni KPI e classifica. Chi non ha inviato ripete l'ultima decisione.
4. **Pausa / chiusura**: *Metti in pausa* ferma timer e decisioni. *Chiudi sessione* salva tutto e la partita riprende alla sessione successiva. *Riapri sessione* serve se l'hai chiusa per errore.
5. **Sessioni 2 e 3**: *Avvia sessione 2*. I gruppi rientrano col codice. Se cambiano computer, con codice + nome gruppo + PIN. Il PIN si può rigenerare dalla scheda Gruppi.
6. **Fine**: *Avvia debriefing* mostra la classifica finale anche agli studenti. Nella scheda *Debriefing e risultati* trovi aggregati per round, andamento dei punteggi, decisioni con motivazioni ed export CSV. *Termina partita* fa scadere il codice.

Suggerimento: con 6 round, 2 per sessione, ogni round dura circa 30–40 minuti tra analisi, decisione e commento.

## 5. Modello di gioco

Decisioni per round: prezzo, quantità prodotta, investimenti in marketing, design/R&D e sostenibilità, canale (e-commerce, boutique, wholesale), più una motivazione scritta.

- **Asset**: brand, qualità e sostenibilità (0–100) crescono con gli investimenti, con rendimenti decrescenti, e si erodono se non si investe.
- **Domanda**: ogni combinazione segmento × mercato ha una domanda base, ripartita tra le startup presenti in base all'attrattività (prezzo rispetto al riferimento ed elasticità del segmento, brand, qualità, sostenibilità, copertura del canale). Esiste anche l'opzione "non acquisto". Nel lusso un prezzo troppo basso diluisce il posizionamento.
- **Conto economico**: ricavi, costo di produzione (influenzato da qualità, sostenibilità, eventi e dazi), investimenti, costi fissi, costi del canale e magazzino. L'invenduto passa al round dopo.
- **Punteggio**: media pesata di utile cumulato, brand, quota di mercato, sostenibilità e cassa, normalizzati tra i gruppi.

**Personalizzazione** (scheda *Impostazioni*): cassa iniziale, costi fissi, difficoltà del mercato, sensibilità green, costi di magazzino, prezzo di riferimento / elasticità / domanda / costo unitario per segmento, peso dei mercati e pesi del punteggio.
**Eventi** (scheda *Eventi*): 9 eventi pronti (dazi USA, rallentamento Cina, crisi Mar Rosso, passaporto digitale UE, ecc.). Puoi modificarli o crearne di nuovi combinando: moltiplicatori di domanda per mercato e segmento, moltiplicatore dei costi, dazi per mercato, penalità di brand per chi è poco sostenibile, aumento della sensibilità green.

## 5a. Settori, moduli e timer del round

- **Settori.** Alla creazione della sessione la docente sceglie il settore, uguale per tutti i gruppi. Ci sono quattro settori pronti:
  - **Moda & lusso**: Fashion premium / Luxury;
  - **Beauty & cosmesi**: Masstige / Prestige;
  - **Food & beverage**: Mass market / Gourmet;
  - **Tech**: Consumer / Professional.

  Ogni settore ha segmenti, categorie, canali, eventi e regole propri (peso di brand e qualità, velocità con cui la qualità invecchia). Le **categorie** contano davvero nel calcolo: il margine cambia il costo di produzione, il rischio invenduto decide quanta merce si perde a ogni round (es. i freschi scadono del tutto).
- **Settori personalizzati.** La docente può creare un settore suo: nome, cosa vendono le startup, da 1 a 5 segmenti, categorie con margine e rischio invenduto, canali (vendita diretta, negozi propri, rivenditori). Si può partire da zero o copiare un settore pronto. Il settore resta salvato tra i suoi (`/api/teacher/sectors`) e le sessioni ne conservano una copia.
- **Timer del round.** All'apertura di un round si sceglie la durata: 10, 15, 20, 30 minuti o senza limite. Il conto alla rovescia si vede nella dashboard, sul telefono degli studenti e in proiezione; si può aggiungere o togliere tempo. Allo scadere il round non si chiude da solo. Il timer segue l'orologio della lezione, quindi si ferma con la pausa.
- **Moduli di gioco**, spenti di default. Si accendono e si spengono in qualsiasi momento, dalle Impostazioni o all'apertura di un round, e valgono dal round che si apre:
  - **Report di mercato**: grandezza del mercato, prezzo medio e quote dei concorrenti dopo ogni round;
  - **Fido bancario**: la cassa negativa paga l'8% di interessi a round;
  - **Dove produrre**: Italia, Europa o Asia, cioè costo contro qualità, sostenibilità e rischio logistico;
  - **Premi speciali** nel debriefing.

  Lo storico dei moduli usati è visibile nelle Impostazioni.

## 5b. Studio dei gruppi e giudizio del docente

- **Ogni round ha due passi.** Nel primo il gruppo prende le decisioni: ogni campo spiega cosa fa e mostra l'effetto previsto. Nel secondo compila lo **studio**: mercato ed eventi, concorrenti, strategia e alternative, rischi, previsione di pezzi e utile. Può anche allegare dei file (PDF, PNG/JPG, PowerPoint, Word, Excel; max 5 da 10 MB per round). Il server controlla il tipo reale del file.
- **Punteggio spiegato.** Dopo ogni round il gruppo vede le cinque voci del punteggio, il punto forte, quello debole e la previsione confrontata con il risultato.
- **Scheda del gruppo** (area docente → Gruppi → Apri scheda). Mostra tutto il percorso e il pannello del **giudizio finale**: voto 0–10, criteri promemoria e commento.
- **Classifica finale** = punteggio di gioco × (1 − peso) + voto × 10 × peso. Il peso lo decide il docente; il valore iniziale è 40%. Gli studenti vedono voto, commento e classifica finale solo nel debriefing. La classifica finale compare agli studenti quando tutti i gruppi sono stati valutati.
- Gli allegati sono scaricabili solo dal gruppo che li ha caricati e dal docente della partita.

## 6. Sicurezza e permessi

| Ruolo | Come viene riconosciuto | Cosa può fare |
|---|---|---|
| Docente autorizzato | cookie di sessione httpOnly + utente attivo nella allowlist, verificato a **ogni** richiesta | gestione completa delle **proprie** partite |
| Gruppo studenti | cookie httpOnly con token casuale legato a un solo gruppo, quindi a una sola partita | leggere la propria partita, configurare la propria startup, inviare le proprie decisioni |
| Non autorizzato | nessun cookie valido | inserire un codice; nessun accesso all'area docente (le API rispondono 401) |

- La dashboard docente (HTML e JavaScript) viene servita solo dopo il controllo del login: uno studente non può nemmeno scaricare l'interfaccia di amministrazione. Le pagine docente sono marcate `noindex`.
- Il ruolo non viene mai letto da dati del browser. Le API studenti non accettano id di partita o di gruppo: li ricavano dal token.
- Codici: 8 caratteri casuali da un alfabeto di 31 simboli (circa 850 miliardi di combinazioni), validati lato server, con rate limit sui tentativi. Stati: **attivo**, **sospeso** (studenti bloccati), **scaduto** (niente nuovi gruppi né decisioni, sola consultazione). *Nuovo codice* invalida il precedente.
- Gli studenti vedono solo i propri KPI e le proprie decisioni. Sono pubblici: identità delle startup concorrenti, eventi annunciati e classifica (solo posizione e punteggio, e solo se il docente la rende visibile).
- Protezioni in più: cookie `SameSite=Strict`, controllo dell'header/Origin sulle richieste che modificano dati, Content-Security-Policy senza script inline, input validati con limiti, rate limit su login e codici.

## 7. Struttura del progetto e dei dati

```
server/
  index.js          avvio, header di sicurezza, routing
  db.js             schema SQLite
  auth.js           allowlist docenti, sessioni, token gruppi, middleware permessi
  game.js           macchina a stati, timer, round, validazione
  simulation.js     motore di calcolo (funzione pura)
  defaults.js       parametri ed eventi di default
  routes/teacher.js API area docente
  routes/student.js API area studenti
  views/            pagine docente (servite solo dopo il controllo)
public/             area studenti + JS/CSS
scripts/add-teacher.js
test/app.test.js
```

Tabelle, una per area: `users` e `auth_sessions` (utenti e autorizzazioni) · `games` e `class_sessions` (sessioni del game e d'aula) · `access_codes` · `groups`, `group_members`, `group_tokens` · `startups` · `rounds` · `decisions` · `events` e `round_events` (eventi geopolitici: catalogo e attivazioni, con copia dell'evento al momento dell'uso) · `kpis` (KPI e punteggi) · `game_state` (stato della partita) · `audit_log`.

## 8. Limiti noti della v1

- Login docente con email/password (vedi la nota al punto 2).
- Aggiornamento delle pagine ogni 5 secondi (polling), adeguato per una classe. Non ci sono websocket.
- Rate limit in memoria: con più istanze del server servirebbe uno store condiviso. Per un'aula basta una sola istanza.
- Niente grafici: le tabelle di debriefing e il CSV coprono l'analisi. I grafici sono il passo naturale per la v2.
