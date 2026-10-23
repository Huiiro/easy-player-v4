"""Deterministic vocal-entry tests; model inference is checked separately on real audio."""
import sys
sys.dont_write_bytecode = True
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location('stem_worker', Path(__file__).resolve().parents[1] / 'resources/auto-mix/stem_worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class VocalEntryTests(unittest.TestCase):
    def signals(self, entry=8, seconds=14):
        t = np.arange(worker.RATE * seconds) / worker.RATE
        mixture = np.stack([0.2 * np.sin(t * 2 * np.pi * 500)] * 2, axis=1).astype('float32')
        voice = np.stack([0.07 * np.sin(t * 2 * np.pi * 220) * (t >= entry)] * 2, axis=1).astype('float32')
        return mixture + voice, voice

    def test_sustained_voice_and_noise_rejection(self):
        mixture, voice = self.signals()
        self.assertAlmostEqual(worker.detect_vocal_entry(voice, mixture), 8.0)
        self.assertIsNone(worker.detect_vocal_entry(np.zeros_like(voice), mixture))
        self.assertIsNone(worker.detect_vocal_entry(mixture * 0.02, mixture))
        transient = np.zeros_like(voice)
        transient[worker.RATE:worker.RATE + worker.RATE // 10] = voice[worker.RATE * 9:worker.RATE * 9 + worker.RATE // 10]
        self.assertIsNone(worker.detect_vocal_entry(transient, mixture))

    def test_cue_keeps_lead_in_and_option_preserves_intro(self):
        mixture, voice = self.signals()
        with tempfile.TemporaryDirectory(prefix='stem-cue-test-') as directory:
            path = Path(directory) / 'voice.wav'
            sf.write(path, voice, worker.RATE, subtype='FLOAT')
            request = {'nextPath': 'fixture', 'inStartFrame': 0, 'sampleRate': worker.RATE, 'vocalCue': True}
            with patch.object(worker, 'separate', return_value=(str(path), True)), patch.object(worker, 'decode_region', return_value=mixture):
                cue, _ = worker.incoming_entry(request, 4, Path(directory), 'ffmpeg')
                self.assertAlmostEqual(cue, 5.4)
                request['vocalCue'] = False
                self.assertEqual(worker.incoming_entry(request, 4, Path(directory), 'ffmpeg')[0], 0)
            with patch.object(worker, 'separate', side_effect=AssertionError('disabled must skip inference')):
                self.assertEqual(worker.incoming_entry(request, 4, Path(directory), 'ffmpeg')[0], 0)

    def test_tail_keeps_last_phrase_and_removes_depleted_fade(self):
        t = np.arange(worker.RATE * 12) / worker.RATE
        envelope = np.exp(-np.maximum(0, t - 6))
        bed = 0.35 * envelope * np.sin(t * 2 * np.pi * 110)
        voice = 0.09 * np.sin(t * 2 * np.pi * 700) * ((t >= 7) & (t < 9))
        stereo = lambda x: np.stack([x, x], axis=1).astype('float32')
        end = worker.covered_tail_end(stereo(voice), stereo(bed + voice))
        self.assertAlmostEqual(end, 9.30, places=2)
        self.assertLess(worker.covered_tail_end(stereo(voice * 0), stereo(bed)), 8)
        # Quiet separator leakage cannot restore the entire fading tail.
        leak = stereo(voice + 0.0002 * np.sin(t * 2 * np.pi * 220))
        self.assertAlmostEqual(worker.covered_tail_end(leak, stereo(bed + voice)), end)
        # A healthy musical ending and a late sustained vocal must be retained.
        self.assertEqual(worker.covered_tail_end(stereo(voice), stereo(np.sin(t * 700) * 0.2)), 12)
        late = stereo(0.04 * np.sin(t * 700) * (t >= 10))
        self.assertEqual(worker.covered_tail_end(late, stereo(bed) + late), 12)

if __name__ == '__main__':
    unittest.main()
