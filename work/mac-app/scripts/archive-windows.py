"""Create a portable ZIP without Finder metadata; zipfile marks Unicode paths as UTF-8."""
import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def archive_windows(source: Path, destination: Path) -> int:
    source, destination = source.resolve(), destination.resolve()
    if not source.is_dir() or destination.is_relative_to(source):
        raise ValueError("Expected an application directory and an archive outside it")
    destination.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with ZipFile(destination, "w", ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(source.rglob("*")):
            relative = file.relative_to(source)
            if any(part in ("__MACOSX", ".DS_Store") or part.startswith("._") for part in relative.parts):
                continue
            if file.is_symlink():
                raise ValueError(f"Unexpected symlink in Windows package: {relative}")
            if file.is_file():
                archive.write(file, (Path(source.name) / relative).as_posix())
                count += 1
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    arguments = parser.parse_args()
    print(f"Portable Windows archive: {archive_windows(arguments.source, arguments.destination)} files")
