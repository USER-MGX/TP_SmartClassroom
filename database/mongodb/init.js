/* Runs automatically on an empty Docker volume, or through reinitialize.js. */
(async () => {
  const { applySchema } = require("/opt/smartclassroom-db/schema.js");
  const name = process.env.MONGO_INITDB_DATABASE;
  const username = process.env.MONGO_APP_USERNAME;
  const password = process.env.MONGO_APP_PASSWORD;
  if (!name || !username || !password) throw new Error("MongoDB database/app credentials are missing");
  if (["admin", "local", "config"].includes(name)) throw new Error("Use a dedicated application database");
  const database = db.getSiblingDB(name);
  await applySchema(database);
  if (!(await database.getUser(username))) {
    await database.createUser({ user: username, pwd: password, roles: [{ role: "readWrite", db: name }] });
  }
  print(`MongoDB initialized: ${name}, 13 application collections; existing records preserved.`);
})();
