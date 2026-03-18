-- Seed costs for GPT-5.4 mini and GPT-5.4 nano.
-- Prices are stored as integer euro-cents per 1M tokens.
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
('gpt-5.4-mini', 65, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-5.4-mini', 7, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-5.4-mini', 392, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR'),

('gpt-5.4-nano', 17, CURRENT_DATE, 'input', '1M', false, 'openai', 'EUR'),
('gpt-5.4-nano', 2, CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR'),
('gpt-5.4-nano', 109, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR')
ON CONFLICT DO NOTHING;
