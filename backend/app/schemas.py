"""Shared Pydantic schemas. Mirrors frontend/src/types/schemas.ts — keep both in sync by hand."""

from pydantic import BaseModel


class HealthStatus(BaseModel):
    status: str
    service: str
