CREATE INDEX IF NOT EXISTS requests_request_time_idx
    ON requests (request_time);

CREATE INDEX IF NOT EXISTS requests_api_key_id_request_time_idx
    ON requests (api_key_id, request_time);

CREATE INDEX IF NOT EXISTS apikeys_owner_idx
    ON apikeys (owner);
