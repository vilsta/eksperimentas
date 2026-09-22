# Railway deployment

1. Push this folder to a GitHub repository.
2. In Railway create a new project from that GitHub repository.
3. Attach a persistent Volume to the web service with mount path:

   /app/data

4. In the service Variables set, before creating the persistent DB:

   ADMIN_EMAIL=your-email@example.com
   ADMIN_PASSWORD=use-a-strong-password

5. Deploy/redeploy the service.
6. In Settings -> Networking choose Generate Domain.
7. Participant portal: https://<your-domain>/
8. Admin portal: https://<your-domain>/admin

The app uses Railway's PORT environment variable automatically.
SQLite is stored at ./data/experiment.db, therefore the /app/data volume keeps it across deploys/restarts.
