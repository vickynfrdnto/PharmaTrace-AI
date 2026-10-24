import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="pharmatrace-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_tmp, 'test.db').as_posix()}"
os.environ["HMAC_SECRET"] = "test-secret-123"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
