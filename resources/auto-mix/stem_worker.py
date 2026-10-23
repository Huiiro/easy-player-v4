"""Local, persistent Demucs worker. stdin/stdout carry JSON lines, audio stays local.

Only short transition regions are processed, with context on either side. The
vocal estimate is cached as float WAV; accompaniment is original minus vocals,
which guarantees reconstruction rather than independently normalizing stems.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

MODEL = 'htdemucs'
VERSION = 1
RATE = 44100
MAX_SECONDS = 12
BUDGET = 512 * 1024 * 1024
_model = None


def model():
    global _model
    if _model is None:
        import torch
        from demucs.pretrained import get_model
        torch.set_num_threads(max(1, min(4, (os.cpu_count() or 2) // 2)))
        torch.manual_seed(0)
        _model = get_model(MODEL).cpu().eval()
    return _model


def stat_key(path):
    info = path.stat()
    return [str(path.resolve()), info.st_size, info.st_mtime_ns]


def separate(path, start, seconds, cache, ffmpeg, allow_short=False):
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    start, seconds = float(start), float(seconds)
    if not math.isfinite(start) or not math.isfinite(seconds) or start < 0 or not 0 < seconds <= (40 if allow_short else MAX_SECONDS):
        raise ValueError('Invalid transition region')
    path = Path(path)
    identity = stat_key(path)
    key = hashlib.sha256(json.dumps([VERSION, MODEL, identity, start, seconds]).encode()).hexdigest()
    output = cache / (key + '.wav')
    count = round(seconds * RATE)
    if output.is_file():
        try:
            info = sf.info(output)
            if info.samplerate == RATE and info.channels == 2 and (abs(info.frames - count) <= 1 or (allow_short and 0 < info.frames < count)):
                output.touch()
                return str(output), True
        except RuntimeError:
            pass
        output.unlink(missing_ok=True)
    # Context improves boundary separation; do not infer only a cropped word.
    context_start = max(0, start - 3)
    prefix = round((start - context_start) * RATE)
    length = seconds + (start - context_start) + 3
    command = [ffmpeg, '-nostdin', '-v', 'error', '-ss', str(context_start), '-i', str(path),
               '-t', str(length), '-vn', '-ar', str(RATE), '-ac', '2', '-f', 'f32le', 'pipe:1']
    process = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if process.returncode:
        raise RuntimeError('Could not decode transition region: ' + process.stderr.decode('utf-8', 'replace')[-500:])
    pcm = np.frombuffer(process.stdout, dtype='<f4').copy()
    if allow_short:
        count = min(count, pcm.size // 2 - prefix)
    if pcm.size % 2 or count <= 0 or pcm.size < (prefix + count) * 2 or not np.isfinite(pcm).all():
        raise ValueError('Incomplete or invalid transition PCM')
    audio = torch.from_numpy(pcm.reshape(-1, 2).T.copy())
    reference = audio.mean(0)
    mean, deviation = reference.mean(), reference.std().clamp_min(1e-8)
    normalized = (audio - mean) / deviation
    with torch.inference_mode():
        net = model()
        estimates = apply_model(net, normalized[None], device='cpu', shifts=0,
                                split=True, overlap=0.25, progress=False, num_workers=0)[0]
        vocal = estimates[net.sources.index('vocals')] * deviation
    result = vocal[:, prefix:prefix + count].T.contiguous().numpy()
    if not np.isfinite(result).all() or np.max(np.abs(result)) > 8:
        raise ValueError('Invalid separator output')
    if stat_key(path) != identity:
        raise ValueError('Source changed during separation')
    staging = output.with_suffix('.part.wav')
    sf.write(staging, result, RATE, subtype='FLOAT')
    staging.replace(output)
    return str(output), False


def prune(cache, keep):
    files = sorted(cache.glob('*.wav'), key=lambda x: x.stat().st_mtime, reverse=True)
    total = 0
    for file in files:
        total += file.stat().st_size
        if total > BUDGET and str(file) not in keep:
            file.unlink(missing_ok=True)



def detect_vocal_entry(vocals, mixture):
    """Require sustained vocal estimate plus mixture-relative energy; abstain on noise."""
    import numpy as np
    hop = RATE // 10
    blocks = min(len(vocals), len(mixture)) // hop
    if blocks < 8:
        return None
    v = vocals[:blocks * hop].reshape(blocks, hop, 2)
    m = mixture[:blocks * hop].reshape(blocks, hop, 2)
    levels = np.sqrt(np.mean(v * v, axis=(1, 2)))
    mixed = np.sqrt(np.mean(m * m, axis=(1, 2)))
    threshold = max(0.0015, min(float(levels.max()) * 0.04, 0.006))
    active = (levels >= threshold) & (levels >= mixed * 0.18)
    for at in range(blocks - 5):
        if active[at] and np.count_nonzero(active[at:at + 6]) >= 4:
            return at / 10.0
    return None


def decode_region(path, start, seconds, ffmpeg):
    import numpy as np
    command = [ffmpeg, '-nostdin', '-v', 'error', '-ss', str(start), '-i', str(path),
               '-t', str(seconds), '-vn', '-ar', str(RATE), '-ac', '2', '-f', 'f32le', 'pipe:1']
    decoded = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if decoded.returncode or len(decoded.stdout) % 8:
        raise ValueError('Could not decode analysis region')
    return np.frombuffer(decoded.stdout, dtype='<f4').reshape(-1, 2)


def covered_tail_end(vocals, mixture):
    """Keep the last sustained voice or useful bed, rather than a depleted fade."""
    import numpy as np
    hop = RATE // 10
    count = min(len(vocals), len(mixture))
    blocks = count // hop
    if blocks < 10:
        return count / RATE
    v = vocals[:blocks * hop].reshape(blocks, hop, 2)
    m = mixture[:blocks * hop].reshape(blocks, hop, 2)
    levels = np.sqrt(np.mean(v * v, axis=(1, 2)))
    mixed = np.sqrt(np.mean(m * m, axis=(1, 2)))
    peak = float(mixed.max())
    if peak < 0.003 or float(np.mean(mixed[-5:])) >= peak * 0.4:
        return count / RATE
    energy = np.flatnonzero(mixed >= max(0.003, peak * 0.30))
    threshold = max(0.0025, min(float(levels.max()) * 0.04, 0.006))
    active = (levels >= threshold) & (levels >= mixed * 0.10)
    # Reject isolated separator leakage, but retain the end of a phrase and
    # 300ms of release. No edits are made inside either source recording.
    sustained = np.zeros(blocks, dtype=bool)
    for i in range(blocks - 5):
        if np.count_nonzero(active[i:i + 6]) >= 4:
            sustained[i:i + 6] |= active[i:i + 6]
    voice = np.flatnonzero(sustained)
    end = (int(energy[-1]) + 1) / 10 if len(energy) else count / RATE
    if len(voice):
        end = max(end, (int(voice[-1]) + 1) / 10 + 0.30)
    return min(count / RATE, end)


def outgoing_entry(request, duration, cache, ffmpeg):
    import soundfile as sf
    original = request['outStartFrame'] / request['sampleRate']
    natural_end = original + duration
    analysis_start = max(0.0, natural_end - MAX_SECONDS)
    analysis, cached = separate(request['sourcePath'], analysis_start,
                                natural_end - analysis_start, cache, ffmpeg)
    voice, _ = sf.read(analysis, dtype='float32', always_2d=True)
    mixture = decode_region(request['sourcePath'], analysis_start, len(voice) / RATE, ffmpeg)
    end = analysis_start + covered_tail_end(voice, mixture)
    # Keep the overlap intact and bound the removable fade to eight seconds.
    end = max(duration, natural_end - 8, end)
    if natural_end - end < 0.6:
        end = natural_end
    start_frame = round((end - duration) * request['sampleRate'])
    start = start_frame / request['sampleRate']
    out, out_cached = separate(request['sourcePath'], start, duration, cache, ffmpeg)
    return start_frame, out, cached and out_cached


def incoming_entry(request, duration, cache, ffmpeg):
    import soundfile as sf
    original = request['inStartFrame'] / request['sampleRate']
    if not request.get('vocalCue', True):
        return original, True
    analysis, analysis_cached = separate(request['nextPath'], original, 40, cache, ffmpeg, allow_short=True)
    voice, _ = sf.read(analysis, dtype='float32', always_2d=True)
    mixture = decode_region(request['nextPath'], original, len(voice) / RATE, ffmpeg)
    first = detect_vocal_entry(voice, mixture)
    if first is None:
        return original, analysis_cached
    # Let the next vocal arrive around the outgoing tail's release, preserving
    # a short musical lead-in instead of cutting on the first consonant.
    lead_in = min(3.0, max(1.0, duration * 0.65))
    skip = max(0.0, first - lead_in)
    if skip < 1.0 or skip + duration + 0.1 > len(voice) / RATE:
        return original, analysis_cached
    return original + skip, analysis_cached


def run(request, cache, ffmpeg):
    started = time.monotonic()
    duration = request['fadeFrames'] / request['sampleRate']
    out_frame, out, out_cached = outgoing_entry(request, duration, cache, ffmpeg)
    cue, analysis_cached = incoming_entry(request, duration, cache, ffmpeg)
    cue_frame = round(cue * request['sampleRate'])
    cue = cue_frame / request['sampleRate']
    inc, in_cached = separate(request['nextPath'], cue, duration, cache, ffmpeg)
    prune(cache, {out, inc})
    return {'id': request.get('id'), 'ok': True, 'outVocals': out, 'inVocals': inc,
            'cueStartFrame': cue_frame, 'outStartFrame': out_frame,
            'trimmedTailSeconds': round((request['outStartFrame'] - out_frame) / request['sampleRate'], 2),
            'skippedSeconds': round(cue - request['inStartFrame'] / request['sampleRate'], 2),
            'cached': out_cached and in_cached and analysis_cached, 'seconds': round(time.monotonic() - started, 2)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--request', type=Path)
    parser.add_argument('--warmup', action='store_true')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('TORCH_HOME', str(args.cache / 'models'))
    if sys.platform == 'win32':
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    if args.warmup:
        model()
        print(json.dumps({'ok': True, 'model': MODEL}), flush=True)
        return
    lines = [args.request.read_text(encoding='utf-8')] if args.request else sys.stdin
    for line in lines:
        request = None
        try:
            request = json.loads(line)
            response = run(request, args.cache, args.ffmpeg)
        except Exception as error:
            response = {'id': request.get('id') if isinstance(request, dict) else None,
                        'ok': False, 'error': str(error)[-1000:]}
        print(json.dumps(response, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
