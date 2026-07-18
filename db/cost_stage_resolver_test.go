package database

import (
	"testing"
	"time"
)

func ptrInt(v int) *int { return &v }

func TestResolveRequestCostStage_GPT54ShortContextUsesShortStage(t *testing.T) {
	validFrom := time.Date(2026, 3, 23, 0, 0, 0, 0, time.UTC)
	requestTime := time.Date(2026, 3, 23, 15, 0, 0, 0, time.UTC)

	// Short tier: input_tokens <= 272000
	// Long tier:  input_tokens >= 272001
	shortMax := 272000

	costRows := []Costs{
		// Existing single-stage row (converted to open-ended).
		{ModelName: "gpt-5.4-mini", RetailPrice: 65, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: nil},
		{ModelName: "gpt-5.4-mini", RetailPrice: 7, RequestTime: validFrom, TokenType: "cached", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: nil},
		{ModelName: "gpt-5.4-mini", RetailPrice: 392, RequestTime: validFrom, TokenType: "output", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: nil},

		// Explicit short stage.
		{ModelName: "gpt-5.4-mini", RetailPrice: 65, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: ptrInt(shortMax)},
		{ModelName: "gpt-5.4-mini", RetailPrice: 7, RequestTime: validFrom, TokenType: "cached", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: ptrInt(shortMax)},
		{ModelName: "gpt-5.4-mini", RetailPrice: 392, RequestTime: validFrom, TokenType: "output", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: ptrInt(shortMax)},

		// Explicit long stage.
		{ModelName: "gpt-5.4-mini", RetailPrice: 130, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 272001, StageMaxTokens: nil},
		{ModelName: "gpt-5.4-mini", RetailPrice: 14, RequestTime: validFrom, TokenType: "cached", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 272001, StageMaxTokens: nil},
		{ModelName: "gpt-5.4-mini", RetailPrice: 588, RequestTime: validFrom, TokenType: "output", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 272001, StageMaxTokens: nil},
	}

	req := RequestCostStageResolutionRequest{
		Model:                 "gpt-5.4-mini",
		RequestTime:           requestTime,
		InputTokenCount:       200_000,
		CachedInputTokenCount: 50_000,
		OutputTokenCount:      100_000,
		StageType:             ContextLengthStageType,
	}

	res := ResolveRequestCostStage(costRows, req)
	if res.Missing {
		t.Fatalf("expected Missing=false, got true")
	}

	if res.InputCost.UsedCost == nil || res.InputCost.UsedCost.StageMaxTokens == nil {
		t.Fatalf("expected short stage match for input")
	}
	if *res.InputCost.UsedCost.StageMaxTokens != shortMax {
		t.Fatalf("expected short stage max=%d, got %v", shortMax, res.InputCost.UsedCost.StageMaxTokens)
	}
	if res.InputCost.UsedCost.RetailPrice != 65 {
		t.Fatalf("expected short input price=65, got %d", res.InputCost.UsedCost.RetailPrice)
	}

	// Cached tokens must still be priced in the same short context stage (stage selector uses input_token_count).
	if res.CachedCost.UsedCost == nil || res.CachedCost.UsedCost.StageMaxTokens == nil {
		t.Fatalf("expected short stage match for cached")
	}
	if *res.CachedCost.UsedCost.StageMaxTokens != shortMax {
		t.Fatalf("expected short stage max=%d for cached, got %v", shortMax, res.CachedCost.UsedCost.StageMaxTokens)
	}
	if res.CachedCost.UsedCost.RetailPrice != 7 {
		t.Fatalf("expected short cached price=7, got %d", res.CachedCost.UsedCost.RetailPrice)
	}

	if res.OutputCost.UsedCost == nil || res.OutputCost.UsedCost.StageMaxTokens == nil {
		t.Fatalf("expected short stage match for output")
	}
	if *res.OutputCost.UsedCost.StageMaxTokens != shortMax {
		t.Fatalf("expected short stage max=%d for output, got %v", shortMax, res.OutputCost.UsedCost.StageMaxTokens)
	}
	if res.OutputCost.UsedCost.RetailPrice != 392 {
		t.Fatalf("expected short output price=392, got %d", res.OutputCost.UsedCost.RetailPrice)
	}
}

