import importlib.util
from pathlib import Path
import tempfile
from zipfile import ZipFile

script = Path(__file__).resolve().parents[1] / "work/mac-app/scripts/archive-windows.py"
spec = importlib.util.spec_from_file_location("windows_archive", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as directory:
    base = Path(directory)
    source = base / "Wenjian-test-win64"
    source.mkdir()
    chinese_name = "\u4e2d\u6587\u6587\u4ef6.txt"
    original = "\u7b14\u8bb0\u539f\u6587".encode("utf-8")
    (source / chinese_name).write_bytes(original)
    (source / "Wenjian.exe").write_bytes(b"test executable")
    (source / ("._" + chinese_name)).write_bytes(b"Finder metadata")
    (source / ".DS_Store").write_bytes(b"Finder metadata")
    (source / "__MACOSX").mkdir()
    (source / "__MACOSX" / "junk").write_bytes(b"Finder metadata")
    destination = base / "release.zip"
    module.archive_windows(source, destination)
    with ZipFile(destination) as archive:
        expected = "Wenjian-test-win64/" + chinese_name
        assert sorted(archive.namelist()) == sorted([expected, "Wenjian-test-win64/Wenjian.exe"])
        assert archive.getinfo(expected).flag_bits & 0x800, "Unicode names require ZIP UTF-8 flag"
        assert archive.read(expected) == original, "Original bytes must survive extraction"
        assert archive.testzip() is None
    try:
        module.archive_windows(source, source / "nested.zip")
    except ValueError:
        pass
    else:
        raise AssertionError("An archive cannot include its own output")
print("Windows archive Unicode flags, extraction and Finder metadata checks passed")
