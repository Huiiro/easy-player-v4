export const searchSchemaV6 = `
  CREATE TABLE song_search (
    song_id INTEGER PRIMARY KEY REFERENCES song(id) ON DELETE CASCADE,
    title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL, file_name TEXT NOT NULL,
    version INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE song_fts USING fts5(title, artist, album, file_name, tokenize='unicode61');
  CREATE TABLE song_search_pending (
    song_id INTEGER PRIMARY KEY REFERENCES song(id) ON DELETE CASCADE,
    revision TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    attempts INTEGER NOT NULL DEFAULT 0,
    retry_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TRIGGER song_search_insert AFTER INSERT ON song_search BEGIN
    INSERT INTO song_fts(rowid, title, artist, album, file_name)
    VALUES(new.song_id, new.title, new.artist, new.album, new.file_name);
  END;
  CREATE TRIGGER song_search_delete AFTER DELETE ON song_search BEGIN
    DELETE FROM song_fts WHERE rowid=old.song_id;
  END;
  CREATE TRIGGER song_search_update AFTER UPDATE ON song_search BEGIN
    DELETE FROM song_fts WHERE rowid=old.song_id;
    INSERT INTO song_fts(rowid, title, artist, album, file_name)
    VALUES(new.song_id, new.title, new.artist, new.album, new.file_name);
  END;
  CREATE TRIGGER song_search_queue_insert AFTER INSERT ON song BEGIN
    INSERT INTO song_search_pending(song_id) VALUES(new.id);
  END;
  CREATE TRIGGER song_search_queue_update AFTER UPDATE OF title, artist, album, file_name ON song
  WHEN old.title IS NOT new.title OR old.artist IS NOT new.artist
    OR old.album IS NOT new.album OR old.file_name IS NOT new.file_name BEGIN
    DELETE FROM song_search WHERE song_id=new.id;
    INSERT INTO song_search_pending(song_id) VALUES(new.id)
    ON CONFLICT(song_id) DO UPDATE SET revision=lower(hex(randomblob(16))), attempts=0, retry_at=0;
  END;
  INSERT INTO song_search_pending(song_id) SELECT id FROM song;
`

/** Original metadata is normalized once per write, with a substring index. */
export const searchSchemaV7 = `
  CREATE VIRTUAL TABLE song_original_fts USING fts5(
    title, artist, album, file_name, tokenize='trigram case_sensitive 1'
  );
  INSERT INTO song_original_fts(rowid,title,artist,album,file_name)
    SELECT id,search_normalize(title),search_normalize(COALESCE(artist,'')),
      search_normalize(COALESCE(album,'')),search_normalize(COALESCE(file_name,'')) FROM song;
  CREATE TRIGGER song_original_insert AFTER INSERT ON song BEGIN
    INSERT INTO song_original_fts(rowid,title,artist,album,file_name)
      VALUES(new.id,search_normalize(new.title),search_normalize(COALESCE(new.artist,'')),
        search_normalize(COALESCE(new.album,'')),search_normalize(COALESCE(new.file_name,'')));
  END;
  CREATE TRIGGER song_original_update AFTER UPDATE OF title,artist,album,file_name ON song
  WHEN old.title IS NOT new.title OR old.artist IS NOT new.artist
    OR old.album IS NOT new.album OR old.file_name IS NOT new.file_name BEGIN
    DELETE FROM song_original_fts WHERE rowid=old.id;
    INSERT INTO song_original_fts(rowid,title,artist,album,file_name)
      VALUES(new.id,search_normalize(new.title),search_normalize(COALESCE(new.artist,'')),
        search_normalize(COALESCE(new.album,'')),search_normalize(COALESCE(new.file_name,'')));
  END;
  CREATE TRIGGER song_original_delete AFTER DELETE ON song BEGIN
    DELETE FROM song_original_fts WHERE rowid=old.id;
  END;
`