func TestResolveRequestCostStage_GPT54LongContextUsesLongStage(t *testing.T) {
	validFrom := time.Date(2026, 3, 23, 0, 0, 0, 0, time.UTC)
	requestTime := time.Date(2026, 3, 23, 15, 0, 0, 0, time.UTC)

	shortMax := 272000

	costRows := []Costs{
		// Open-ended converted row.
		{ModelName: "gpt-5.4-mini", RetailPrice: 65, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: nil},
		{ModelName: "gpt-5.4-mini", RetailPrice: 7, RequestTime: validFrom, TokenType: "cached", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: nil},
		{ModelName: "gpt-5.4-mini", RetailPrice: 392, RequestTime: validFrom, TokenType: "output", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: nil},

		// Short stage.
		{ModelName: "gpt-5.4-mini", RetailPrice: 65, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: ptrInt(shortMax)},
		{ModelName: "gpt-5.4-mini", RetailPrice: 7, RequestTime: validFrom, TokenType: "cached", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: ptrInt(shortMax)},
		{ModelName: "gpt-5.4-mini", RetailPrice: 392, RequestTime: validFrom, TokenType: "output", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: ptrInt(shortMax)},

		// Long stage.
		{ModelName: "gpt-5.4-mini", RetailPrice: 130, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 272001, StageMaxTokens: nil},
		{ModelName: "gpt-5.4-mini", RetailPrice: 14, RequestTime: validFrom, TokenType: "cached", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 272001, StageMaxTokens: nil},
		{ModelName: "gpt-5.4-mini", RetailPrice: 588, RequestTime: validFrom, TokenType: "output", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 272001, StageMaxTokens: nil},
	}

	req := RequestCostStageResolutionRequest{
		Model:                 "gpt-5.4-mini",
		RequestTime:           requestTime,
		InputTokenCount:       300_000, // >272k
		CachedInputTokenCount: 100_000,
		OutputTokenCount:      50_000,
		StageType:             ContextLengthStageType,
	}

	res := ResolveRequestCostStage(costRows, req)
	if res.Missing {
		t.Fatalf("expected Missing=false, got true")
	}

	if res.InputCost.UsedCost == nil || res.InputCost.UsedCost.StageMinTokens != 272001 {
		t.Fatalf("expected long stage match for input")
	}
	if res.InputCost.UsedCost.RetailPrice != 130 {
		t.Fatalf("expected long input price=130, got %d", res.InputCost.UsedCost.RetailPrice)
	}

	if res.CachedCost.UsedCost == nil || res.CachedCost.UsedCost.StageMinTokens != 272001 {
		t.Fatalf("expected long stage match for cached")
	}
	if res.CachedCost.UsedCost.RetailPrice != 14 {
		t.Fatalf("expected long cached price=14, got %d", res.CachedCost.UsedCost.RetailPrice)
	}

	if res.OutputCost.UsedCost == nil || res.OutputCost.UsedCost.StageMinTokens != 272001 {
		t.Fatalf("expected long stage match for output")
	}
	if res.OutputCost.UsedCost.RetailPrice != 588 {
		t.Fatalf("expected long output price=588, got %d", res.OutputCost.UsedCost.RetailPrice)
	}
}

func TestResolveRequestCostStage_SingleStageModelResolvesAsOpenEnded(t *testing.T) {
	validFrom := time.Date(2026, 3, 23, 0, 0, 0, 0, time.UTC)
	requestTime := time.Date(2026, 3, 23, 15, 0, 0, 0, time.UTC)

	costRows := []Costs{
		{ModelName: "gpt-4o", RetailPrice: 212, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: nil},
		{ModelName: "gpt-4o", RetailPrice: 106, RequestTime: validFrom, TokenType: "cached", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: nil},
		{ModelName: "gpt-4o", RetailPrice: 847, RequestTime: validFrom, TokenType: "output", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: nil},
	}

	req := RequestCostStageResolutionRequest{
		Model:                 "gpt-4o",
		RequestTime:           requestTime,
		InputTokenCount:       999_999,
		CachedInputTokenCount: 10_000,
		OutputTokenCount:      20_000,
		StageType:             ContextLengthStageType,
	}

	res := ResolveRequestCostStage(costRows, req)
	if res.Missing {
		t.Fatalf("expected Missing=false, got true")
	}

	if res.InputCost.UsedCost == nil || res.InputCost.UsedCost.StageMaxTokens != nil {
		t.Fatalf("expected open-ended stage match for input")
	}
	if res.InputCost.UsedCost.RetailPrice != 212 {
		t.Fatalf("expected input price=212, got %d", res.InputCost.UsedCost.RetailPrice)
	}
}

