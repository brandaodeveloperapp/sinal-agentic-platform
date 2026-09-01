"""Types describing a golden suite and the outcome of running it."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class Persona(BaseModel):
    subject: str
    customer_id: str | None = None
    scopes: list[str] = Field(default_factory=list)


class Case(BaseModel):
    id: str
    category: str
    persona: str
    input: str
    expect_tools: list[str] = Field(default_factory=list)
    forbid_tools: list[str] = Field(default_factory=list)
    must_contain: list[str] = Field(default_factory=list)
    forbid_substrings: list[str] = Field(default_factory=list)
    max_tool_calls: int | None = None
    max_total_tokens: int | None = None


class Suite(BaseModel):
    suite: str
    description: str = ""
    personas: dict[str, Persona]
    cases: list[Case]

    @classmethod
    def load(cls, path: Path) -> Suite:
        data = yaml.safe_load(path.read_text())
        return cls.model_validate(data)


@dataclass
class CaseResult:
    case_id: str
    category: str
    passed: bool
    failures: list[str] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)
    total_tokens: int = 0
    answer: str = ""


@dataclass
class SuiteResult:
    suite: str
    results: list[CaseResult]

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def pass_rate(self) -> float:
        return self.passed / self.total if self.total else 0.0

    def by_category(self) -> dict[str, tuple[int, int]]:
        buckets: dict[str, list[CaseResult]] = {}
        for r in self.results:
            buckets.setdefault(r.category, []).append(r)
        return {c: (sum(1 for r in rs if r.passed), len(rs)) for c, rs in buckets.items()}

    def to_baseline(self) -> dict[str, Any]:
        return {
            "suite": self.suite,
            "pass_rate": round(self.pass_rate, 4),
            "passed": self.passed,
            "total": self.total,
            "cases": {r.case_id: r.passed for r in self.results},
        }
