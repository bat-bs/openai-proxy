-- Add GPT-5.4 model IDs to the models table.
INSERT INTO models (id) VALUES
('gpt-5.4-mini'),
('gpt-5.4-nano')
ON CONFLICT (id) DO NOTHING;
