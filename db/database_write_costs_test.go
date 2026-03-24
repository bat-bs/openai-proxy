package database

import (
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestWriteCosts_IgnoresDuplicateNaturalKeys(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer sqlDB.Close()

	database := &Database{db: sqlDB}
	requestTime := time.Date(2026, 3, 24, 0, 0, 0, 0, time.UTC)
	cost := &Costs{
		ModelName:      "gpt-5.4-mini",
		RetailPrice:    130,
		TokenType:      "input",
		UnitOfMeasure:  "1M",
		Currency:       "EUR",
		RequestTime:    requestTime,
		StageType:      ContextLengthStageType,
		StageMinTokens: 272001,
		StageMaxTokens: nil,
	}

	insertQuery := regexp.QuoteMeta(`
		INSERT INTO costs
		  (
		    model, price, valid_from, token_type, unit_of_messure,
		    currency, stage_type, stage_min_tokens, stage_max_tokens
		  )
		VALUES
		  ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (
		  model,
		  valid_from,
		  token_type,
		  unit_of_messure,
		  currency,
		  stage_type,
		  stage_min_tokens,
		  (COALESCE(stage_max_tokens, -1))
		) DO NOTHING`)

	mock.ExpectExec(insertQuery).
		WithArgs(
			cost.ModelName,
			cost.RetailPrice,
			cost.RequestTime,
			cost.TokenType,
			cost.UnitOfMeasure,
			cost.Currency,
			cost.StageType,
			cost.StageMinTokens,
			cost.StageMaxTokens,
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(insertQuery).
		WithArgs(
			cost.ModelName,
			cost.RetailPrice,
			cost.RequestTime,
			cost.TokenType,
			cost.UnitOfMeasure,
			cost.Currency,
			cost.StageType,
			cost.StageMinTokens,
			cost.StageMaxTokens,
		).
		WillReturnResult(sqlmock.NewResult(1, 0))

	if err := database.WriteCosts([]*Costs{cost}); err != nil {
		t.Fatalf("first WriteCosts: %v", err)
	}
	if err := database.WriteCosts([]*Costs{cost}); err != nil {
		t.Fatalf("second WriteCosts: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet: %v", err)
	}
}

func TestWriteCosts_DefaultsMissingCollectorFields(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer sqlDB.Close()

	database := &Database{db: sqlDB}
	cost := &Costs{
		ModelName:     "azure-test-model",
		RetailPrice:   123,
		TokenType:     "Inp",
		UnitOfMeasure: "1M",
		Currency:      "EUR",
	}

	insertQuery := regexp.QuoteMeta(`
		INSERT INTO costs
		  (
		    model, price, valid_from, token_type, unit_of_messure,
		    currency, stage_type, stage_min_tokens, stage_max_tokens
		  )
		VALUES
		  ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (
		  model,
		  valid_from,
		  token_type,
		  unit_of_messure,
		  currency,
		  stage_type,
		  stage_min_tokens,
		  (COALESCE(stage_max_tokens, -1))
		) DO NOTHING`)

	mock.ExpectExec(insertQuery).
		WithArgs(
			cost.ModelName,
			cost.RetailPrice,
			sqlmock.AnyArg(),
			cost.TokenType,
			cost.UnitOfMeasure,
			cost.Currency,
			ContextLengthStageType,
			0,
			cost.StageMaxTokens,
		).
		WillReturnResult(sqlmock.NewResult(1, 1))

	if err := database.WriteCosts([]*Costs{cost}); err != nil {
		t.Fatalf("WriteCosts: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("ExpectationsWereMet: %v", err)
	}
}
