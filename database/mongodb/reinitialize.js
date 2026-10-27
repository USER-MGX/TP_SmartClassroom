(async () => {
  const result = await db.getSiblingDB("admin").auth(
    process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD,
  );
  if (!result.ok) throw new Error("MongoDB administrator authentication failed");
  await load("/opt/smartclassroom-db/init.js");
})();
