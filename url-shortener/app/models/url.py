from peewee import (
    AutoField,
    BooleanField,
    CharField,
    DateTimeField,
    ForeignKeyField,
)

from app.database import BaseModel
from app.models.user import User


class Url(BaseModel):
    id = AutoField()
    user_id = ForeignKeyField(User, backref="urls", column_name="user_id")
    short_code = CharField(unique=True, max_length=20, index=True)
    original_url = CharField(max_length=2048)
    title = CharField(max_length=500, null=True)
    is_active = BooleanField(default=True)
    created_at = DateTimeField()
    updated_at = DateTimeField()

    class Meta:
        table_name = "urls"
