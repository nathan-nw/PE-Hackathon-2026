from peewee import AutoField, BooleanField, CharField, DateTimeField, ForeignKeyField, TextField

from app.database import BaseModel
from app.models.user import User


class Url(BaseModel):
    id = AutoField()
    user = ForeignKeyField(User, field=User.id, backref="urls", on_delete="CASCADE")
    short_code = CharField(unique=True, index=True, max_length=32)
    original_url = TextField()
    title = CharField(null=True)
    is_active = BooleanField(default=True)
    created_at = DateTimeField()
    updated_at = DateTimeField()

    class Meta:
        table_name = "urls"
