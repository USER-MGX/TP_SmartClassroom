/* Run inside the project MongoDB container. Fixtures use a disposable database. */
(async () => {
  const assert = require("node:assert/strict");
  const { randomUUID } = require("node:crypto");
  const { definitions, applySchema } = require("/opt/smartclassroom-db/schema.js");
  assert.equal((await db.getSiblingDB("admin").auth(
    process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD,
  )).ok, 1);

  const application = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE);
  const temporaryName = `smartclassroom_verify_${randomUUID().replaceAll("-", "")}`;
  const temporary = db.getSiblingDB(temporaryName);
  const probeId = randomUUID();
  let checks = 0;
  async function check(label, run) {
    await run();
    checks += 1;
    print(`PASS ${label}`);
  }
  async function rejectsCode(run, code) {
    await assert.rejects(async () => await run(), (error) => error.code === code);
  }
  const now = new Date();
  const timestamps = { created_at: now, updated_at: now };
  const identifiers = Object.fromEntries(Object.keys(definitions).map((name) => [name, randomUUID()]));
  const response = {
    session_id: identifiers.interaction_session,
    student_id: identifiers.student,
    submitted_at: now,
  };
  const fixtures = {
    course: { name: "测试课程", ...timestamps },
    page: { course_id: identifiers.course, order_index: NumberInt(0), title: "测试页面", ...timestamps },
    module: {
      page_id: identifiers.page, order_index: NumberInt(0), type: "choice", name: "选择题",
      x: 0, y: 0, w: 100, h: 100, style: {},
      config: { question: "选什么？", options: ["A", "B", "C", "D"], is_multiple: true },
      ...timestamps,
    },
    material: { name: "测试图片", type: "image", file_url: "images/test.png", mime_type: "image/png", size: NumberInt(10), ...timestamps },
    student: { name: "测试学生", student_no: "TEST-001", group: "第1组" },
    class_session: { course_id: identifiers.course, started_at: now, status: "ongoing" },
    interaction_session: {
      class_session_id: identifiers.class_session, course_id: identifiers.course,
      page_id: identifiers.page, module_id: identifiers.module, type: "choice", title: "测试活动",
      config_snapshot: {}, status: "active", started_at: now,
    },
    wordcloud_answer: { ...response, answer: "实时视频", words: ["实时视频"] },
    choice_answer: { ...response, option_index: NumberInt(1), is_correct: true },
    image_upload: { ...response, file_url: "uploads/test.png", mime_type: "image/png", size: NumberInt(10) },
    lottery_draw: { session_id: response.session_id, student_id: response.student_id, draw_order: NumberInt(1), drawn_at: now },
    platform_interaction_result: { ...response, interaction_key: "constellation_drag", result_data: { points: [[0, 1]] } },
    experiment_result: { ...response, experiment_id: randomUUID(), result_data: {}, status: "running", submitted_at: null },
  };

  try {
    await check("application collections, strict validators and indexes", async () => {
      for (const [name, specification] of Object.entries(definitions)) {
        const info = (await application.getCollectionInfos({ name }))[0];
        assert.ok(info, name);
        assert.equal(info.options.validationLevel, "strict");
        assert.equal(info.options.validationAction, "error");
        assert.deepEqual(info.options.validator, specification.validator);
        const indexes = await application.getCollection(name).getIndexes();
        for (const expected of specification.indexes) {
          const actual = indexes.find((entry) => entry.name === expected.name);
          assert.ok(actual, `${name}.${expected.name}`);
          assert.deepEqual(actual.key, expected.key);
          assert.equal(Boolean(actual.unique), Boolean(expected.unique));
        }
      }
    });
    await applySchema(temporary);
    await check("all 13 collection types accept BSON fixtures", async () => {
      for (const [name, fixture] of Object.entries(fixtures)) {
        await temporary.getCollection(name).insertOne({ _id: identifiers[name], ...fixture });
      }
      assert.equal((await temporary.getCollectionNames()).length, 13);
    });
    await check("reinitialization preserves records", async () => {
      const before = await temporary.course.findOne({ _id: identifiers.course });
      await applySchema(temporary);
      await applySchema(temporary);
      assert.deepEqual(await temporary.course.findOne({ _id: identifiers.course }), before);
      for (const name of Object.keys(definitions)) assert.equal(await temporary.getCollection(name).countDocuments({}), 1);
    });
    await check("required fields, native dates, enums, JSON objects and ranges", async () => {
      const invalid = [
        ["course", { _id: randomUUID() }],
        ["course", { _id: randomUUID(), ...fixtures.course, created_at: "2026-10-26" }],
        ["module", { _id: randomUUID(), ...fixtures.module, config: "{}" }],
        ["module", { _id: randomUUID(), ...fixtures.module, x: -1 }],
        ["module", { _id: randomUUID(), ...fixtures.module, w: 101 }],
        ["class_session", { _id: randomUUID(), ...fixtures.class_session, status: "invalid" }],
        ["choice_answer", { _id: randomUUID(), ...fixtures.choice_answer, option_index: NumberInt(4) }],
        ["choice_answer", { _id: randomUUID(), ...fixtures.choice_answer, option_index: NumberInt(2), is_correct: 1 }],
        ["image_upload", { _id: randomUUID(), ...fixtures.image_upload, size: NumberInt(-1) }],
        ["lottery_draw", { _id: randomUUID(), ...fixtures.lottery_draw, draw_order: NumberInt(0) }],
        ["experiment_result", { _id: randomUUID(), ...fixtures.experiment_result, status: "invalid" }],
      ];
      for (const [name, document] of invalid) await rejectsCode(() => temporary.getCollection(name).insertOne(document), 121);
    });
    await check("unique selections and draw order; multiple selections supported", async () => {
      await rejectsCode(() => temporary.choice_answer.insertOne({ _id: randomUUID(), ...fixtures.choice_answer }), 11000);
      await temporary.choice_answer.insertOne({ _id: randomUUID(), ...fixtures.choice_answer, option_index: NumberInt(2) });
      await rejectsCode(() => temporary.lottery_draw.insertOne({ _id: randomUUID(), ...fixtures.lottery_draw }), 11000);
    });
    await check("invalid updates are rejected", async () => {
      await rejectsCode(() => temporary.module.updateOne({ _id: identifiers.module }, { $set: { config: [] } }), 121);
    });
    await check("application login, read/write and database isolation", async () => {
      const connection = new Mongo("mongodb://127.0.0.1:27017");
      const app = connection.getDB(application.getName());
      assert.equal((await app.auth(process.env.MONGO_APP_USERNAME, process.env.MONGO_APP_PASSWORD)).ok, 1);
      await app.course.insertOne({ _id: probeId, name: "连接验证", ...timestamps });
      assert.equal((await app.course.findOne({ _id: probeId })).name, "连接验证");
      await app.course.updateOne({ _id: probeId }, { $set: { name: "更新验证", updated_at: new Date() } });
      assert.equal((await app.course.findOne({ _id: probeId })).name, "更新验证");
      assert.equal((await app.course.deleteOne({ _id: probeId })).deletedCount, 1);
      await rejectsCode(() => connection.getDB(temporaryName).course.findOne({}), 13);
    });
    await check("anonymous data access is denied", async () => {
      const anonymous = new Mongo("mongodb://127.0.0.1:27017");
      await rejectsCode(() => anonymous.getDB(application.getName()).course.findOne({}), 13);
    });
  } finally {
    await application.course.deleteOne({ _id: probeId });
    assert.match(temporaryName, /^smartclassroom_verify_[a-f0-9]{32}$/);
    await temporary.dropDatabase();
  }
  print(`MongoDB integration checks passed: ${checks}`);
})();
