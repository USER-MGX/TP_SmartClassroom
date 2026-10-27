# TP_SmartClassroom

途泊智能体课堂助教，使用 **MongoDB 8.0 + Docker Compose**。
业务模型依据 [数据库设计](docs/数据库设计.md)，MongoDB 字段、集合及索引定义见 [schema.js](database/mongodb/schema.js)。

## 启动

需要 Docker Engine、Docker Compose v2+，以及用于生成本地配置的 Python 3。

```bash
python3 scripts/setup_env.py
docker compose up -d --wait
docker compose ps
```

配置脚本生成 `.env`，为管理员和应用账号分别设置随机密码。重复运行会保留现有配置；`.env` 不进入 Git。可参考 [.env.example](.env.example) 修改数据库名、账号或端口。

首次启动自动创建 `smartclassroom` 数据库、13 个业务集合、严格的数据校验规则、查询索引，以及仅能读写此数据库的应用账号。数据库没有演示数据；原设计中的 8 个固定素材尚未提供实际记录。

默认连接地址为 `127.0.0.1:27017`，仅允许本机访问；数据存储在本项目独立的 Docker 命名卷中。容器设为自动重启，健康检查验证应用账号登录和全部业务集合就绪。

## 连接

在 MongoDB Compass 或应用中使用 `.env` 的应用账号和密码：

```text
mongodb://<MONGO_APP_USERNAME>:<MONGO_APP_PASSWORD>@127.0.0.1:27017/smartclassroom?authSource=smartclassroom
```

同一个 Compose 网络内的后端将主机改为 `mongodb`。自定义数据库名或端口后同步修改连接地址；自定义密码包含特殊字符时需进行 URI 编码。管理员只用于维护，认证库为 `admin`。

交互式登录（输入 `.env` 内的应用密码）：

```bash
docker compose exec mongodb sh -c 'exec mongosh "$MONGO_INITDB_DATABASE" --username "$MONGO_APP_USERNAME" --authenticationDatabase "$MONGO_INITDB_DATABASE" --password'
```

## 集合及存储约定

| 数据 | 集合 |
| --- | --- |
| 课程配置 | `course`、`page`、`module` |
| 素材和名单 | `material`、`student` |
| 课堂及活动 | `class_session`、`interaction_session` |
| 各类作答和结果 | `wordcloud_answer`、`choice_answer`、`image_upload`、`lottery_draw`、`platform_interaction_result`、`experiment_result` |

- 原设计的 `id` 映射为 MongoDB `_id`，由应用生成 UUID 字符串；`course_id` 等关联字段也存字符串。
- `config`、`style`、`config_snapshot`、`result_data` 直接存 BSON 对象，`words`、`tags` 存数组，时间使用 BSON Date，布尔值使用原生 boolean。
- 应用负责生成时间戳并在更新时维护 `updated_at`；MongoDB 校验规则不会自动填充默认值。必填字段与允许类型见 `schema.js`。
- 位置和尺寸限制为 `0–100`，状态和模块类型受枚举校验。选择题每个选项一条记录，索引为 `0–3`，同一学生同一活动的同一选项不可重复；统计人数时对 `student_id` 去重。抽签的同场次抽中顺序不可重复。
- MongoDB 不提供跨集合外键或级联删除。应用必须验证课程、页面、模块、课堂及作答的关联关系、活动类型和提交权限，并显式清理课堂关联数据。将课堂状态设为 `archived` 保留全部记录；不设置自动过期删除。
- 当前是单节点部署；需要多集合事务时应先部署副本集。平台交互和实验保留通用对象结构，具体业务规则待需求明确。

## 维护及验证

```bash
# 查看状态与日志
docker compose ps
docker compose logs --tail=100 mongodb

# 对现有数据卷重新应用集合校验及索引（保留记录和已有用户密码）
docker compose exec -T mongodb mongosh --quiet --file /opt/smartclassroom-db/reinitialize.js

# 真实 MongoDB 集成验证：校验规则、索引、重复初始化、读写及账号权限
docker compose exec -T mongodb mongosh --quiet --file /opt/smartclassroom-tests/mongodb.integration.js

# 停止并移除容器，保留数据库卷；下次 up 会复用
docker compose down
```

验证在随机命名的临时数据库内写入测试数据，完成后自动清理；应用账号读写验证仅创建并删除一条独立测试课程。

官方镜像只在空数据卷首次启动时自动执行初始化脚本。修改 `.env` 不会修改已有数据库用户密码；已有卷需用原凭据连接后显式轮换密码，再更新配置。修改 schema 后执行重新初始化命令；它会更新校验规则并补建索引，不负责历史数据迁移、删除旧索引或轮换用户密码，失败时也不会整体回滚。新增唯一索引前需先清理重复记录。

`docker compose down` 保留数据，添加 `-v` 会永久删除本项目数据库卷。此前本地 SQLite 文件不再参与运行。

参考：[MongoDB 官方镜像](https://hub.docker.com/_/mongo)、[MongoDB 数据校验](https://www.mongodb.com/docs/manual/core/schema-validation/)。
