INSERT INTO models (id) VALUES
('gpt-4.1'),
('gpt-4.1-mini'),
('gpt-4.1-mini-dz'),
('gpt-4.1-nano'),
('gpt-4.1-nano-dz'),
('gpt-4o'),
('gpt-5-chat'),
('gpt-5-mini'),
('gpt-5-mini-dz'),
('gpt-5.1-codex-mini'),
('gpt-5.2-chat'),
('o3-mini')
ON CONFLICT (id) DO NOTHING;
