"""Export the generated OpenAPI document into the shared contracts package."""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent / "src"))

from sinal_api.main import app  # noqa: E402

target = pathlib.Path(__file__).parents[3] / "packages" / "contracts" / "openapi"
target.mkdir(parents=True, exist_ok=True)
destination = target / "onda-telecom.openapi.json"
destination.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n")
print(f"wrote {destination}")
