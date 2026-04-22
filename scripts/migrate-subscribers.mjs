// migrate-subscribers.mjs
// One-time script to bulk-import old subscribers into Firestore.
//
// Usage:
//   node scripts/migrate-subscribers.mjs path/to/serviceAccount.json
//
// Get your service account key from:
//   Firebase Console → Project Settings → Service Accounts → Generate new private key

import { readFileSync } from "fs";
import { createSign } from "crypto";

// ---------------------------------------------------------------------------
// Subscriber data (deduplicated by email, skipping invalid/blank rows)
// ---------------------------------------------------------------------------
const RAW = [
  { email: "aidan.schurr@gwmail.gwu.edu", firstName: "Aidan", lastName: "Schurr" },
  { email: "naama.bendor1@gmail.com", firstName: "Naama", lastName: "Ben-Dor" },
  { email: "lpreci@millenniumbrooklynhs.org", firstName: "Lori", lastName: "Preci" },
  { email: "helloman398@gmail.com", firstName: "Ben", lastName: "Affleck" },
  { email: "effiekessous@gmail.com", firstName: "Effie", lastName: "Kessous" },
  { email: "pia.cooper@gwu.edu", firstName: "Pia", lastName: "Cooper" },
  { email: "amcclain@gwu.edu", firstName: "Abby", lastName: "McClain" },
  { email: "helloman696@gmail.com", firstName: "Yair", lastName: "Ben-Dor" },
  { email: "rivibd@gmail.com", firstName: "Rivi", lastName: "Ben-Dor" },
  { email: "nb852@georgetown.edu", firstName: "Naama", lastName: "Ben-Dor" },
  { email: "itsikbd@gmail.com", firstName: "Itsik", lastName: "Ben-Dor" },
  { email: "arbimacaj@gmail.com", firstName: "Arbi", lastName: "Macaj" },
  { email: "atcarter2002@gmail.com", firstName: "Alexander", lastName: "Carter" },
  { email: "luciaskustra@gmail.com", firstName: "Lucia", lastName: "Kustra" },
  { email: "luciakustra12@gwu.edu", firstName: "Lucia", lastName: "Kustra" },
  { email: "smpatton@gwu.edu", firstName: "Sims", lastName: "Patton" },
  { email: "vajosephson21@gmail.com", firstName: "Violet", lastName: "Josephson" },
  { email: "vjosephson@gwu.edu", firstName: "Violet", lastName: "Josephson" },
  { email: "shahar.bendor2@gmail.com", firstName: "Shahar", lastName: "Ben-Dor" },
  { email: "km445@georgetown.edu", firstName: "Kathleen", lastName: "Maguire-Zeiss" },
  { email: "stk76@yahoo.com", firstName: "Steven", lastName: "Kane" },
  { email: "ruth.morehouse@gwmail.gwu.edu", firstName: "Ruth", lastName: "Morehouse" },
  { email: "sethdavidcarp@gmail.com", firstName: "Seth", lastName: "Carp" },
  { email: "shapo.joshua@gmail.com", firstName: "Joshua", lastName: "Shapo" },
  { email: "samanthamicozzi@gmail.com", firstName: "Samantha", lastName: "Micozzi" },
  { email: "smicozzi26@gwu.edu", firstName: "Samantha", lastName: "Micozzi" },
  { email: "loripreci@gwu.edu", firstName: "Lori", lastName: "Preci" },
  { email: "aidan.schurr@gwu.edu", firstName: "Aidan", lastName: "Schurr" },
  { email: "robinsolomon@outlook.com", firstName: "Robin", lastName: "Solomon" },
  { email: "twyka02@gwmail.gwu.edu", firstName: "Tyler", lastName: "Wyka" },
  { email: "tmc91@georgetown.edu", firstName: "Thomas", lastName: "Coate" },
  { email: "leehepeleg23@gmail.com", firstName: "Leehe", lastName: "Peleg" },
  { email: "yairbendor2@gmail.com", firstName: "Yair", lastName: "Ben-Dor" },
  { email: "ksworme@yahoo.com", firstName: "Kathryn", lastName: "Worme" },
  { email: "loops4erez@gmail.com", firstName: "Erez", lastName: "Yarden" },
  { email: "yardenvlogs1@gmail.com", firstName: "Erez", lastName: "Yarden" },
  { email: "blivisnadav@icloud.com", firstName: "Nadav", lastName: "Blivis" },
  { email: "acarter45@gwmail.gwu.edu", firstName: "Alex", lastName: "Carter" },
  { email: "sas562@georgetown.edu", firstName: "Steph", lastName: "Solomon" },
  { email: "slmathison@aol.com", firstName: "Stuart", lastName: "Mathison" },
  { email: "jgmathison@aol.com", firstName: "June", lastName: "Mathison" },
  { email: "bellamielcarek@gwu.edu", firstName: "Isabella", lastName: "Mielcarek" },
  { email: "tantanr@gmail.com", firstName: "Jonathan", lastName: "Rotman" },
  { email: "cmaher1117@gmail.com", firstName: "Charlotte", lastName: "Maher" },
  { email: "yael.klucznik@gmail.com", firstName: "Yael", lastName: "Klucznik" },
  { email: "purvaja.26.dance@gmail.com", firstName: "Purvaja", lastName: "Pisupati" },
  { email: "n.halbfinger@gwmail.gwu.edu", firstName: "Natasha", lastName: "Halbfinger" },
  { email: "yeji922@gmail.com", firstName: "Yeji", lastName: "Kim" },
  { email: "rathernotsay398@gmail.com", firstName: "Zack", lastName: "Miller" },
  { email: "amu16@georgetown.edu", firstName: "Ava", lastName: "Uditsky" },
  { email: "schurr88@gmail.com", firstName: "Simon", lastName: "Schurr" },
  { email: "mkm7244@psu.edu", firstName: "Michael", lastName: "Mensah" },
  { email: "blivisofek@gmail.com", firstName: "Ofek", lastName: "Blivis" },
  { email: "bar.shir@gwmail.gwu.edu", firstName: "Bar", lastName: "Shir" },
  { email: "donovandossous@gmail.com", firstName: "Donovan", lastName: "Dossous" },
  { email: "samuelzheng111@gmail.com", firstName: "Samuel", lastName: "Zheng" },
  { email: "abbyhom258079@gmail.com", firstName: "Abby", lastName: "Hom" },
  { email: "chrispauldonato@gmail.com", firstName: "Christian", lastName: "Donato" },
  { email: "erezroy8@gmail.com", firstName: "Erez", lastName: "Yarden" },
  { email: "gengyanglin118@gmail.com", firstName: "Geng", lastName: "Lin" },
  { email: "dorote.macaj@gmail.com", firstName: "Dorotea", lastName: "Macaj" },
  { email: "dorotea.macaj@stonybrook.edu", firstName: "Dorotea", lastName: "Macaj" },
  { email: "dorotea.macaj@icloud.com", firstName: "Dor", lastName: "Mac" },
  { email: "lpreci@schools.nyc.gov", firstName: "Lirika", lastName: "Preci" },
  { email: "lirika.preci@gmail.com", firstName: "Lirika", lastName: "Preci" },
  { email: "jacob.schwartz@gwmail.gwu.edu", firstName: "Jacob", lastName: "Schwartz" },
  { email: "samuel.schwartz@gwu.edu", firstName: "Sam", lastName: "Schwartz" },
  { email: "kpatel102405@gmail.com", firstName: "Karan", lastName: "Patel" },
  { email: "skyeschurr25@gmail.com", firstName: "Skye", lastName: "S" },
  { email: "sss.saraa12@gmail.com", firstName: "Sara", lastName: "Halal" },
  { email: "dhj624@gwmail.gwu.edu", firstName: "Sung", lastName: "Jung" },
  { email: "rmacaj718@aol.com", firstName: "Rozina", lastName: "Macaj" },
  { email: "rozina.macaj@gmail.com", firstName: "Rozina", lastName: "Macaj" },
  { email: "rmacaj@schools.nyc.gov", firstName: "Rozina", lastName: "Macaj" },
  { email: "macajr12@gmail.com", firstName: "Rozina", lastName: "Macaj" },
  { email: "isaac_jin@brown.edu", firstName: "Isaac", lastName: "Jin" },
  { email: "loripreci03@gmail.com", firstName: "Lori", lastName: "Preci" },
  { email: "benleynse@gmail.com", firstName: "Ben", lastName: "Leynse" },
  { email: "lucacaruso@gwu.edu", firstName: "Luca", lastName: "Caruso" },
  { email: "bendoryair@gmail.com", firstName: "Yair", lastName: "Ben-Dor" },
  { email: "sbunting@gwmail.gwu.edu", firstName: "Shane", lastName: "Bunting" },
  { email: "steviek4@gmail.com", firstName: "Steve", lastName: "Klein" },
  { email: "morgan.crafts@peraton.com", firstName: "Morgan", lastName: "Crafts" },
  { email: "alexamehlman@gmail.com", firstName: "Alexa", lastName: "Mehlman" },
  { email: "aidanitaischurr@gmail.com", firstName: "Aidan", lastName: "Schurr" },
  { email: "yrotman@asu.edu", firstName: "Yoav", lastName: "Rotman" },
  { email: "dalitshur@gmail.com", firstName: "Dalit", lastName: "Shur Oselka" },
  { email: "lilyamorosino@gwu.edu", firstName: "Lily", lastName: "Amorosino" },
  { email: "jmk442@georgetown.edu", firstName: "Jake", lastName: "Kochman" },
  { email: "sy683@georgetown.edu", firstName: "Samantha", lastName: "Yershov" },
  { email: "ejl117@georgetown.edu", firstName: "Elliot", lastName: "Lovinger" },
  { email: "kdr57@georgetown.edu", firstName: "Kayla", lastName: "Rigoli" },
  { email: "ekl76@georgetown.edu", firstName: "Emma", lastName: "Listokin" },
  { email: "codigamer123@gmail.com", firstName: "Alan", lastName: "Grinberg" },
  { email: "william.shore@gwmail.gwu.edu", firstName: "William", lastName: "Shore" },
  { email: "jenniferleman@gmail.com", firstName: "Jennifer", lastName: "Leman" },
  { email: "sasha.green@gwu.edu", firstName: "Sasha", lastName: "Green" },
  { email: "lukas.t.eder@icloud.com", firstName: "Lukas Thomas", lastName: "Eder" },
  { email: "yarivsimhony@gmail.com", firstName: "Yariv", lastName: "Simhony" },
  { email: "sameen5634@gmail.com", firstName: "Sameen", lastName: "Ahmad" },
  { email: "stoneda4@gmail.com", firstName: "Dan", lastName: "St" },
  { email: "inbar.yacobi@gmail.com", firstName: "Inbar", lastName: "Yacobi" },
  { email: "aksusamuel@gmail.com", firstName: "Samuell", lastName: "Aksu" },
  { email: "aidan.s.brown1@gmail.com", firstName: "Aidan", lastName: "Brown" },
  { email: "keuntae.kim@gwu.edu", firstName: "Keuntae", lastName: "Kim" },
  { email: "aidanmasibaseball@gmail.com", firstName: "Aidan", lastName: "Masi" },
  { email: "frank.preci@gmail.com", firstName: "Frank", lastName: "Preci" },
  { email: "ahmadi@gwu.edu", firstName: "Professor", lastName: "Ahmadi" },
  { email: "jake.sanford1@gwu.edu", firstName: "Jake", lastName: "Sanford" },
  { email: "martinatsimba@gmail.com", firstName: "Martina", lastName: "Tsimba" },
  { email: "thenawalbros@gmail.com", firstName: "Reshad", lastName: "Nawal" },
  { email: "jshin122000@gmail.com", firstName: "Janice", lastName: "Shin" },
  { email: "kyh39612@gmail.com", firstName: "Yonghyun", lastName: "Kim" },
  { email: "zzh2531512@gmail.com", firstName: "Zhenhao", lastName: "Zhao" },
  { email: "frankpreci@dacicorp.com", firstName: "Frank", lastName: "Preci" },
  { email: "sasha.kagan@gwu.edu", firstName: "Sasha", lastName: "Kagan" },
  { email: "nick71lee@gmail.com", firstName: "Nick", lastName: "Lee" },
  { email: "mei.corricello@gmail.com", firstName: "Mei", lastName: "Corricello" },
  { email: "jcassily39@gwmail.gwu.edu", firstName: "Jordan", lastName: "Cassily" },
  { email: "miaelhav2003@gmail.com", firstName: "Mia", lastName: "Elhav" },
  { email: "corneliusraff@protomail.com", firstName: "Cornelius", lastName: "Raff" },
  { email: "hco14@georgetown.edu", firstName: "Hannah", lastName: "O'Grady" },
  { email: "owenj.wolff@gmail.com", firstName: "Owen", lastName: "Wolff" },
  { email: "faby.one1975@gmail.com", firstName: "Fabiola", lastName: "Daci" },
  { email: "dan@gwhillel.org", firstName: "Rabbi", lastName: "Daniel" },
  { email: "jajapichai@gwu.edu", firstName: "Jaja", lastName: "Pichaikul" },
  { email: "chen.victorwei@gmail.com", firstName: "Victor", lastName: "Chen" },
  { email: "sg1783@georgetown.edu", firstName: "Song", lastName: "Gao" },
  { email: "rachel.lee@gwmail.gwu.edu", firstName: "Rachel", lastName: "Lee" },
  { email: "rachel.lee@gwu.edu", firstName: "Rachel", lastName: "Lee" },
  { email: "cecilyphua@gwu.edu", firstName: "Cecily", lastName: "Phua" },
  { email: "coyletone@gmail.com", firstName: "Caroline", lastName: "Tone" },
  { email: "davidrxesq@gmail.com", firstName: "David", lastName: "Schrager" },
  { email: "emilyschoen@gwu.edu", firstName: "Emily", lastName: "Schoen" },
  { email: "pnoguerawdc@gmail.com", firstName: "Pablo", lastName: "Noguera" },
  { email: "diksha.sriram@gwmail.gwu.edu", firstName: "Diksha", lastName: "Sriram" },
  { email: "blivisnadav@gmail.com", firstName: "Nadav", lastName: "Blivis" },
  { email: "emmiet1@gwmail.gwu.edu", firstName: "Emmie", lastName: "Then" },
  { email: "giuliana.grogan@gwmail.gwu.edu", firstName: "Giuliana", lastName: "Grogan" },
  { email: "mrivera61@gwu.edu", firstName: "Maria", lastName: "Rivera" },
  { email: "c.chen5@gwu.edu", firstName: "Celina", lastName: "Chen" },
  { email: "a.weer@gwmail.gwu.edu", firstName: "Abby", lastName: "Weer" },
  { email: "cingram@gwu.edu", firstName: "Camille", lastName: "Ingram" },
  { email: "stephaniemelby@gwu.edu", firstName: "Stephanie", lastName: "Melby" },
  { email: "yairbendor@gwu.edu", firstName: "Yair", lastName: "Ben-Dor" },
  { email: "fionastokes2004@gmail.com", firstName: "Fiona", lastName: "Stokes" },
  { email: "rileyleff@gmail.com", firstName: "Riley", lastName: "Leff" },
  { email: "mashrur.wasek@gwu.edu", firstName: "Mashrur", lastName: "Wasek" },
  { email: "bdbrown@umd.edu", firstName: "Brandon", lastName: "Brown" },
  { email: "amillan1@terpmail.umd.edu", firstName: "Arthur", lastName: "Millan" },
  { email: "pippacu@gmail.com", firstName: "Presley", lastName: "Cuneo" },
  { email: "solarsklar@aol.com", firstName: "Scott", lastName: "Sklar" },
  { email: "zhenyu@gwu.edu", firstName: "Dr.", lastName: "Li" },
  { email: "layla.abdoulaye@bison.howard.edu", firstName: "Layla", lastName: "Abdoulaye" },
  { email: "alexjbrenner@gmail.com", firstName: "Alex", lastName: "Brenner" },
  { email: "act128@georgetown.edu", firstName: "Alexis", lastName: "Tamm" },
  { email: "lpreci1@jh.edu", firstName: "Lori", lastName: "Preci" },
  { email: "alexanderemanueljackson@gmail.com", firstName: "Alexander", lastName: "Jackson" },
  { email: "jacobw1@gwmail.gwu.edu", firstName: "Jacob", lastName: "Wilson" },
  { email: "zachary.crystal@gwu.edu", firstName: "Zach", lastName: "Crystal" },
  { email: "zoekramar@gmail.com", firstName: "Zoe", lastName: "Kramar" },
  { email: "highlandresident190@gmail.com", firstName: "Carol", lastName: "Holley" },
  { email: "bo.vonscheele@stressmedicin.se", firstName: "Bo", lastName: "vom Scheele" },
  { email: "monica.wachowicz@rmit.edu.au", firstName: "Monica", lastName: "Wachowicz" },
  { email: "g.becker1@gwu.edu", firstName: "G", lastName: "Becker" },
  { email: "kquave@email.gwu.edu", firstName: "Kylie", lastName: "Quave" },
  { email: "jacksonbelanger10@gmail.com", firstName: "Jackson", lastName: "Belanger" },
  { email: "yasmin.pang@aol.com", firstName: "Yasmin", lastName: "" },
  { email: "kgedan@gwu.edu", firstName: "Keryn", lastName: "Gedan" },
  { email: "audrey.beaver@gwu.edu", firstName: "Audrey", lastName: "Beaver" },
  { email: "marie.dagum@gwmail.gwu.edu", firstName: "Marie", lastName: "Dagum" },
  { email: "jeanniemann@cox.net", firstName: "Jean", lastName: "Mann" },
  { email: "kelli.dougherty@gwu.edu", firstName: "Kelli", lastName: "Dougherty" },
  { email: "jordanne.jackson@gwu.edu", firstName: "Jordanne", lastName: "Jackson" },
  { email: "fallenimd@gmail.com", firstName: "Massimo", lastName: "Falleni" },
  { email: "all345@columbia.edu", firstName: "Adam", lastName: "Lubinsky" },
  { email: "joshua.shapo@gwmail.gwu.edu", firstName: "Joshua", lastName: "Shapo" },
  { email: "marin@rswamc.com", firstName: "Sofia", lastName: "Milosavljevic-Cook" },
  { email: "aloganathan@mfa.gwu.edu", firstName: "Aditya", lastName: "Loganathan" },
  { email: "wandadavis300@gmail.com", firstName: "Wanda", lastName: "Davis" },
  { email: "lajoie@savebuzzardsbay.org", firstName: "Scott", lastName: "Lajoie" },
  { email: "maho.dhanani@icloud.com", firstName: "Maheen", lastName: "Dhanani" },
  { email: "sienna@halsteads.com", firstName: "Sienna", lastName: "Halstead" },
  { email: "dylan.shugar@gwu.edu", firstName: "Dylan", lastName: "Shugar" },
  { email: "maymay@gwu.edu", firstName: "May May", lastName: "Hubbard" },
  { email: "jejoyner@hotmail.com", firstName: "Jacob", lastName: "Joyner" },
  { email: "dasencio@gwu.edu", firstName: "Diego", lastName: "Asencio" },
  { email: "ella.guichet@gmail.com", firstName: "El", lastName: "Guichet" },
  { email: "a.hedlund@gwu.edu", firstName: "", lastName: "Hedlund" },
  { email: "asra.channa@gwmail.gwu.edu", firstName: "Asra", lastName: "Channa" },
  { email: "lopezr.emma05@gmail.com", firstName: "Emma", lastName: "Lopez-Rivera" },
  { email: "giovanna.perillo@gwu.edu", firstName: "Giovanna", lastName: "Perillo" },
];

