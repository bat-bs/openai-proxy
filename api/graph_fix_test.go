package api

import (
	"testing"
	"time"

	db "openai-api-proxy/db"
)

// This test asserts the correct behavior: input (Inp) costs should be
// calculated from TokenCountPrompt, not TokenCountComplete. With the
// current buggy implementation, this test will fail and reproduce the bug.
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
		RetailPrice:   1000,
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
	if estimated {
		t.Fatalf("expected estimated to be false when same-day costs are present")
	}

	// Correct calculation should use prompt for Inp and complete for Outp
	expectedCorrect := rq.TokenCountPrompt*inp.RetailPrice/1000 + rq.TokenCountComplete*out.RetailPrice/1000

	if total != expectedCorrect {
		t.Fatalf("computeCosts returned %d, want %d (correct)", total, expectedCorrect)
	}
}
