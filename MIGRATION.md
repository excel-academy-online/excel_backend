# MongoDB -> Firestore migration

## Why there are two databases

Not confusion - an unfinished migration. From the commit history in
`b_backend` (which `excel_backend` squashed into a single "initial" commit):

| Commit | Date | Author | Firestore refs |
| --- | --- | --- | --- |
| `ec67d4a` | 2024-01-23 | Toffee23 | 0 |
| `c7557be` | 2024-05-22 | kayson3 | 0 |
| `e42dbb6` | 2024-05-25 | kayson3 | 0 |
| **`b8b1480`** | **2024-05-26** | kayson3 | **2** - "authentication flow completed" |
| `a5b8c12` | 2024-06-02 | kayson3 | 4 |
| `58699d6` | 2024-06-10 | kayson3 | 6 |
| `b0f7037` | 2024-07-01 | kayson3 | 10 |

The original January 2024 backend was a coherent MongoDB app; Firebase appeared
only as *Storage* for video files. Firestore enters on the commit that adopted
Firebase Auth:

```js
createUserWithEmailAndPassword(auth, email, password)
  .then((userCredential) => {
    // Optional: Store user data in Firestore
    const userRef = doc(collection(firestore, 'users'), userCredential.user.uid);
```

Once identity is the Firebase `uid`, hanging profile data off Firestore is the
path of least resistance - and since the clients read Firestore directly, data
put there needs no endpoint at all. Every feature built after May 2024 went
Firestore-first. The pre-existing Mongo entities were never moved.

The result is two parallel course systems in one file:

| | Mongo (2024 original) | Firestore (later rewrite) |
| --- | --- | --- |
| Create | `CreateCourses` | `createProgramCourse` |
| List | `GetAllCourses` | `getAllCourses` |
| Route | `/api/all-courses` | `/api/course/getAllCourses` |
| Used by | **the shipped ExcelGroup app** | nothing yet |

Note the capitalisation. Two functions ~50 lines apart, same job, different
database, no dual-write.

## Why finish it in the Firestore direction

The original Mongo design was sound, and Mongo genuinely beats Firestore at
aggregations, deep joins, large `$in` queries and per-read cost. None of that
applies here - the codebase contains **zero** `aggregate` calls, two shallow
`populate` calls, and uses `$in` only for cart contents.

What settles it:

1. The client has no MongoDB access and no connection string exists in the
   project. A database nobody can reach is not a database.
2. All three clients already read Firestore directly.
3. Firebase Auth is the identity system, so keeping users in Mongo means
   permanently reconciling two ids for one person.

## How the switch works

`repositories/courseRepository.js` puts both backends behind one interface,
selected by an environment variable:

```
DATA_SOURCE=mongo      # default - current production behaviour
DATA_SOURCE=firestore  # the target
```

Nothing changes until the variable is flipped, and flipping it back is a config
change rather than a deploy of different code.

Both implementations return the identical shape. `scripts/testRepository.js`
(15 checks, `npm run test:repo`) asserts this, including that the Firestore
documents expose `_id`, that Timestamps serialise to ISO strings the way
Mongoose Dates did, and that the JSON the client receives is unchanged.

## Cutover

**1. Find out what is actually in Firestore.** Read-only, writes nothing:

```bash
npm run inspect
```

- Firestore `courses` populated -> proceed.
- Firestore `courses` empty, Mongo populated -> the catalogue is only in Mongo.
  Export it first; that needs the connection string.
- Mongo unreachable -> whatever is in it is effectively gone.

**2. Flip on staging**, run `npm test`, and exercise the four live endpoints:

```
GET  /api/all-courses
GET  /api/get-course-details/:courseId
POST /api/payment/initialize-payment
GET  /api/payment/verify-payment/:reference
```

**3. Flip in production.** Revert by setting `DATA_SOURCE=mongo`.

**4. Once verified**, delete the Mongo half: `models/courses.model.js`, the
`mongoRepo` branch, `CreateCourses`, and eventually `utils/Db.config.js`.

## Still on MongoDB after this change

This change moves the **course** reads. Still Mongo-backed:

- `user.controller.js` - the bcrypt+JWT login path, which no client uses.
  Should be deleted rather than migrated; Firebase Auth already owns identity.
- `purchaseCourse.controller.js` - `User.findOne({ email })` and the
  `user.courses` array.
- `admin.controller.js` - the `Admin` model.
- `gamification.controller.js` - one reference.

User records are the next step and are more delicate than courses, because the
Mongo `_id` and the Firebase `uid` are different identities for the same person
and purchase history is keyed on the Mongo one.

## Known issue, deliberately not fixed here

`GET /api/get-course-details/:courseId` returns **200**, but the ExcelGroup
client treats anything other than **202** as a failure - so successful detail
fetches are marked failed in the app today. This migration preserves the
existing status codes exactly; changing them is a separate change that needs to
be coordinated with a client release.
