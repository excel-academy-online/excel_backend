#!/usr/bin/env node
// End-to-end: boot the real app (Firebase + Mongo stubbed at the edges) and
// fire real HTTP requests to prove the auth layer rejects and admits correctly.
const Module = require("module");
const http = require("http");

let tokenBehaviour = () => { throw Object.assign(new Error("bad"), { code: "auth/argument-error" }); };

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  credential: { cert: () => ({}) },
  firestore: () => ({}),
  storage: () => ({ bucket: () => ({}) }),
  auth: () => ({ verifyIdToken: async (t) => tokenBehaviour(t) }),
};
const cfg = { apiKey:"s", authDomain:"s.firebaseapp.com", projectId:"stub-project",
              storageBucket:"s.appspot.com", messagingSenderId:"1", appId:"1:1:web:1" };

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req.indexOf("firebaseadminvar") !== -1)
    return { admin: adminStub, serviceAccount:{project_id:"stub-project"},
             firebaseConfig: cfg, db:{}, auth: adminStub.auth(), bucket:{} };
  if (req === "firebase-admin") return adminStub;
  if (req === "mongoose") {
    const m = origLoad.call(this, req, parent, isMain);
    m.connect = async () => {};
    return m;
  }
  return origLoad.call(this, req, parent, isMain);
};

Object.assign(process.env, cfg, {
  NODE_ENV: "development", Mongo_Uri: "mongodb://stub/db",
  Jwt_Secret_Key: "stub", key: "0".repeat(64), iv: "0".repeat(32), PORT: "0",
});

const app = require(require("path").join(__dirname, "..", "index.js"));
const server = http.createServer(app);

function call(method, path, headers) {
  return new Promise((resolve) => {
    const req = http.request({ hostname:"127.0.0.1", port: server.address().port,
      path, method, headers: headers||{} }, (res) => {
      let b=""; res.on("data",(c)=>b+=c);
      res.on("end",()=>resolve({ code: res.statusCode, body: b.slice(0,120) }));
    });
    req.on("error",(e)=>resolve({code:0, body:e.message}));
    req.end();
  });
}

server.listen(0, "127.0.0.1", async () => {
  const results = [];
  const check = (name, got, want) => {
    const ok = got === want;
    results.push({ ok, name, got, want });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${got}, want ${want})`);
  };

  check("health is open", (await call("GET","/health")).code, 200);
  check("unknown route -> 404", (await call("GET","/api/nope")).code, 404);

  // No token at all.
  check("admin list w/o token -> 401", (await call("GET","/api/auth/all-users")).code, 401);
  check("cert issue w/o token -> 401", (await call("POST","/api/certificates/issueCertificates")).code, 401);
  check("roles read w/o token -> 401", (await call("GET","/api/roles/getRoles")).code, 401);

  // Garbage token.
  check("bad token -> 401",
    (await call("GET","/api/auth/all-users",{Authorization:"Bearer garbage"})).code, 401);

  // Valid token, but only a student.
  tokenBehaviour = () => ({ uid:"student-1", role:"student" });
  check("student hitting admin route -> 403",
    (await call("GET","/api/auth/all-users",{Authorization:"Bearer good"})).code, 403);
  check("student hitting roles -> 403",
    (await call("GET","/api/roles/getModule",{Authorization:"Bearer good"})).code, 403);

  // Valid admin token should get past auth (whatever the handler then does).
  tokenBehaviour = () => ({ uid:"admin-1", role:"admin" });
  const adminRes = await call("GET","/api/auth/all-users",{Authorization:"Bearer good"});
  check("admin passes auth (not 401/403)", adminRes.code === 401 || adminRes.code === 403, false);

  // Public catalogue must still work anonymously - the shipped app depends on it.
  const pub = await call("GET","/api/all-courses");
  check("public catalogue not blocked", pub.code === 401 || pub.code === 403, false);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  server.close();
  process.exit(failed.length ? 1 : 0);
});
