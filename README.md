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
- kalbos pasirinkimu (lietuvių / anglų) ir redaguojamais tekstais bei profilio klausimais (skiltis „Nustatymai“);
- rezultatų suvestine ir CSV eksportu.

## Reikalavimai

Reikia Node.js 22.13 arba naujesnės versijos. Rekomenduojama naujausia LTS Node.js versija.

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

Prieš realų tyrimą rekomenduojama pakeisti prisijungimą per aplinkos kintamuosius:

```bash
ADMIN_EMAIL="mano@pastas.lt" ADMIN_PASSWORD="stiprus-slaptazodis" node server.js
```

## Vieša prieiga per Cloudflare Tunnel

Kai serveris veikia 8000 porte, kitame Terminal lange:

```bash
cloudflared tunnel --url http://localhost:8000
```

Cloudflare pateiks viešą HTTPS adresą. Dalyviams siųskite pagrindinę nuorodą, o tyrėjo portalas bus prieinamas pridėjus `/admin`.

## Kalbos ir nustatymai

Dalyvis pirmiausia pasirenka kalbą (lietuvių arba anglų). Visi dalyviui rodomi tekstai – pasisveikinimas, profilio klausimai, užduoties vertinimai, atsisveikinimas, kontaktai ir pranešimai – redaguojami tyrėjo portalo skiltyje **„Nustatymai“** abiem kalbomis (`settings.js`, DB lentelė `settings`).

Profilio klausimus galima pridėti, šalinti, perrikiuoti, keisti jų tipą (išskleidžiamasis sąrašas arba skalė 1–5) ir analizės vaidmenį: patirtis (H6), amžius (H8), lytis (H9), sritis (H10). Atsakymai saugomi sesijos lauke `profile_json`.

Klausimo redagavimo lange galima įrašyti angliškus klausimo tekstą, atsakymo variantus ir (neprivaloma) anglišką diagramos paveikslėlį. Kol vertimo nėra, anglų kalba rodomas lietuviškas tekstas. Teisingumas visada tikrinamas pagal lietuvišką variantą. Dalyvio kalba įrašoma į sesiją ir CSV (`language`).

## Eksperimentai E1–E4 ir A/B grupės

Faile `seed/eksperimentai.json` (2 versija) aprašyti 4 eksperimentai ir 80 klausimų pagal dokumentus „Eksperimentų klausimai ir diagramos“ (LT ir EN): kiekvienam iš 40 klausimų yra A ir B grupės variantas, lietuviška ir angliška diagrama (`public/diagramos/lt/`, `public/diagramos/en/`), sunkumo žyma (Lengvas / Vidutinis / Sunkus). Klausimai pateikiami fiksuota tvarka – nuo lengvesnių iki sunkesnių.

Paleidus serverį, trūkstami klausimai ir eksperimentai automatiškai importuojami į DB (esami neperrašomi). Jei DB jau yra ankstesnės versijos E1–E4, jie sustabdomi ir pervadinami į E1-v1…E4-v1, o jų klausimai pažymimi neaktyviais – senos sesijos ir jų rezultatai lieka atskirai.

Kiekvienas dalyvis priskiriamas vienam aktyviam eksperimentui ir A arba B grupei – ten, kur iki šiol mažiausiai dalyvių. CSV eksporte yra `experiment`, `group_label`, `chart_type_seen` ir `question_level`. Skaitiniai atsakymai laikomi teisingais, jei patenka į klausimo leistiną nuokrypį.

## Rezultatų analizė

Tyrėjo portalo skiltyje „Rezultatai“ kiekvienam eksperimentui atskirai pateikiama statistinė analizė (`analysis.js`, testai – `stats.js`):

1. **Duomenų paruošimas** – šalinamos neužbaigtos sesijos, sesijos, kuriose dauguma atsakymų pateikta greičiau nei per 2 s arba visi vertinimai vienodi, ir bandymai, trumpesni nei 1 s.
2. **Aprašomoji statistika** – dalyvių pasiskirstymas A ir B grupėse pagal lytį, amžių, sritį, patirtį ir įrenginį; teisingų atsakymų dalis, laiko vidurkis ir mediana, vertinimų pasiskirstymas.
3. **Grupavimas** – laikas į tris grupes pagal tertiles (keturias pagal kvartiles, kai dalyvių ≥ 40), vertinimai: 1–2 / 3 / 4–5, patirtis: 1–2 / 3–5.
4. **Hipotezių tikrinimas** – H1–H5: grupė × rodiklis (χ², Fišerio testas 2×2 lentelėms su mažais tikėtinais dažniais, Mann–Whitney U laikui ir paklaidai); H6–H7: patirtis ir įrenginys, A/B palyginimas pogrupiuose, CMH; H8–H10: amžius, lytis, sritis; H11: CMH kontroliuojant demografinius veiksnius.
5. **Korekcija** – Holmo–Bonferronio metodas visiems eksperimento testams arba kiekvienai hipotezei atskirai (pasirenkama); efekto dydis – Kramerio V (Mann–Whitney U – r).
6. **Interpretavimas** – reikšmingos priklausomybės, jų stiprumas ir kryptis pagal dažnių lentelę.

Analizės vienetas – atskiras bandymas (atsakymas į vieną klausimą). Testų rezultatai sutikrinti su SciPy ir statsmodels.

## Talpinimas internete (Railway)

Sistema naudoja SQLite failą, todėl serveriui reikia **nuolatinio disko (volume)**, kitaip duomenys dings po kiekvieno perkrovimo.

1. Prisijunkite prie https://railway.com su GitHub paskyra.
2. **New Project → Deploy from GitHub repo** → pasirinkite `vilsta/eksperimentas` ir šaką, iš kurios diegsite.
3. Serviso **Variables** skiltyje pridėkite:
   - `DATA_DIR` = `/data`
   - `ADMIN_EMAIL` = jūsų el. paštas
   - `ADMIN_PASSWORD` = stiprus slaptažodis
4. Serviso nustatymuose pridėkite **Volume**, kurio mount path `/data`.
5. **Settings → Networking → Generate Domain** – gausite viešą HTTPS adresą.
6. Palaukite, kol diegimas baigsis (Deployments → Active), ir patikrinkite:
   - dalyvio portalas: `https://<adresas>/`
   - tyrėjo portalas: `https://<adresas>/admin`

`ADMIN_EMAIL` ir `ADMIN_PASSWORD` taikomi kiekvieno paleidimo metu: pakeitus slaptažodį ir perdiegus, galioja naujasis. Kai jie nustatyti, numatytoji paskyra `tyrejas@ktu.lt` / `prototipas` pašalinama. Reikšmes įrašykite be kabučių. Railway automatiškai paduoda `PORT`, o kiekvienas `git push` į pasirinktą šaką iš naujo įdiegia sistemą (duomenys volume lieka).

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
