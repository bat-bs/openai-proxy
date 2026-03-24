package api

import (
	"testing"
	"time"

	co "openai-api-proxy/costs"
	db "openai-api-proxy/db"
)

// Regression test: input ("input"/"Inp") costs must be computed from prompt tokens, not completion tokens.
func TestComputeCosts_ShouldUsePromptForInp(t *testing.T) {
	now := time.Now().UTC()
	rq := db.RequestSummary{
		TokenCountPrompt:   1000,
		TokenCountComplete: 2000,
		RequestTime:        now,
		Model:              "test-model",
	}

	inp := db.Costs{
		ModelName:     "test-model",
		RetailPrice:   1000, // cents per 1K tokens => 10 EUR / 1K
		TokenType:     "Inp",
		UnitOfMeasure: "1K",
		Currency:      "EUR",
		RequestTime:   now,
		StageType:     db.ContextLengthStageType,
	}
	out := db.Costs{
		ModelName:     "test-model",
		RetailPrice:   2000,
		TokenType:     "Outp",
		UnitOfMeasure: "1K",
		Currency:      "EUR",
		RequestTime:   now,
		StageType:     db.ContextLengthStageType,
	}

	costs := []db.Costs{inp, out}

	total, estimated := computeCosts(costs, rq)
	if estimated {
		t.Fatalf("expected estimated to be false when same-day costs are present")
	}

	// Expected:
	// input: 1000 prompt tokens / 1K = 1 * (1000 cents / 100) = 10 EUR
	// output: 2000 completion tokens / 1K = 2 * (2000 cents / 100) = 40 EUR
	// total: 50 EUR
	expectedCorrect := 50 * co.MoneyUnit

	if total != expectedCorrect {
		t.Fatalf("computeCosts returned %d, want %d (correct)", total, expectedCorrect)
	}
}
