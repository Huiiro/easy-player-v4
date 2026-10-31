"""Build an optional, relocatable Apple Silicon CPU separator; no system Python at runtime."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'build/auto-mix-runtime'
DOWNLOADS = ROOT / 'build/stem-downloads'
PYTHON_ASSET = 'cpython-3.12.16+20261026-aarch64-apple-darwin-install_only_stripped.tar.gz'
PYTHON_URL = 'https://github.com/astral-sh/python-build-standalone/releases/download/20261026/' + PYTHON_ASSET
PYTHON_SHA256 = '353d5f1b4fd2715e7053f12f068435d5bbad16b91e057006b5d01e0925709a7e'
MODEL_SHA256 = '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4'
CHECKPOINT = '955717e8-8726e21a.th'


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(*args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, **kwargs)


def remove_generated(directory):
    if directory.resolve().parent != OUTPUT.resolve():
        raise ValueError('Refusing to replace a directory outside the runtime staging root')
    if directory.exists():
        shutil.rmtree(directory)


def slim(runtime):
    packages = runtime / 'lib/python3.12/site-packages'
    # Keep import metadata, licenses, .so/.dylib files and all transitive runtime packages.
    excluded = {'__pycache__', 'tests', 'test', 'include', 'cmake', 'docs', 'doc',
                'examples', 'benchmarks', 'idlelib', 'tkinter', 'turtledemo', 'ensurepip'}
    for file in sorted(runtime.rglob('*'), key=lambda p: len(p.parts), reverse=True):
        relative = file.relative_to(runtime)
        drop = bool(set(relative.parts) & excluded) or file.suffix in {'.pyc', '.pyo', '.a', '.h', '.hpp'}
        if packages in file.parents:
            first = file.relative_to(packages).parts[0]
            drop = drop or first in {'pip', 'scipy', 'scipy.libs'} or first.startswith(('pip-', 'scipy-'))
        if drop:
            if file.is_dir():
                shutil.rmtree(file)
            else:
                file.unlink()
    # Only the isolated interpreter is exposed, not pip or build-environment scripts.
    for file in (runtime / 'bin').iterdir():
        if file.name not in {'python3', 'python3.12'}:
            file.unlink()


def sign_and_verify(runtime):
    """Check every Mach-O's architecture, deployment target and library references before signing."""
    for file in runtime.rglob('*'):
        if not file.is_file():
            continue
        with file.open('rb') as stream:
            magic = stream.read(4)
        if magic not in (b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca'):
            continue
        arches = subprocess.check_output(['lipo', '-archs', str(file)], text=True).split()
        if 'arm64' not in arches:
            raise RuntimeError(f'Non ARM64 binary: {file}')
        loads = subprocess.check_output(['otool', '-l', str(file)], text=True)
        command = ''
        for line in loads.splitlines():
            fields = line.split()
            if len(fields) == 2 and fields[0] == 'cmd':
                command = fields[1]
            if fields and ((command == 'LC_BUILD_VERSION' and fields[0] == 'minos') or
                           (command == 'LC_VERSION_MIN_MACOSX' and fields[0] == 'version')):
                if tuple(int(x) for x in fields[1].split('.')[:2]) > (12, 0):
                    raise RuntimeError(f'Binary requires macOS newer than 12.0: {file}: {fields[1]}')
            if command == 'LC_RPATH' and fields and fields[0] == 'path':
                if fields[1].startswith('/') and not fields[1].startswith(('/usr/lib/', '/System/Library/')):
                    # Official Torch wheels retain the wheel builder's Conda
                    # prefix beside their valid @loader_path entries. Remove
                    # that fallback; actual external LC_LOAD_DYLIBs still fail below.
                    run('install_name_tool', '-delete_rpath', fields[1], file,
                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        links = subprocess.check_output(['otool', '-L', str(file)], text=True).splitlines()[1:]
        for line in links:
            name = line.strip().split(' (')[0]
            if name.startswith('/') and not name.startswith(('/usr/lib/', '/System/Library/')):
                raise RuntimeError(f'External library dependency: {file}: {name}')
        run('codesign', '--force', '--sign', '-', '--timestamp=none', file,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        run('codesign', '--verify', '--strict', file, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def main():
    if sys.platform != 'darwin' or platform.machine() != 'arm64':
        raise RuntimeError('Prepare this component on a native Apple Silicon runner')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    archive = DOWNLOADS / PYTHON_ASSET
    if not archive.is_file() or digest(archive) != PYTHON_SHA256:
        partial = archive.with_suffix('.part')
        urllib.request.urlretrieve(PYTHON_URL, partial)
        if digest(partial) != PYTHON_SHA256:
            partial.unlink(missing_ok=True)
            raise RuntimeError('Standalone CPython archive checksum mismatch')
        partial.replace(archive)
    staging = OUTPUT / f'macos-staging-{os.getpid()}'
    remove_generated(staging)
    staging.mkdir()
    try:
        with tarfile.open(archive) as tar:
            tar.extractall(staging, filter='data')
        # PBS uses interpreter symlinks. Materialize them so the component ZIP can
        # retain the installer's existing no-symlink policy on every platform.
        runtime = staging / 'materialized'
        shutil.copytree(staging / 'python', runtime, symlinks=False)
        python = runtime / 'bin/python3'
        pip_args = ['-I', '-B', '-m', 'pip', 'install', '--disable-pip-version-check',
                    '--cache-dir', str(DOWNLOADS / 'macos-pip-cache')]
        run(python, *pip_args, 'torch==2.5.1', 'torchaudio==2.5.1', 'numpy==1.26.4',
            'soundfile==0.13.1', 'dora-search==0.1.12', 'einops==0.8.1', 'julius==0.2.7',
            'lameenc==1.8.1', 'openunmix==1.3.0', 'pyyaml==6.0.2', 'tqdm==4.67.1', 'scipy==1.13.1')
        # The worker never calls torchaudio.load/save, so Demucs' obsolete
        # torchaudio constraint is intentionally bypassed, as on Windows.
        run(python, *pip_args, 'demucs==4.0.1', '--no-deps')
        cache = DOWNLOADS / 'model-cache'
        checkpoint = cache / 'models/hub/checkpoints' / CHECKPOINT
        if not checkpoint.is_file():
            run(python, '-I', '-B', ROOT / 'resources/auto-mix/stem_worker.py', '--cache', cache, '--warmup')
        if digest(checkpoint) != MODEL_SHA256:
            raise RuntimeError('Official htdemucs checkpoint checksum mismatch')
        slim(runtime)
        sign_and_verify(runtime)
        remove_generated(OUTPUT / 'python')
        runtime.rename(OUTPUT / 'python')
        models = OUTPUT / 'models'
        models.mkdir(exist_ok=True)
        shutil.copy2(checkpoint, models / CHECKPOINT)
        shutil.copy2(OUTPUT / 'python/lib/python3.12/site-packages/demucs/remote/htdemucs.yaml', models / 'htdemucs.yaml')
        # Run after relocating, with user/system Python environment ignored.
        run(OUTPUT / 'python/bin/python3', '-I', '-B', ROOT / 'resources/auto-mix/stem_worker.py',
            '--cache', cache, '--model-repo', models, '--warmup')
        (OUTPUT / 'manifest.json').write_text(json.dumps({
            'platform': 'darwin', 'arch': 'arm64', 'python': '3.12.16', 'pythonSha256': PYTHON_SHA256,
            'torch': '2.5.1', 'demucs': '4.0.1', 'modelSha256': MODEL_SHA256, 'device': 'cpu'
        }, indent=2))
    finally:
        remove_generated(staging)


if __name__ == '__main__':
    main()
