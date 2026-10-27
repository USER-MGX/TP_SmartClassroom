"use strict";

// Preserve the design's collection boundaries; application UUID ids map to _id.
const text = { bsonType: "string" };
const id = { bsonType: "string", minLength: 1 };
const date = { bsonType: "date" };
const optionalText = { bsonType: ["string", "null"] };
const optionalDate = { bsonType: ["date", "null"] };
const integer = { bsonType: ["int", "long"], minimum: 0 };
const number = { bsonType: ["double", "int", "long", "decimal"] };
const object = { bsonType: "object" };
const timestamps = { created_at: date, updated_at: date };
const moduleTypes = [
  "media", "text", "wordcloud", "choice", "image_upload", "lottery",
  "platform_interaction", "experiment",
];
const activityTypes = moduleTypes.filter((type) => !["media", "text"].includes(type));
const enumString = (values) => ({ bsonType: "string", enum: values });
const index = (key, name, unique = false) => ({ key, name, ...(unique ? { unique } : {}) });
const responseProperties = { _id: id, session_id: id, student_id: id, submitted_at: date };
const responseRequired = ["session_id", "student_id", "submitted_at"];
const responseIndexes = [
  index({ session_id: 1, student_id: 1 }, "session_student"),
  index({ student_id: 1 }, "student"),
];

function definition(required, properties, indexes = []) {
  return {
    validator: { $jsonSchema: {
      bsonType: "object",
      required: ["_id", ...required],
      properties: { _id: id, ...properties },
    } },
    validationLevel: "strict",
    validationAction: "error",
    indexes,
  };
}

const definitions = {
  course: definition(["name", "created_at", "updated_at"], {
    name: { ...text, minLength: 1 }, code: optionalText, description: optionalText,
    cover_url: optionalText, ...timestamps,
  }),
  page: definition(["course_id", "order_index", "title", "created_at", "updated_at"], {
    course_id: id, order_index: integer, title: text, note: optionalText, ...timestamps,
  }, [index({ course_id: 1, order_index: 1 }, "course_order")]),
  module: definition([
    "page_id", "order_index", "type", "name", "x", "y", "w", "h", "style", "config",
    "created_at", "updated_at",
  ], {
    page_id: id, order_index: integer, type: enumString(moduleTypes), name: text,
    ...Object.fromEntries(["x", "y", "w", "h"].map((field) => [
      field, { ...number, minimum: 0, maximum: 100 },
    ])),
    style: object, config: object, ...timestamps,
  }, [index({ page_id: 1, order_index: 1 }, "page_order")]),
  material: definition(["name", "type", "file_url", "mime_type", "size", "created_at", "updated_at"], {
    name: text, type: enumString(["image", "video"]), file_url: text,
    poster_url: optionalText, mime_type: text, size: integer,
    width: { bsonType: ["int", "long", "null"], minimum: 1 },
    height: { bsonType: ["int", "long", "null"], minimum: 1 },
    duration: { bsonType: [...number.bsonType, "null"], minimum: 0 },
    tags: { bsonType: ["array", "null"], items: text }, ...timestamps,
  }, [index({ type: 1 }, "type")]),
  student: definition(["name", "student_no"], {
    name: text, student_no: text, group: optionalText, class_name: optionalText,
  }, [index({ student_no: 1 }, "student_no")]),
  class_session: definition(["course_id", "started_at", "status"], {
    course_id: id, teacher_id: optionalText, room: optionalText,
    started_at: date, ended_at: optionalDate,
    status: enumString(["ongoing", "ended", "archived"]),
  }, [index({ course_id: 1, status: 1 }, "course_status")]),
  interaction_session: definition([
    "class_session_id", "course_id", "page_id", "module_id", "type", "title",
    "config_snapshot", "status",
  ], {
    class_session_id: id, course_id: id, page_id: id, module_id: id,
    type: enumString(activityTypes), title: text, config_snapshot: object,
    status: enumString(["pending", "active", "closed"]),
    started_at: optionalDate, ended_at: optionalDate,
  }, [
    index({ class_session_id: 1, status: 1 }, "class_status"),
    index({ course_id: 1 }, "course"), index({ page_id: 1 }, "page"),
    index({ module_id: 1 }, "module"),
  ]),
  wordcloud_answer: definition([...responseRequired, "answer"], {
    ...responseProperties, answer: text,
    words: { bsonType: ["array", "null"], items: text },
  }, responseIndexes),
  choice_answer: definition([...responseRequired, "option_index"], {
    ...responseProperties, option_index: { ...integer, maximum: 3 },
    is_correct: { bsonType: ["bool", "null"] },
  }, [
    index({ session_id: 1, student_id: 1, option_index: 1 }, "session_student_option", true),
    index({ student_id: 1 }, "student"),
  ]),
  image_upload: definition([...responseRequired, "file_url", "mime_type", "size"], {
    ...responseProperties, file_url: text, mime_type: text, size: integer,
  }, responseIndexes),
  lottery_draw: definition(["session_id", "student_id", "draw_order", "drawn_at"], {
    session_id: id, student_id: id, draw_order: { ...integer, minimum: 1 }, drawn_at: date,
  }, [
    index({ session_id: 1, draw_order: 1 }, "session_draw_order", true),
    index({ student_id: 1 }, "student"),
  ]),
  platform_interaction_result: definition([...responseRequired, "interaction_key", "result_data"], {
    ...responseProperties, interaction_key: text, result_data: object,
  }, responseIndexes),
  experiment_result: definition(["session_id", "student_id", "experiment_id", "result_data", "status"], {
    ...responseProperties, experiment_id: id, result_data: object,
    score: { bsonType: [...number.bsonType, "null"] },
    status: enumString(["running", "submitted", "graded"]), submitted_at: optionalDate,
  }, responseIndexes),
};

async function applySchema(database) {
  for (const [name, specification] of Object.entries(definitions)) {
    const { indexes, ...options } = specification;
    if ((await database.getCollectionInfos({ name })).length === 0) {
      const result = await database.createCollection(name, options);
      if (!result.ok) throw new Error(`Cannot create collection ${name}: ${JSON.stringify(result)}`);
    } else {
      const result = await database.runCommand({ collMod: name, ...options });
      if (!result.ok) throw new Error(`Cannot update collection ${name}: ${JSON.stringify(result)}`);
    }
    if (indexes.length) {
      const result = await database.runCommand({ createIndexes: name, indexes });
      if (!result.ok) throw new Error(`Cannot create indexes for ${name}: ${JSON.stringify(result)}`);
    }
  }
}

module.exports = { definitions, applySchema };
