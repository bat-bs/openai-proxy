CREATE TABLE IF NOT EXISTS azure_pricing_config (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    service_name varchar(255) NOT NULL DEFAULT 'Azure OpenAI',
    arm_region_name varchar(255) NOT NULL,
    currency_code char(3) NOT NULL,
    product_name varchar(255),
    arm_sku_name varchar(255),
    meter_name varchar(255),
    price_type varchar(32) NOT NULL DEFAULT 'Consumption',
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS azure_pricing_rules (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name varchar(255) NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    priority integer NOT NULL DEFAULT 0,
    action varchar(16) NOT NULL CHECK (action IN ('map', 'ignore')),
    conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
    assignments jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS azure_pricing_audits (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    operation varchar(16) NOT NULL,
    fetched_audit_id bigint REFERENCES azure_pricing_audits(id),
    outcome varchar(32) NOT NULL,
    configuration jsonb NOT NULL,
    raw_response jsonb NOT NULL,
    counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    rows jsonb NOT NULL DEFAULT '[]'::jsonb,
    error text
);
