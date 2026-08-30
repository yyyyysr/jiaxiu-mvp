from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

Username = Annotated[str, StringConstraints(min_length=1, max_length=128)]
Password = Annotated[str, StringConstraints(min_length=1, max_length=256)]


class AuthUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    username: str
    role: Literal["contributor", "admin"]
    is_active: bool
    must_change_password: bool


class AuthSession(BaseModel):
    user: AuthUser
    csrf_token: str


class LoginRequest(BaseModel):
    username: Username
    password: Password


class ChangePasswordRequest(BaseModel):
    current_password: Password
    new_password: Password


class CreateUserRequest(BaseModel):
    username: Username
    role: Literal["contributor", "admin"]


class UpdateUserRequest(BaseModel):
    is_active: bool


class TemporaryPasswordResponse(BaseModel):
    user: AuthUser
    temporary_password: str
