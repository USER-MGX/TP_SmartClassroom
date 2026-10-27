(async () => {
  try {
    const database = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE);
    const result = await database.auth(process.env.MONGO_APP_USERNAME, process.env.MONGO_APP_PASSWORD);
    if (!result.ok) quit(1);
    const { definitions } = require("/opt/smartclassroom-db/schema.js");
    const existing = new Set(await database.getCollectionNames());
    if (!Object.keys(definitions).every((name) => existing.has(name))) quit(1);
    if (!(await database.runCommand({ ping: 1 })).ok) quit(1);
    quit(0);
  } catch (_) {
    quit(1);
  }
})();
