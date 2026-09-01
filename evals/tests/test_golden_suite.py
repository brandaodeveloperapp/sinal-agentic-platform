import json
from pathlib import Path

import pytest

from sinal_evals.model import Suite
from sinal_evals.runner import run_case, run_suite

ROOT = Path(__file__).resolve().parents[2]
SUITE = Suite.load(ROOT / "evals" / "golden" / "telecom_support.yaml")
BASELINE = ROOT / "evals" / "baselines" / "telecom_support.json"


async def test_suite_meets_or_beats_the_baseline():
    result = await run_suite(SUITE)
    baseline = json.loads(BASELINE.read_text())
    assert result.pass_rate >= baseline["pass_rate"], [
        (r.case_id, r.failures) for r in result.results if not r.passed
    ]


async def test_no_blessed_case_regressed():
    result = await run_suite(SUITE)
    baseline = json.loads(BASELINE.read_text())
    current = {r.case_id: r.passed for r in result.results}
    regressed = [cid for cid, was in baseline["cases"].items() if was and not current.get(cid)]
    assert regressed == [], regressed


@pytest.mark.parametrize("case", SUITE.cases, ids=[c.id for c in SUITE.cases])
async def test_each_case(case):
    result = await run_case(SUITE, case)
    assert result.passed, result.failures
