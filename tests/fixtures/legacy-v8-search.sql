-- Historical search migration at 1fdc081.

  CREATE TABLE song_sort_reading (
    song_id INTEGER PRIMARY KEY REFERENCES song(id) ON DELETE CASCADE,
    title TEXT, artist TEXT, album TEXT, file_name TEXT
  );
  INSERT INTO song_sort_reading SELECT song_id,search_japanese_sort(song_search.title, COALESCE((SELECT title FROM song WHERE id=song_search.song_id),'')),search_japanese_sort(song_search.artist, COALESCE((SELECT artist FROM song WHERE id=song_search.song_id),'')),search_japanese_sort(song_search.album, COALESCE((SELECT album FROM song WHERE id=song_search.song_id),'')),search_japanese_sort(song_search.file_name, COALESCE((SELECT file_name FROM song WHERE id=song_search.song_id),'')) FROM song_search;
  CREATE TRIGGER song_sort_insert AFTER INSERT ON song_search BEGIN
    INSERT INTO song_sort_reading VALUES(new.song_id,search_japanese_sort(new.title, COALESCE((SELECT title FROM song WHERE id=new.song_id),'')),search_japanese_sort(new.artist, COALESCE((SELECT artist FROM song WHERE id=new.song_id),'')),search_japanese_sort(new.album, COALESCE((SELECT album FROM song WHERE id=new.song_id),'')),search_japanese_sort(new.file_name, COALESCE((SELECT file_name FROM song WHERE id=new.song_id),'')))
    ON CONFLICT(song_id) DO UPDATE SET title=excluded.title,artist=excluded.artist,album=excluded.album,file_name=excluded.file_name;
  END;
  CREATE TRIGGER song_sort_update AFTER UPDATE ON song_search BEGIN
    INSERT INTO song_sort_reading VALUES(new.song_id,search_japanese_sort(new.title, COALESCE((SELECT title FROM song WHERE id=new.song_id),'')),search_japanese_sort(new.artist, COALESCE((SELECT artist FROM song WHERE id=new.song_id),'')),search_japanese_sort(new.album, COALESCE((SELECT album FROM song WHERE id=new.song_id),'')),search_japanese_sort(new.file_name, COALESCE((SELECT file_name FROM song WHERE id=new.song_id),'')))
    ON CONFLICT(song_id) DO UPDATE SET title=excluded.title,artist=excluded.artist,album=excluded.album,file_name=excluded.file_name;
  END;
  CREATE TRIGGER song_sort_delete AFTER DELETE ON song_search BEGIN
    DELETE FROM song_sort_reading WHERE song_id=old.song_id;
  END;
