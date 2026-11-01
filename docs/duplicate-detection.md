# Duplicate detection

The report is read-only with respect to songs and audio files. Derived analysis
is stored separately in SQLite's `duplicate_analysis_cache` table. File deletion
continues to require a user selection and the existing cleanup confirmation.

## Modes

- Quick: size/SHA-256 and normalized title/artist/duration candidates.
- Deep: additionally run the pinned local Chromaprint `fpcalc` tool, without
  network requests, on up to the first 60 seconds of each local file by default.
  Users may select 120 seconds for a longer segment. The two lengths use distinct
  fingerprint, pair and report cache keys; SHA-256 results are shared.
  Fingerprint extraction uses a bounded pool of child processes: 2 by default,
  with 1/2/4 selectable in the report. Concurrency is not a cache key: changing
  scheduling must preserve existing analysis and match results.
- Deep matches are review candidates, never proof of identical full recordings
  or equivalent audio quality. The displayed coverage describes the analyzed
  segment, not the whole song. Files that cannot yield a usable fingerprint
  retain their quick-scan results and appear in the skipped-fingerprint list.

The current matcher uses coarse fingerprint anchors to discover candidates,
aligns starts within ten seconds, and requires at least 100 fingerprint frames,
85% analyzed-segment coverage and 90% bit agreement. These conservative settings
are engineering thresholds, not calibrated probabilities. A group is labelled
as an audio match only when every nonidentical pair has supporting evidence;
transitive similarity alone is insufficient.

## Cache invalidation

- SHA-256: normalized absolute path, size, mtime, ctime, filesystem device/inode,
  and hash-cache version.
- Fingerprints: the file-state signature plus extractor/algorithm/sample-length
  version. Fingerprints are compressed before persistence.
- Pair results, including nonmatches: ordered content hashes plus extractor and
  matcher versions. Metadata edits can reuse these results.
- Reports: the file-state and metadata snapshot, scan mode and rule versions.
  Each returned report still receives a fresh session report ID and timestamp.
- Cache entries older than thirty days are discarded; initialization also limits
  report entries and overall entry count. Clear-cache removes only derived data.
- Force-recompute bypasses pre-existing cache entries. A task-specific cache namespace
  lets the same interrupted forced job reuse its own completed checkpoints, while
  also publishing fresh derived data for future scans.

Reports show current checking, SHA-256, extraction, matching and total wall-clock
times, including time spent waiting for background work. A cached report shows
the time spent on the current scan, not the original extraction time.

Update `fingerprintVersion()`, `FINGERPRINT_MATCH_VERSION` or the report-key version
whenever the corresponding extraction, matching or grouping rules change. A
file-state cache is a performance optimization, not a content-integrity proof:
cleanup always rehashes current selected and retained files without these caches.

## Component and validation

`npm run prepare:fpcalc` prepares the platform-specific pinned official binary,
verifies the release archive SHA-256 and writes an executable manifest. It can
reuse a verified archive in `build/fpcalc-downloads`. Runtime validates the
executable against the manifest. Packaging scripts prepare and bundle the tool
and its license texts. No Python installation or remote identification service
is required. Extraction uses cancellable child processes and pauses during
lightweight playback mode.
Cancellation aborts all active workers and drains the pool before the scan
returns or accepts another task. Extraction resumes after leaving lightweight
mode. SHA-256 remains sequential. Candidate indexing and persistence yield
between bounded batches on the main process. Uncached comparisons
run in a dedicated `fingerprintMatchWorker` thread. The concurrency selector
applies specifically to extraction.

## Matching performance

Candidate generation streams batches of at most 128 pairs, excluding identical
SHA-256 files and recordings with duration differences over ten seconds before
pair voting. Common-anchor caps, voting requirements, alignment, score and
coverage thresholds remain unchanged. Each query file retains only its own vote
map rather than a library-wide map of every potential pair.

The comparison Worker receives transferable fingerprint buffers once and builds
compact sorted anchors once per file. Pair requests carry IDs only. Score pruning
stops an alignment only when it can no longer improve the current best score;
anchor tie ordering is preserved. Cache reads are batched and new positive and
negative scores are committed in transactions. Repeated content pairs reuse a
bounded in-memory memo during the same scan.

Progress separates index construction from candidate processing, shows processed
pair count, and reports actual computations versus reused scores. Worker startup
is lazy: a fully cached matching pass starts no comparison thread. Cancellation
terminates the Worker before the scan settles; lightweight mode pauses between
bounded batches. Worker code never opens the database or accesses audio files.

`npm run test:fingerprint-matching` compares the optimized code against the frozen
legacy scorer and candidate eligibility, checks real Worker results and cache
reuse, and exercises cancellation. `npm run perf:fingerprint-matching` additionally
benchmarks a larger synthetic library and writes
`build/fingerprint-matching-benchmark.json`. These timings are synthetic workload
measurements, not estimates for every library or disk.

