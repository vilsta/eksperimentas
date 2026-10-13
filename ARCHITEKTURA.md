# Sistemos architektūra

## Komponentai

```text
Dalyvio naršyklė                         Tyrėjo naršyklė
       |                                      |
       +-------------- HTTPS ----------------+
                      |
              Cloudflare Tunnel
                      |
                  MacBook
                      |
                Node.js serveris
               /       |       \
        Dalyvio UI   REST API   Tyrėjo UI
                      |
                  SQLite DB
             data/experiment.db
```

## Pagrindinės DB lentelės

- `users` – tyrėjo / administratoriaus paskyros.
- `hypotheses` – H0/H1, kintamieji ir aktuali rekomendacija.
- `recommendation_versions` – rekomendacijų versijų istorija.
- `questions` – klausimo tekstas, formatas, diagramos tipas, paveikslėlis.
- `question_options` – keli atsakymo variantai ir požymis, ar variantas teisingas.
- `question_hypotheses` – klausimo ir hipotezių ryšiai.
- `experiments` – eksperimentai, būsena ir klausimų pateikimo tvarka.
- `experiment_questions` – eksperimento klausimų rinkinys ir pozicija.
- `experiment_hypotheses` – eksperimento ir hipotezių ryšiai.
- `participant_sessions` – vienas dalyvio eksperimento atlikimas ir dalyvio profilis (lytis, amžiaus grupė, sritis, vizualizacijų dažnis, analizės patirtis).
- `answers` – dalyvio atsakymas, teisingumas, laikas, aiškumas, patrauklumas ir sudėtingumas.
- `quality_surveys` – ankstesnės versijos sistemos kokybės apklausa (nebenaudojama, paliekama seniems duomenims).

## Ryšiai

```text
experiments 1 --- N experiment_questions N --- 1 questions
experiments 1 --- N experiment_hypotheses N --- 1 hypotheses
questions   1 --- N question_options
questions   1 --- N question_hypotheses N --- 1 hypotheses
experiments 1 --- N participant_sessions
participant_sessions 1 --- N answers N --- 1 questions
hypotheses 1 --- N recommendation_versions
```

## API

### Vieša dalyvio dalis

- `GET /api/public/profile-questions`
- `POST /api/public/start`
- `POST /api/public/sessions/:id/answer`
- `POST /api/public/sessions/:id/complete`

### Tyrėjo dalis

- `POST /api/login`
- `POST /api/logout`
- `GET /api/admin/dashboard`
- `GET/POST/PUT/DELETE /api/admin/questions...`
- `GET/POST/PUT /api/admin/hypotheses...`
- `GET/POST/PUT/PATCH /api/admin/experiments...`
- `GET /api/admin/sessions`
- `GET /api/admin/sessions/:id`
- `GET /api/admin/results/summary`
- `GET /api/admin/export.csv`
