package api

import (
	"testing"
	"time"

	db "openai-api-proxy/db"
)

// Test that computeCosts uses TokenCountPrompt for Inp and
// TokenCountComplete for Outp (correct behavior).
func TestComputeCosts_CorrectBehavior(t *testing.T) {
	// prepare a request summary with different prompt and completion counts
	now := time.Now().UTC()
	rq := db.RequestSummary{
		TokenCountPrompt:   1000,
		TokenCountComplete: 2000,
		RequestTime:        now,
		Model:              "test-model",
	}

	// prepare costs: 1K-unit prices (simple values so arithmetic is easy)
	inp := db.Costs{
		ModelName:     "test-model",
		RetailPrice:   1000, // price unit: 1000 (so price per 1K tokens = 1000)
		TokenType:     "Inp",
		UnitOfMeasure: "1K",
		IsRegional:    true,
		BackendName:   "azure",
		Currency:      "EUR",
		RequestTime:   now,
	}
	out := db.Costs{
		ModelName:     "test-model",
		RetailPrice:   2000,
		TokenType:     "Outp",
		UnitOfMeasure: "1K",
		IsRegional:    true,
		BackendName:   "azure",
		Currency:      "EUR",
		RequestTime:   now,
	}

	costs := []db.Costs{inp, out}

	total, estimated := computeCosts(costs, rq)
	// When same-day costs are present we should not be in estimated mode.
	if estimated {
		t.Fatalf("expected estimated to be false when same-day costs are present")
	}

	// Correct calculation should use prompt for Inp and complete for Outp
	expectedCorrect := rq.TokenCountPrompt*inp.RetailPrice/1000 + rq.TokenCountComplete*out.RetailPrice/1000

	if total != expectedCorrect {
		t.Fatalf("computeCosts returned %d, want %d (correct)", total, expectedCorrect)
	}
}
