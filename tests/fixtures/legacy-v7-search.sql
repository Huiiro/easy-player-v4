-- Historical search migration at 1fdc081.

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
