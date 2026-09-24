# Credential rotation - REQUIRED

A Firebase service-account private key for the project `excel-academy-online`
was committed to this repository and pushed to
`github.com/excel-academy-online/excel_backend`. It is present from the very
first commit (`2e9e541`).

That key grants **full administrative access** to the Firebase project:
all Firestore data, all Storage objects, and the ability to mint tokens for any
user. It must be treated as compromised.

The working tree has been updated so the key is no longer tracked and cannot be
re-committed, but **removing a file from a repository does not remove it from
history, and does not invalidate the key**. The steps below are still required.

---

## 1. Rotate the key (do this first)

1. Open the [Firebase console](https://console.firebase.google.com/) and select
   **excel-academy-online**.
2. Go to **Project settings -> Service accounts -> Manage service account
   permissions**. This opens Google Cloud IAM.
3. Find the service account whose email ends `@excel-academy-online.iam.gserviceaccount.com`.
4. Under **Keys**, click **Add key -> Create new key -> JSON**. Download it.
5. **Delete the old key**, identified by its key id:

   ```
   c76d983b272e054ad83f5babb663e868626cb181
   ```

   Deleting it is what actually stops the leaked credential working. Until this
   step is done, everything else is cosmetic.

## 2. Load the new key from the environment

Do not put the new file back in the repo. Encode it instead:

```bash
base64 -w0 /path/to/new-key.json
```

Put the result in `.env` locally, and in the host's environment-variable
settings in production (Render: Dashboard -> Service -> Environment):

```
FIREBASE_SERVICE_ACCOUNT_BASE64=<the base64 string>
```

`firebaseadminvar.js` reads this first and only falls back to a local file for
development convenience.

## 3. Check whether the key was used

In Google Cloud Console -> **IAM & Admin -> Service accounts -> [the account]
-> Logs**, review authentication activity for anything you do not recognise.
Also check Firestore and Storage usage graphs for unexpected spikes.

## 4. Purge the key from git history

Rewriting history changes every commit hash. Anyone else with a clone must
re-clone afterwards. **Agree this with your collaborator before running it.**

```bash
# from a fresh clone, with git-filter-repo installed
git clone https://github.com/excel-academy-online/excel_backend.git
cd excel_backend
git filter-repo --invert-paths --path serviceAccountKey.json
git push origin --force --all
git push origin --force --tags
```

Note that GitHub keeps unreferenced objects reachable for a while, and forks
keep their own copies. Rotation in step 1 is the control that actually matters;
this step limits further exposure.

## 5. Also rotate anything else that shared the repo

Check whether these ever appeared in a commit, and rotate if so:

- `Paystack_Secret_Key` - live payment keys
- `Mongo_Uri` - contains the database password
- `Jwt_Secret_Key`
- `key` / `iv` - the video-encryption parameters

## 6. Tell the client

The project owner needs to know a credential with full data access was exposed
in a public-facing repository, and for how long. If any personal data of
students was reachable, local data-protection rules may require a notification.
