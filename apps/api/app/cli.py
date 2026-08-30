import argparse
import getpass
import sys
from collections.abc import Sequence
from uuid import uuid4

from app.app_db import migrate_app_db
from app.core.config import Settings
from app.repositories.users import (
    create_user,
    get_user_credentials,
    normalize_username,
)
from app.services.auth import validate_password


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    for command, help_text in (
        ("create-user", "创建本地用户"),
        ("ensure-user", "确保部署初始用户存在"),
    ):
        create = commands.add_parser(command, help=help_text)
        create.add_argument("--username", required=True)
        create.add_argument("--role", choices=("admin", "contributor"), required=True)
        create.add_argument("--password-stdin", action="store_true")
    return parser


def _read_password(*, password_stdin: bool) -> str:
    if password_stdin:
        # Read raw bytes and decode explicitly. PowerShell pipes strings to native
        # commands as UTF-8 with a BOM (sometimes duplicated), and letting the
        # console codec decode those bytes turns them into garbage characters that
        # end up hashed into the password, which makes the account unusable.
        stream = getattr(sys.stdin, "buffer", None)
        if stream is None:
            return sys.stdin.readline(258).lstrip("\ufeff").rstrip("\r\n")
        return stream.readline(258).decode("utf-8", errors="replace").lstrip("\ufeff").rstrip("\r\n")
    password = getpass.getpass("密码：")
    confirmation = getpass.getpass("再次输入密码：")
    if password != confirmation:
        raise ValueError("两次输入的密码不一致。")
    return password


def main(argv: Sequence[str] | None = None, settings: Settings | None = None) -> int:
    args = _parser().parse_args(argv)
    app_settings = settings or Settings()
    migrate_app_db(app_settings)

    if args.command in {"create-user", "ensure-user"}:
        try:
            password = _read_password(password_stdin=args.password_stdin)
            validate_password(password)
            if args.command == "ensure-user":
                existing = get_user_credentials(
                    app_settings, normalize_username(args.username)
                )
                if existing is not None:
                    if existing.user.role != args.role:
                        raise ValueError(
                            "用户名已存在，但角色与部署配置不一致。"
                        )
                    print("用户已存在，保持原账号配置。")
                    return 0
            create_user(
                app_settings,
                username=args.username,
                password=password,
                role=args.role,
                request_id=f"cli-{uuid4().hex}",
            )
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        print("用户已创建。")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
