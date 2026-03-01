-- Seed "costs" table with placeholder pricing for existing models
INSERT INTO "costs" (
    "model",
    "price",
    "valid_from",
    "token_type",
    "unit_of_messure",
    "is_regional",
    "backend_name",
    "currency"
) VALUES
('gpt-4.1', 170, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-4.1', 43, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-4.1', 678, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-4.1-mini', 34, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-4.1-mini', 9, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-4.1-mini', 136, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-4.1-mini-dz', 38, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-4.1-mini-dz', 10, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-4.1-mini-dz', 150, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-4.1-nano', 9, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-4.1-nano', 3, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-4.1-nano', 34, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-4.1-nano-dz', 10, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-4.1-nano-dz', 3, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-4.1-nano-dz', 38, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-4o', 212, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-4o', 106, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-4o', 847, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-5-chat', 106, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-5-chat', 11, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-5-chat', 848, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-5-mini', 22, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-5-mini', 3, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-5-mini', 170, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-5-mini-dz', 24, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-5-mini-dz', 3, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-5-mini-dz', 187, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-5.1-codex-mini', 22, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-5.1-codex-mini', 3, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-5.1-codex-mini', 170, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-5.2-chat', 149, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-5.2-chat', 15, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-5.2-chat', 1187, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-5.2-codex', 149, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-5.2-codex', 15, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-5.2-codex', 1187, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR')
ON CONFLICT DO NOTHING;
