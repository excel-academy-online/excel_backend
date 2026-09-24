# Deploying the API to Google Cloud Run

Cloud Run is in the same Google Cloud project as Firestore, so the service
authenticates as the project's own service account. **No service-account key
file is deployed** - which is why `.gcloudignore` excludes it.

## Prerequisites

1. **Billing must be enabled** on `excel-academy-online` (Firebase Spark ->
   Blaze). Cloud Run's free tier still applies: 2 million requests a month.
2. Nothing to install locally - use **Cloud Shell** at
   <https://console.cloud.google.com/> (the `>_` icon, top right).

## Deploy

Upload this folder to Cloud Shell (⋮ menu -> *Upload*), then:

```bash
cd excel_backend

gcloud config set project excel-academy-online

gcloud run deploy excel-academy-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --set-env-vars "NODE_ENV=production,DATA_SOURCE=firestore,VIDEO_BASE_URL=https://courses.excelacademyonline.com/wp-content/uploads,FIREBASE_PROJECT_ID=excel-academy-online,projectId=excel-academy-online,FIREBASE_API_KEY=AIzaSyD_b49nKGyE6FrKyJ0X0GipuiTn9nwZOnI,apiKey=AIzaSyD_b49nKGyE6FrKyJ0X0GipuiTn9nwZOnI,FIREBASE_AUTH_DOMAIN=excel-academy-online.firebaseapp.com,authDomain=excel-academy-online.firebaseapp.com,FIREBASE_STORAGE_BUCKET=excel-academy-online.appspot.com,storageBucket=excel-academy-online.appspot.com,FIREBASE_MESSAGING_SENDER_ID=1027112230279,messagingSenderId=1027112230279,FIREBASE_APP_ID=1:1027112230279:web:7356d98f35a5b54df9c722,appId=1:1027112230279:web:7356d98f35a5b54df9c722"
```

`--min-instances 1` keeps one container warm, which is what removes cold
starts. It costs roughly $5-10/month. Drop it to `0` to pay nothing and accept
a ~2 second first request.

`--allow-unauthenticated` means Cloud Run does not gate the service; the API's
own Firebase token checks still apply to every protected route.

## Permissions the service needs

The default compute service account can read Firestore but **cannot manage
Firebase Auth users**, which `requireAdmin` and `scripts/setRole.js` rely on.
Grant it once:

```bash
PROJECT_NUMBER=$(gcloud projects describe excel-academy-online --format='value(projectNumber)')
SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding excel-academy-online \
  --member="serviceAccount:$SA" --role="roles/datastore.user"

gcloud projects add-iam-policy-binding excel-academy-online \
  --member="serviceAccount:$SA" --role="roles/firebaseauth.admin"
```

## After deploying

The command prints a URL like
`https://excel-academy-api-xxxxx-uc.a.run.app`. Check it:

```bash
curl -s https://<your-url>/health
curl -s https://<your-url>/api/all-courses | head -c 300
```

Then point the clients at it:

- Dashboard: set `VITE_API_URL=https://<your-url>/api` and redeploy
- Add the dashboard's origin to `CORS_ORIGINS` on the service, otherwise the
  browser will block it:

```bash
gcloud run services update excel-academy-api --region us-central1 \
  --update-env-vars "CORS_ORIGINS=https://your-dashboard-domain"
```

- Flutter app: `ExcelGroup/lib/core/api_handler/api_endpoints.dart` still points
  at `https://video-streams.onrender.com/api`. Your friend updates that.

## Notes

- MongoDB is not needed: `DATA_SOURCE=firestore` makes the server warn and
  continue when Mongo is absent.
- Logs: `gcloud run services logs read excel-academy-api --region us-central1`
- Redeploy by re-running the same `gcloud run deploy` command.
