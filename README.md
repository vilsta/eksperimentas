# Diagramos tipo parinkimo eksperimentų vykdymo sistema

Pilna lokaliai paleidžiama versija su:

- dalyvio portalu (`/`);
- tyrėjo / administratoriaus portalu (`/admin`);
- Node.js backend API;
- SQLite duomenų baze (`data/experiment.db`);
- klausimų, hipotezių ir eksperimentų valdymu;
- kelių teisingų atsakymų palaikymu;
- klausimo paveikslėlio saugojimu;
- dalyvio atsakymų, laiko ir 1–5 vertinimų registravimu;
- sesijos peržiūra su visais klausimais ir pasirinktais atsakymais;
- dalyvio profilio klausimais (lytis, amžiaus grupė, išsilavinimo / darbo sritis, darbo su vizualizacijomis dažnis, duomenų analizės patirtis);
- rezultatų suvestine ir CSV eksportu.

## Reikalavimai

Reikia Node.js 22.5 arba naujesnės versijos. Rekomenduojama naujausia LTS Node.js versija.

Patikrinti:

```bash
node --version
```

Jei Node.js nėra, naudojant Homebrew:

```bash
brew install node
```

## Paleidimas MacBook

Terminale pereikite į šį aplanką. Paprasčiausia: įrašykite `cd ` (su tarpu) ir nutempkite projekto aplanką iš Finder į Terminal.

Tada:

```bash
npm start
```

arba tiesiog:

```bash
node server.js
```

Atidaryti:

- Dalyvio portalas: `http://localhost:8000`
- Tyrėjo portalas: `http://localhost:8000/admin`

Pirmo paleidimo tyrėjo prisijungimas:

- El. paštas: `tyrejas@ktu.lt`
- Slaptažodis: `prototipas`

Prieš realų tyrimą rekomenduojama pakeisti prisijungimą per aplinkos kintamuosius **prieš pirmą DB sukūrimą**:

```bash
ADMIN_EMAIL="mano@pastas.lt" ADMIN_PASSWORD="stiprus-slaptazodis" node server.js
```

## Vieša prieiga per Cloudflare Tunnel

Kai serveris veikia 8000 porte, kitame Terminal lange:

```bash
cloudflared tunnel --url http://localhost:8000
```

Cloudflare pateiks viešą HTTPS adresą. Dalyviams siųskite pagrindinę nuorodą, o tyrėjo portalas bus prieinamas pridėjus `/admin`.

## Duomenų bazė

SQLite failas automatiškai sukuriamas pirmą kartą paleidus serverį:

```text
data/experiment.db
```

Jei norite visiškai naujos tuščios tyrimo DB su pradiniais klausimais ir hipotezėmis, sustabdykite serverį ir ištrinkite `data/experiment.db`. Kitą kartą paleidus sistema bazę sukurs iš naujo.

**Svarbu:** prieš trindami DB pasidarykite kopiją, jei joje jau yra realių dalyvių duomenų.

## Duomenų srautas

1. Tyrėjas `/admin` sukuria / redaguoja klausimus ir aktyvuoja eksperimentą.
2. Dalyvis atidaro `/`, spaudžia „Pradėti“ ir atsako į 5 profilio klausimus.
3. Backend sukuria sesiją su dalyvio profiliu SQLite DB ir grąžina aktyvaus eksperimento klausimus **be teisingų atsakymų**.
4. Po kiekvieno klausimo atsakymas, atlikimo laikas ir 3 Likerto vertinimai siunčiami į backend.
5. Teisingumas nustatomas serveryje ir išsaugomas DB.
6. Eksperimentui pasibaigus sesija pažymima „Užbaigta“.
7. Tyrėjas „Sesijos“ lange mato dalyvio profilį, visus klausimus ir dalyvio atsakymus.

## Saugumas

Tai akademinio tyrimo prototipo backend. Prisijungimas ir slaptažodžio hash saugojimas realizuoti, tačiau prieš viešą ilgalaikį diegimą rekomenduojama papildomai įdiegti HTTPS reverse proxy, atsargines kopijas, pastovų sesijų saugojimą ir griežtesnę prieigos kontrolę.
