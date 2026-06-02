from __future__ import annotations
import uuid
from typing import List, Optional
from pydantic import BaseModel, Field


class QuestionRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question_text: str
    choices: List[str]              # empty for grid-in (student-produced response)
    correct_answer: str
    explanation: str
    domain: str                     # e.g. "Algebra"
    skill: str                      # College Board skill tag
    difficulty: str                 # "Easy" | "Medium" | "Hard"
    calculator_allowed: Optional[bool] = None  # not present in EQB PDF text layer
    source: str                     # "EQB" | "hard_set"
    image_path: Optional[str] = None  # relative path under data/structured/images/
    embedding: List[float] = Field(default_factory=list)
