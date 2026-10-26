"""Import static PID exporter from sibling script for standalone unittest."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

spec = spec_from_file_location("pid_export_gtfs", Path(__file__).with_name("export_gtfs.py"))
module = module_from_spec(spec)
spec.loader.exec_module(module)
export = module.export
