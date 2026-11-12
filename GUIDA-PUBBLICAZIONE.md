# Guida alla pubblicazione online

> **Questa è la guida per la versione definitiva, con salvataggio permanente su disco (a pagamento).**
> Per una prova gratuita segui `GUIDA-DEMO.md`. Per usare questa guida, prima rinomina `render.paid.yaml` in `render.yaml`, sostituendo quello della demo.

Obiettivo: avere un indirizzo web (es. `https://business-game-xxxx.onrender.com`) da mandare al docente.
Il docente non deve installare niente.

Tempo necessario: circa 20–30 minuti la prima volta.
Servono: un account **GitHub** (gratuito), un account **Render** e Node.js sul tuo Mac (solo per il passo 2).

> Costi: per salvare le partite tra una sessione e l'altra serve un **disco persistente**, che su Render richiede un piano a pagamento (piano "Starter" più il disco da 1 GB). Prima di confermare controlla il prezzo aggiornato nella pagina di riepilogo di Render e decidi chi lo paga.

---

## 1. Carica il progetto su GitHub

1. Vai su https://github.com e crea un account, se non ce l'hai.
2. In alto a destra premi **+ → New repository**.
   - Nome: `business-game`
   - Visibilità: **Private**
   - Premi **Create repository**.
3. Nella pagina del repository vuoto premi **uploading an existing file**.
4. Estrai `business-game.zip` e apri la cartella `business-game`.
   - Su Mac premi **Cmd + Shift + .** per vedere anche i file nascosti (`.gitignore`, `.nvmrc`, `.dockerignore`).
   - Seleziona **tutto il contenuto** della cartella (non la cartella stessa) e trascinalo nella pagina di GitHub.
   - Controlla che ci siano `render.yaml`, `package.json` e le cartelle `server`, `public` e `scripts`.
   - **Non** caricare `node_modules`, `data` o `config/teachers.json`, se li hai creati provando il sito in locale.
5. In fondo premi **Commit changes**.

## 2. Crea l'account del docente

Apri il **Terminale**, scrivi `cd ` (con lo spazio), trascina la cartella `business-game` nella finestra e premi Invio. Poi scrivi (con l'email vera del docente):

```
node scripts/teacher-json.js docente@scuola.it "Prof. Nome Cognome"
```

Il comando stampa due cose:

1. **la password del docente**: copiala in un posto sicuro. La manderai al docente in privato e non viene salvata da nessuna parte;
2. **una riga che inizia con `[{"email"`**: è il valore da incollare su Render al passo 3. Copiala tutta, dalla `[` iniziale alla `]` finale.

Nel server la password non c'è mai in chiaro: c'è solo la sua impronta cifrata.

## 3. Pubblica su Render

1. Vai su https://render.com e registrati con **"Sign in with GitHub"**, così Render vede i tuoi repository.
2. Nella dashboard premi **New → Blueprint**.
3. Scegli il repository `business-game`. Se non compare, premi *Configure account* e dai a Render l'accesso a quel repository.
4. Render legge il file `render.yaml` e propone:
   - un servizio web `business-game` (regione Francoforte);
   - un disco `dati-partite` da 1 GB.
5. Alla voce **TEACHERS_JSON** incolla la riga copiata al passo 2.
6. Controlla il riepilogo dei costi e premi **Apply** (o *Deploy Blueprint*).
7. Aspetta che lo stato diventi **Live**: ci vogliono alcuni minuti. In alto trovi l'indirizzo del sito, tipo `https://business-game-xxxx.onrender.com`.

## 4. Controlla che funzioni

| Prova | Cosa deve succedere |
|---|---|
| Apri `https://…onrender.com/healthz` | compare la scritta `ok` |
| Apri `https://…onrender.com/docente` ed entra con email e password del passo 2 | si apre la dashboard docente |
| Crea una sessione di prova | compare il codice, per esempio `ABCD-EFGH` |
| In una finestra in incognito apri `https://…onrender.com` e inserisci il codice | entri come gruppo di prova |
| Nella finestra in incognito apri `/docente` | vedi solo la pagina di login, non la dashboard |

Alla fine elimina il gruppo di prova dalla scheda *Gruppi*, oppure crea una sessione nuova per la lezione vera.

## 5. Cosa mandare al docente

- **Area docente:** `https://…onrender.com/docente`
- **Email e password:** quelle del passo 2. Mandale in privato, e meglio se separate dal link.
- **Indirizzo per gli studenti:** `https://…onrender.com`. Lo vede comunque anche nella dashboard e nella modalità *Proietta in aula*.
- Un avviso: l'accesso è con **email e password**, non con l'account ChatGPT.

---

## Operazioni successive

**Aggiungere o cambiare un docente**: rilancia il comando del passo 2. Su Render apri il servizio → **Environment** → modifica `TEACHERS_JSON` → **Save changes**. Il servizio si riavvia da solo e le partite non si perdono, perché sono sul disco.
Per avere **più docenti**, metti gli oggetti nella stessa lista:
`[{"email":"a@scuola.it",...},{"email":"b@scuola.it",...}]`

**Revocare un docente**: toglilo da `TEACHERS_JSON` e salva. Il suo accesso viene chiuso subito.

**Aggiornare il codice**: carica su GitHub i file modificati (*Add file → Upload files*). Render ripubblica in automatico.

**Backup**: dalla scheda *Debriefing* il docente può scaricare il CSV completo dei risultati. Per il database intero, controlla le opzioni di snapshot del disco nelle impostazioni del servizio su Render.

**Indirizzo personalizzato** (es. `businessgame.nomescuola.it`): su Render → *Settings → Custom Domains*. Richiede l'accesso al dominio della scuola.

## Hosting alternativi

Il progetto contiene anche un `Dockerfile`, quindi funziona su qualunque servizio che supporti Docker, come Railway, Fly.io o un server della scuola.
Le regole sono le stesse:
- montare un volume persistente su `/data`;
- impostare `TEACHERS_JSON`, `NODE_ENV=production` e `TRUST_PROXY=1`;
- servire il sito in **HTTPS**, perché i cookie di accesso funzionano solo su connessione sicura.

## Se qualcosa non va

- **Il deploy fallisce con "TEACHERS_JSON … non è un JSON valido"**: la riga incollata è incompleta. Rigenerala e incollala di nuovo, dalla `[` alla `]`.
- **Il login dice "Credenziali non valide"**: controlla l'email (le maiuscole non contano) e la password. Se serve, rigenera l'account (passo 2) e aggiorna `TEACHERS_JSON`.
- **Le partite spariscono dopo un riavvio**: il disco non è collegato. Controlla che il servizio abbia il disco montato su `/var/data`.
