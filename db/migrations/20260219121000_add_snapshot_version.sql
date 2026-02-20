ALTER TABLE requests
  ADD COLUMN snapshot_version VARCHAR(255);

UPDATE requests
  SET
    snapshot_version = regexp_replace(model, '^.*-(\d{4}-\d{2}-\d{2})$', '\1'),
    model = CASE
      WHEN model ~ '-\d{4}-\d{2}-\d{2}$' THEN regexp_replace(model, '-\d{4}-\d{2}-\d{2}$', '')
      ELSE model
    END
  WHERE model ~ '-\d{4}-\d{2}-\d{2}$';