Run `npm run test:duplicate-cache` after preparing the fingerprint tool and audio
FFmpeg runtime. The test generates temporary recordings, verifies WAV/FLAC/AAC
matching, unrelated-recording rejection, offset alignment, persistent cache hits,
file-change invalidation, forced recalculation and cleanup revalidation.

## Background tasks and restart recovery

The main process owns one scan task; closing a report, destroying its renderer or
changing pages does not cancel it. The global task entry shows progress and
reopens the current report. Users can pause and resume explicitly. An explicit
pause remains paused across launches; a running or interrupted task resumes
automatically after application startup.

SQLite `duplicate_scan_task` stores options, progress, status, final report and
retention choices separately from disposable analysis caches. Progress is saved
at phase transitions and at most once per second, with the latest progress saved
synchronously on normal quit. Completed reports and choices survive restarting
and clearing analysis caches. Only small task state is updated during scanning;
the full report is written once on completion.

Recovery rechecks current file state and library metadata, then reuses completed
SHA-256, fingerprint and pair results. It restarts an unfinished file or bounded
comparison batch rather than resuming within a decoder stream. Changed files
invalidate their derived data. Cache eviction or an explicit cache clear can
require additional recomputation. The recovery screen shows the saved checkpoint
while file validation runs. Cleanup is never automatically resumed or executed;
it still requires user selection, confirmation and fresh file validation.

`npm run test:duplicate-task` exercises real SQLite close/reopen, forced-scan
checkpoint reuse, report/choice persistence, pause draining, crash recovery and
immediate quit. `npm run test:ui` checks background continuation, the global
entry, renderer recreation and pause/resume using Chromium's real DOM.

## Parallel file state checks

Before cache lookup, file metadata is revalidated with up to eight outstanding
`lstat` calls, independently of fingerprint extraction concurrency. Work is
scheduled lazily; normalized paths are reserved before I/O, and results and
skipped files are assembled in input order so completion order cannot invalidate
existing report cache keys. Checks remain read-only. No full audio data is read
in this phase. Playback-only mode stops new checks, and cancellation stops
scheduling and drains in-flight native filesystem calls before settling.

Checking progress includes active request count, the oldest outstanding path and
playback suspension state. A one-second heartbeat keeps slow I/O visible. Up to
five checks taking at least one second are listed in the current report details;
those diagnostics describe the current validation pass even on a cached report.
No file is treated as unchanged solely because of previously cached metadata.

`npm run test:duplicate-checking` covers the request bound, stable ordering,
deduplication, unavailable paths, monotonic progress, cancellation, playback pause
and slow-path diagnostics. Add `-- --benchmark` to compare serial and eight-way
validation on 4,000 temporary local tiny files after metadata warmup. These
figures are a local metadata workload, not a prediction for network mounts or
unavailable disks.

## Fingerprint diagnostics and report language

Unsuccessful extraction retains a structured reason, subprocess exit code and
up to 4 KB of stderr. Reasons distinguish timeout, process startup, decoding,
invalid output, insufficient usable audio, output limit, changed files and
unreadable files. URL query strings and terminal control sequences are removed
from diagnostics. Cancellation and playback suspension are not file failures.

The main process writes each failure at warning level with the prefix
`[Duplicate Files] fingerprint extraction failed`. The report details show a
localized reason and expandable raw diagnostics. Failures are stored with the
report, including across restart; older reports only contain paths and require
a new scan to obtain reasons. Failed files are not cached as successful results.

Markdown export receives the active UI language and uses a single language for
headings, labels, metric names and reason descriptions. Song metadata, paths,
SHA-256 values and original subprocess diagnostics remain unchanged. Exporting
an older report in a different language does not require rescanning.

`npm run test:fingerprint-diagnostics` covers extraction failure categories,
bounded/redacted diagnostics, cancellation exclusion and single-language export.
`npm run test:duplicate-cache` also checks real fpcalc stderr and exit codes for
an invalid audio file.

## Recoverable decode warnings and compatibility decoding

Exit code 3 is accepted only when fpcalc still produces valid JSON and at least
100 valid fingerprint frames. The result retains a decoding warning, exit code
and bounded stderr; other nonzero exit codes, invalid output, timeout and short
segments remain failures. Warnings survive compressed fingerprint cache and
report reuse and appear separately from failures in the UI and localized export.
The comparison thresholds are unchanged. Cached report grouping uses version 4;
previous successful per-file analysis can still be reused.

For DFF/DSF input that fpcalc cannot open (exit code 2), the bundled FFmpeg decodes
only the configured 60/120-second segment to an application-owned temporary mono
11025 Hz PCM WAV. The result is fingerprinted normally, and the library's full
song duration is retained for candidate filtering. Compatibility processing has
bounded subprocess lifetime, honors cancellation and playback suspension, retries
after playback suspension, and removes its temporary directory on every path.
It does not modify the source or automatically clean library entries.

Paths under `__MACOSX` and files beginning `._` are excluded before metadata and
fingerprint I/O with a localized sidecar reason. Existing library rows are kept.
The minimum usable fingerprint length is unchanged for short audio.
