"""Bounded local archive-admission regression; no network/toolchain execution."""
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

from materialize import extract_regular


class ArchiveAdmission(unittest.TestCase):
    def fixture(self, entries, omitted=(), limit=100):
        with tempfile.TemporaryDirectory(prefix="archive-admission-") as directory:
            base = Path(directory)
            archive = base / "input.tar.gz"
            with tarfile.open(archive, "w:gz") as output:
                for name, kind, content in entries:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    if kind == tarfile.REGTYPE:
                        member.size = len(content)
                        output.addfile(member, io.BytesIO(content))
                    else:
                        member.linkname = "/SECRET-SENTINEL"
                        output.addfile(member)
            return extract_regular(archive, base / "output", "source", omitted, limit)

    def test_regular(self):
        result = self.fixture([("source/a", tarfile.REGTYPE, b"ok")])
        self.assertEqual(result["regular_bytes"], 2)

    def test_rejected_members(self):
        for name, kind in [("../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE), ("wrong/a", tarfile.REGTYPE), ("source/link", tarfile.SYMTYPE), ("source/hardlink", tarfile.LNKTYPE), ("source/device", tarfile.CHRTYPE), ("source/fifo", tarfile.FIFOTYPE)]:
            with self.subTest(name=name):
                with self.assertRaises(AssertionError):
                    self.fixture([(name, kind, b"bad")])

    def test_duplicate(self):
        with self.assertRaises(AssertionError):
            self.fixture([("source/a", tarfile.REGTYPE, b"a"), ("source/a", tarfile.REGTYPE, b"b")])

    def test_aggregate_bound(self):
        with self.assertRaises(AssertionError):
            self.fixture([("source/a", tarfile.REGTYPE, b"ab")], limit=1)

    def test_exact_omission(self):
        self.assertEqual(self.fixture([("source/setup", tarfile.SYMTYPE, b"")], omitted=["setup"])["omitted_symlinks"], ["setup"])
        with self.assertRaises(AssertionError):
            self.fixture([], omitted=["setup"])


if __name__ == "__main__":
    unittest.main()
