export const DATABASE_SCHEMA_VERSION = 1

export const schemaV1 = `
  CREATE TABLE IF NOT EXISTS music_source (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT,
    server TEXT,
    base_url TEXT,
    user TEXT,
    secret TEXT,
    auth_type TEXT,
    status TEXT,
    source_order INTEGER DEFAULT 0,
    imported_count INTEGER DEFAULT 0,
    song_count INTEGER DEFAULT 0,
    last_connect DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS folder (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid INTEGER,
    name TEXT NOT NULL,
    full_path TEXT NOT NULL UNIQUE,
    is_root_path INTEGER NOT NULL,
    import_time TEXT NOT NULL,
    FOREIGN KEY(pid) REFERENCES folder(id)
  );

  CREATE TABLE IF NOT EXISTS song (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    duration INTEGER,
    cover TEXT,
    audio TEXT NOT NULL UNIQUE,
    folder_id INTEGER NOT NULL,
    is_newest INTEGER DEFAULT 0,
    lrc TEXT,
    translation TEXT,
    year INTEGER,
    genre TEXT,
    bitrate INTEGER,
    sample_rate INTEGER,
    bit_depth INTEGER,
    channels INTEGER,
    format TEXT,
    file_name TEXT,
    file_size INTEGER,
    play_times INTEGER DEFAULT 0,
    track_no INTEGER,
    disk_no INTEGER,
    song_status INTEGER DEFAULT 1,
    source_id INTEGER,
    remote_id TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(folder_id) REFERENCES folder(id) ON DELETE RESTRICT,
    FOREIGN KEY(source_id) REFERENCES music_source(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS song_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cover TEXT,
    description TEXT,
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS song_list_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_list_id INTEGER NOT NULL,
    song_id INTEGER NOT NULL,
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(song_list_id) REFERENCES song_list(id) ON DELETE CASCADE,
    FOREIGN KEY(song_id) REFERENCES song(id) ON DELETE CASCADE,
    UNIQUE(song_list_id, song_id)
  );

  CREATE TABLE IF NOT EXISTS tag (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#888888',
    description TEXT,
    tag_order INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS song_tag (
    song_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (song_id, tag_id),
    FOREIGN KEY(song_id) REFERENCES song(id) ON DELETE CASCADE,
    FOREIGN KEY(tag_id) REFERENCES tag(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL UNIQUE,
    play_time DATETIME NOT NULL,
    FOREIGN KEY(song_id) REFERENCES song(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL,
    playlist_id INTEGER,
    playlist_name TEXT,
    played_seconds INTEGER DEFAULT 0,
    started_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(song_id) REFERENCES song(id) ON DELETE CASCADE,
    FOREIGN KEY(playlist_id) REFERENCES song_list(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS download_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT,
    resource_id TEXT,
    sub_id TEXT,
    title TEXT,
    file_path TEXT,
    quality TEXT,
    extra_json TEXT,
    status TEXT,
    progress INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_song_title ON song(title);
  CREATE INDEX IF NOT EXISTS idx_song_artist ON song(artist);
  CREATE INDEX IF NOT EXISTS idx_song_album ON song(album);
  CREATE INDEX IF NOT EXISTS idx_song_folder_id ON song(folder_id);
  CREATE INDEX IF NOT EXISTS idx_song_source_id ON song(source_id);
  CREATE INDEX IF NOT EXISTS idx_song_source_remote ON song(source_id, remote_id);
  CREATE INDEX IF NOT EXISTS idx_history_play_time ON history(play_time DESC);
  CREATE INDEX IF NOT EXISTS idx_play_history_song_id ON play_history(song_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_task
    ON download_task (platform, resource_id, sub_id, quality);
`
