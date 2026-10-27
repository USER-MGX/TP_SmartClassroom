#!/usr/bin/env python3
"""Generate local MongoDB credentials without overwriting existing settings."""

import os
from pathlib import Path
import secrets


def main():
    destination = Path(__file__).resolve().parents[1] / ".env"
    content = (
        "MONGO_ROOT_USERNAME=smartclassroom_admin\n"
        f"MONGO_ROOT_PASSWORD={secrets.token_hex(32)}\n"
        "MONGO_DATABASE=smartclassroom\n"
        "MONGO_APP_USERNAME=smartclassroom_app\n"
        f"MONGO_APP_PASSWORD={secrets.token_hex(32)}\n"
        "MONGO_PORT=27017\n"
    )
    try:
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print(".env 已存在，保留现有配置。")
        return
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(content)
    print("已生成 .env：管理员和应用账号使用独立随机密码，文件仅当前用户可读写。")


if __name__ == "__main__":
    main()
