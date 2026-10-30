"""Prepare a relocatable, inference-only Windows runtime, never a copied venv."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'build/auto-mix-runtime'
PYTHON_VERSION = '3.12.10'
PYTHON_SHA256 = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
CHECKPOINT = '955717e8-8726e21a.th'


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def checked_remove(directory):
    # All replacements are generated directories immediately under our build root.
    if directory.resolve().parent != OUTPUT.resolve():
        raise ValueError('Refusing to replace a directory outside the runtime staging root')
    if directory.exists():
        shutil.rmtree(directory)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != 'win32' or sys.version_info[:2] != (3, 12):
        raise RuntimeError('Prepare with the Python 3.12 x64 stem environment')
    packages = Path(sys.prefix) / 'Lib/site-packages'
    installed = {d.metadata['Name']: d.version for d in importlib.metadata.distributions()}
    if installed.get('torch') != '2.5.1+cpu' or installed.get('demucs') != '4.0.1':
        raise RuntimeError('Run scripts/setup-auto-mix-stems.ps1 to install pinned CPU inference dependencies')
    checkpoint = args.cache / 'models/hub/checkpoints' / CHECKPOINT
    if not checkpoint.is_file():
        subprocess.run([sys.executable, str(ROOT / 'resources/auto-mix/stem_worker.py'),
                        '--cache', str(args.cache), '--warmup'], check=True)
    if not digest(checkpoint).startswith('8726e21a'):
        raise RuntimeError('Official htdemucs checkpoint checksum mismatch')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    signature = {
        'python': PYTHON_VERSION, 'packages': installed,
        'preparer': digest(Path(__file__)), 'worker': digest(ROOT / 'resources/auto-mix/stem_worker.py'),
        'model': digest(checkpoint)
    }
    manifest_path = OUTPUT / 'manifest.json'
    previous = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
    runtime = OUTPUT / 'python'
    if previous.get('signature') != signature or not (runtime / 'python.exe').is_file():
        downloads = ROOT / 'build/stem-downloads'
        downloads.mkdir(parents=True, exist_ok=True)
        archive = downloads / f'python-{PYTHON_VERSION}-embed-amd64.zip'
        if not archive.is_file():
            urllib.request.urlretrieve(f'https://www.python.org/ftp/python/{PYTHON_VERSION}/{archive.name}', archive)
        if digest(archive) != PYTHON_SHA256:
            raise RuntimeError('Official embedded Python archive SHA256 mismatch')
        staging = OUTPUT / f'python-staging-{os.getpid()}'
        checked_remove(staging)
        staging.mkdir()
        try:
            with zipfile.ZipFile(archive) as zipped:
                zipped.extractall(staging)
            (staging / 'python312._pth').write_text(
                'python312.zip\n.\nLib/site-packages\nimport site\n', encoding='utf-8')
            excluded = {'__pycache__', 'tests', 'test', 'include', 'cmake', 'docs', 'doc', 'examples', 'benchmarks'}
            excluded_suffixes = {'.pyc', '.pyo', '.pdb', '.lib', '.exp', '.obj', '.a', '.h', '.hpp', '.exe'}
            original_bytes = kept_bytes = 0
            for file in packages.rglob('*'):
                if not file.is_file():
                    continue
                original_bytes += file.stat().st_size
                relative = file.relative_to(packages)
                if (set(relative.parts) & excluded or file.suffix.lower() in excluded_suffixes or
                        relative.parts[0] in {'pip', 'scipy', 'scipy.libs'} or
                        relative.parts[0].startswith(('pip-', 'scipy-'))):
                    continue
                target = staging / 'Lib/site-packages' / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file, target)
                kept_bytes += file.stat().st_size
            # Verify the isolated interpreter and actual Demucs import chain before replacing a working runtime.
            subprocess.run([str(staging / 'python.exe'), '-I', '-B', '-c',
                            'import torch,torchaudio,numpy,soundfile; from demucs.pretrained import get_model; '
                            'assert torch.version.cuda is None; print("Embedded CPU imports: passed")'], check=True)
            checked_remove(runtime)
            # Windows virus scanners can briefly retain a handle after the import smoke test.
            for attempt in range(40):
                try:
                    staging.rename(runtime)
                    break
                except PermissionError:
                    if attempt == 39:
                        raise
                    time.sleep(0.25)
            manifest_path.write_text(json.dumps({
                'signature': signature, 'sourceDependencyBytes': original_bytes, 'dependencyBytes': kept_bytes
            }, indent=2), encoding='utf-8')
        finally:
            checked_remove(staging)
    models = OUTPUT / 'models'
    models.mkdir(exist_ok=True)
    shutil.copy2(checkpoint, models / CHECKPOINT)
    shutil.copy2(packages / 'demucs/remote/htdemucs.yaml', models / 'htdemucs.yaml')
    # FFmpeg shares the already bundled decoder DLLs rather than adding a second copy.
    ffmpeg = ROOT / 'resources/lib/ffmpeg'
    ffmpeg_bin = ffmpeg / 'bin'
    executable = ffmpeg_bin / 'ffmpeg.exe'
    license_file = ffmpeg / 'LICENSE.txt'
    if not executable.is_file():
        installed = Path(os.environ['VCPKG_INSTALLED_DIR']) if os.environ.get('VCPKG_INSTALLED_DIR') else Path(os.environ.get('VCPKG_ROOT', ROOT / 'vcpkg')) / 'installed'
        triplet = installed / 'x64-windows'
        ffmpeg_bin = triplet / 'bin'
        executable = triplet / 'tools/ffmpeg/ffmpeg.exe'
        license_file = triplet / 'share/ffmpeg/copyright'
    if not executable.is_file():
        raise RuntimeError('FFmpeg executable is missing. Install vcpkg ffmpeg[ffmpeg] or provide resources/lib/ffmpeg/bin/ffmpeg.exe')
    native = ROOT / 'build/native-addon'
    native.mkdir(parents=True, exist_ok=True)
    for file in [executable, *ffmpeg_bin.glob('*.dll')]:
        if file.suffix.lower() not in {'.dll', '.exe'}:
            continue
        target = native / file.name
        if not target.is_file() or digest(file) != digest(target):
            shutil.copy2(file, target)
    shutil.copy2(license_file, native / 'FFmpeg-LICENSE.txt')
    subprocess.run([str(native / 'ffmpeg.exe'), '-version'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([str(runtime / 'python.exe'), '-I', '-B', str(ROOT / 'resources/auto-mix/stem_worker.py'),
                    '--cache', str(args.cache), '--model-repo', str(models), '--warmup'], check=True)
    manifest = json.loads(manifest_path.read_text())
    print(json.dumps({'runtime': str(runtime), 'sourceDependencyMiB': round(manifest['sourceDependencyBytes'] / 2**20, 1),
                      'slimDependencyMiB': round(manifest['dependencyBytes'] / 2**20, 1),
                      'offlineModel': CHECKPOINT, 'ffmpeg': str(native / 'ffmpeg.exe')}))


if __name__ == '__main__':
    main()