func TestResolveRequestCostStage_MissingModelOrStage(t *testing.T) {
	validFrom := time.Date(2026, 3, 23, 0, 0, 0, 0, time.UTC)
	requestTime := time.Date(2026, 3, 23, 15, 0, 0, 0, time.UTC)

	t.Run("missing model", func(t *testing.T) {
		costRows := []Costs{
			{ModelName: "some-other-model", RetailPrice: 212, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: nil},
		}

		req := RequestCostStageResolutionRequest{
			Model:                 "missing-model",
			RequestTime:           requestTime,
			InputTokenCount:       200_000,
			CachedInputTokenCount: 0,
			OutputTokenCount:      0,
			StageType:             ContextLengthStageType,
		}

		res := ResolveRequestCostStage(costRows, req)
		if !res.Missing {
			t.Fatalf("expected Missing=true for missing model")
		}
	})

	t.Run("missing stage range", func(t *testing.T) {
		max := 1000
		costRows := []Costs{
			{ModelName: "gpt-test", RetailPrice: 212, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: ptrInt(max)},
			// No open-ended stage row; inputTokens=5000 won't match.
			{ModelName: "gpt-test", RetailPrice: 106, RequestTime: validFrom, TokenType: "cached", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: ptrInt(max)},
			{ModelName: "gpt-test", RetailPrice: 847, RequestTime: validFrom, TokenType: "output", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: ptrInt(max)},
		}

		req := RequestCostStageResolutionRequest{
			Model:                 "gpt-test",
			RequestTime:           requestTime,
			InputTokenCount:       5000,
			CachedInputTokenCount: 0,
			OutputTokenCount:      0,
			StageType:             ContextLengthStageType,
		}

		res := ResolveRequestCostStage(costRows, req)
		if !res.Missing {
			t.Fatalf("expected Missing=true for missing stage range")
		}
	})
}

func TestResolveRequestCostStage_AmbiguousOverlappingStagesResolvedDeterministically(t *testing.T) {
	validFrom := time.Date(2026, 3, 23, 0, 0, 0, 0, time.UTC)
	requestTime := time.Date(2026, 3, 23, 15, 0, 0, 0, time.UTC)

	// Overlapping tiers:
	// - stage A: [0..300000] price 10
	// - stage B: [100000..500000] price 20 (more specific; should win)
	aMax := 300000
	bMax := 500000

	costRows := []Costs{
		{ModelName: "overlap-model", RetailPrice: 10, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 0, StageMaxTokens: ptrInt(aMax)},
		{ModelName: "overlap-model", RetailPrice: 20, RequestTime: validFrom, TokenType: "input", UnitOfMeasure: "1M", Currency: "EUR", StageType: ContextLengthStageType, StageMinTokens: 100000, StageMaxTokens: ptrInt(bMax)},

		// Keep cached/output at 0 tokens to focus the test.
	}

	req := RequestCostStageResolutionRequest{
		Model:                 "overlap-model",
		RequestTime:           requestTime,
		InputTokenCount:       200_000,
		CachedInputTokenCount: 0,
		OutputTokenCount:      0,
		StageType:             ContextLengthStageType,
	}

	res := ResolveRequestCostStage(costRows, req)
	if res.Missing {
		t.Fatalf("expected Missing=false, got true")
	}

	if res.InputCost.UsedCost == nil {
		t.Fatalf("expected input stage match")
	}
	if res.InputCost.UsedCost.RetailPrice != 20 {
		t.Fatalf("expected overlapping stage B price=20, got %d", res.InputCost.UsedCost.RetailPrice)
	}
}

func TestResolveRerankCostUsesSearchPricing(t *testing.T) {
	validFrom := time.Date(2026, 3, 25, 0, 0, 0, 0, time.UTC)
	res := ResolveRerankCost([]Costs{{
		ModelName:     "cohere-rerank-v3.5",
		RetailPrice:   250,
		RequestType:   RequestTypeRerank,
		BillingUnit:   BillingUnitSearches,
		UnitOfMeasure: "1K",
		Currency:      "USD",
		RequestTime:   validFrom,
	}}, RerankCostResolutionRequest{
		Model:       "cohere-rerank-v3.5",
		RequestTime: validFrom.Add(time.Hour),
		SearchUnits: 3,
	})

	if res.Missing || res.Ambiguous {
		t.Fatalf("expected an unambiguous rerank cost, got %+v", res)
	}
	if res.Cost != 0.0075 {
		t.Fatalf("expected cost 0.0075, got %v", res.Cost)
	}
	if res.Currency != "USD" || res.Unit != "1K" {
		t.Fatalf("unexpected currency or unit: %+v", res)
	}
}

func TestResolveRerankCostIgnoresTokenPricing(t *testing.T) {
	res := ResolveRerankCost([]Costs{{
		ModelName:     "cohere-rerank-v3.5",
		RetailPrice:   250,
		RequestType:   RequestTypeChatCompletion,
		BillingUnit:   BillingUnitTokens,
		TokenType:     "input",
		UnitOfMeasure: "1K",
		Currency:      "USD",
		RequestTime:   time.Now().UTC(),
	}}, RerankCostResolutionRequest{
		Model:       "cohere-rerank-v3.5",
		RequestTime: time.Now().UTC(),
		SearchUnits: 1,
	})

	if !res.Missing {
		t.Fatalf("expected token pricing to be ignored for rerank: %+v", res)
	}
}
