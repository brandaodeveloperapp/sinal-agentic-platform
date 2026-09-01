"""Run the golden suite, print a scorecard, and gate on regression.

Usage:
    python -m sinal_evals.cli run     # run and print the scorecard
    python -m sinal_evals.cli bless   # save the current result as the baseline
    python -m sinal_evals.cli gate    # fail if any case regressed against the baseline
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from sinal_evals.model import Suite, SuiteResult
from sinal_evals.runner import run_suite

ROOT = Path(__file__).resolve().parents[3]
SUITE_PATH = ROOT / "evals" / "golden" / "telecom_support.yaml"
BASELINE_PATH = ROOT / "evals" / "baselines" / "telecom_support.json"


def _run() -> SuiteResult:
    suite = Suite.load(SUITE_PATH)
    return asyncio.run(run_suite(suite))


def _scorecard(result: SuiteResult) -> None:
    print(f"suite: {result.suite}")
    for r in result.results:
        mark = "PASS" if r.passed else "FAIL"
        print(f"  {mark}  [{r.category}] {r.case_id}")
        for failure in r.failures:
            print(f"        - {failure}")
    print("\nby category:")
    for category, (passed, total) in sorted(result.by_category().items()):
        print(f"  {category}: {passed}/{total}")
    print(f"\noverall: {result.passed}/{result.total} ({result.pass_rate:.0%})")


def cmd_run() -> int:
    result = _run()
    _scorecard(result)
    return 0 if result.passed == result.total else 1


def cmd_bless() -> int:
    result = _run()
    BASELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
    BASELINE_PATH.write_text(json.dumps(result.to_baseline(), indent=2) + "\n")
    print(f"baseline written: {result.passed}/{result.total} at {BASELINE_PATH}")
    return 0


def cmd_gate() -> int:
    if not BASELINE_PATH.exists():
        print("no baseline; run `bless` first", file=sys.stderr)
        return 2
    baseline = json.loads(BASELINE_PATH.read_text())
    result = _run()
    _scorecard(result)

    regressed = [
        case_id
        for case_id, was_passing in baseline["cases"].items()
        if was_passing
        and not next((r.passed for r in result.results if r.case_id == case_id), False)
    ]
    new_cases = [r.case_id for r in result.results if r.case_id not in baseline["cases"]]

    print(f"\nbaseline pass rate: {baseline['pass_rate']:.0%}  current: {result.pass_rate:.0%}")
    if new_cases:
        print(f"new cases not in baseline (run `bless` to record): {', '.join(new_cases)}")
    if regressed:
        print(f"REGRESSION: {len(regressed)} case(s) that passed now fail: {', '.join(regressed)}")
        return 1
    if result.pass_rate < baseline["pass_rate"]:
        print("REGRESSION: overall pass rate dropped below the baseline")
        return 1
    print("no regression")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    command = args[0] if args else "run"
    return {"run": cmd_run, "bless": cmd_bless, "gate": cmd_gate}.get(command, cmd_run)()


if __name__ == "__main__":
    raise SystemExit(main())