// ---------------------------------------------------------------------------
// Deduplicate by lowercase email (keep first occurrence)
// ---------------------------------------------------------------------------
const seen = new Set();
const subscribers = [];
for (const s of RAW) {
  const key = s.email.toLowerCase();
  if (!seen.has(key)) {
    seen.add(key);
    subscribers.push({ ...s, email: key });
  }
}

console.log(`${subscribers.length} unique subscribers to import.`);

// ---------------------------------------------------------------------------
// Firebase JWT + REST helpers (no SDK needed)
// ---------------------------------------------------------------------------
const SA_PATH = process.argv[2];
if (!SA_PATH) {
  console.error("Usage: node scripts/migrate-subscribers.mjs path/to/serviceAccount.json");
  process.exit(1);
}

const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
const PROJECT_ID = sa.project_id;
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  ).toString("base64url");

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(sa.private_key, "base64url");
  const jwt = `${header}.${payload}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get access token: " + JSON.stringify(data));
  return data.access_token;
}

function docId(email) {
  return email.replace(/[^a-z0-9@._-]/g, "_");
}

function toFirestoreDoc(sub, now) {
  return {
    fields: {
      email:      { stringValue: sub.email },
      firstName:  { stringValue: sub.firstName },
      lastName:   { stringValue: sub.lastName },
      status:     { stringValue: "active" },
      source:     { stringValue: "migrated" },
      createdAt:  { stringValue: now },
      updatedAt:  { stringValue: now },
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const token = await getAccessToken();
const now = new Date().toISOString();
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

let created = 0;
let skipped = 0;
let failed = 0;

for (const sub of subscribers) {
  const id = docId(sub.email);
  const url = `${FIRESTORE_BASE}/subscribers/${id}`;

  // Check if already exists
  const check = await fetch(url, { headers });
  if (check.status === 200) {
    console.log(`  skip  ${sub.email} (already exists)`);
    skipped++;
    continue;
  }

  // Create with PATCH (creates or overwrites — safe since we checked above)
  const res = await fetch(`${url}?updateMask.fieldPaths=email&updateMask.fieldPaths=firstName&updateMask.fieldPaths=lastName&updateMask.fieldPaths=status&updateMask.fieldPaths=source&updateMask.fieldPaths=createdAt&updateMask.fieldPaths=updatedAt`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(toFirestoreDoc(sub, now)),
  });

  if (res.ok) {
    console.log(`  added ${sub.email}`);
    created++;
  } else {
    const err = await res.text();
    console.error(`  ERROR ${sub.email}: ${err}`);
    failed++;
  }
}

console.log(`\nDone. Created: ${created}, Skipped (already existed): ${skipped}, Failed: ${failed}`);
