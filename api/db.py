"""SQLite database models for user accounts and attempt history."""
from __future__ import annotations
import datetime
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = "sqlite:///data/quarry.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    username      = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=True)
    created_at    = Column(DateTime, default=datetime.datetime.utcnow)


class Attempt(Base):
    __tablename__ = "attempts"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, nullable=False, index=True)
    question_id   = Column(String, nullable=False)
    skill         = Column(String)
    domain        = Column(String)
    is_correct    = Column(Boolean, nullable=False)
    chosen_answer = Column(String, nullable=True)   # null for older rows
    created_at    = Column(DateTime, default=datetime.datetime.utcnow)


# Create tables if they don't exist yet
Base.metadata.create_all(engine)


def _migrate():
    """Add columns introduced after initial deployment without dropping data."""
    inspector = inspect(engine)
    existing = {c["name"] for c in inspector.get_columns("attempts")}
    with engine.begin() as conn:
        if "chosen_answer" not in existing:
            conn.execute(text("ALTER TABLE attempts ADD COLUMN chosen_answer TEXT"))

_migrate()
