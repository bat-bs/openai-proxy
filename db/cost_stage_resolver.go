package database

import (
	"strings"
	"time"
)

const ContextLengthStageType = "context_length"

type TokenCostStageResolutionRequest struct {
	Model               string
	TokenType           string
	StageType           string
	RequestTime         time.Time
	InputTokensForStage int // stored request input_token_count
	TokensToBill        int // prompt/cached/output tokens to price
}

type TokenCostStageResolutionResult struct {
	Cost      float64
	Currency  string // empty when missing
	Unit      string // "1M"/"1K" (or empty if missing)
	UsedCost  *Costs
	Missing   bool
	Ambiguous bool
}

type RequestCostStageResolutionRequest struct {
	Model                 string
	RequestTime           time.Time
	InputTokenCount       int
	CachedInputTokenCount int
	OutputTokenCount      int
	StageType             string
}

type RequestCostStageResolutionResult struct {
	TotalCost float64
	Currency  string // empty when missing or currency mismatch
	Missing   bool

	InputCost  TokenCostStageResolutionResult
	CachedCost TokenCostStageResolutionResult
	OutputCost TokenCostStageResolutionResult
}

func normalizeKey(s string) string {
	return strings.TrimSpace(strings.ToLower(s))
}

func canonicalTokenTypeKey(tokenType string) string {
	t := normalizeKey(tokenType)
	switch t {
	case "input", "prompt", "input_tokens", "prompt_tokens", "inp":
		return "input"
	case "cached", "cache", "cached_input", "input_cached", "cached_input_tokens", "cached_input_token":
		return "cached"
	case "output", "completion", "output_tokens", "completion_tokens", "outp":
		return "output"
	default:
		return t
	}
}

func unitDivisor(unit string) float64 {
	if strings.TrimSpace(unit) == "1K" {
		return 1_000
	}
	// Default: treat unknown/null as "1M" to avoid exploding on partial data.
	return 1_000_000
}

func priceToCurrency(priceCents int) float64 {
	return float64(priceCents) / 100
}

func stageContains(stageMin int, stageMax *int, inputTokens int) bool {
	if inputTokens < stageMin {
		return false
	}
	if stageMax == nil {
		return true
	}
	return inputTokens <= *stageMax
}

// ResolveTokenCostStage resolves the single best cost stage row for a token type
// within the newest valid_from <= requestTime, then the stage whose range contains
// InputTokensForStage.
//
// Missing:
// - true when TokensToBill > 0 but no stage row matches.
// - false when TokensToBill <= 0 (cost is 0, stage selection is irrelevant).
// Ambiguous:
// - true when multiple stage rows match with identical stage bounds but conflicting prices/currency.
func ResolveTokenCostStage(costRows []Costs, req TokenCostStageResolutionRequest) TokenCostStageResolutionResult {
	if req.StageType == "" {
		req.StageType = ContextLengthStageType
	}
	if req.TokensToBill <= 0 {
		return TokenCostStageResolutionResult{
			Cost:      0,
			Currency:  "",
			Unit:      "",
			UsedCost:  nil,
			Missing:   false,
			Ambiguous: false,
		}
	}

	modelKey := normalizeKey(req.Model)
	tokenKey := canonicalTokenTypeKey(req.TokenType)
	stageTypeKey := normalizeKey(req.StageType)

	candidates := make([]Costs, 0, len(costRows))
	for _, c := range costRows {
		if normalizeKey(c.ModelName) != modelKey {
			continue
		}
		if canonicalTokenTypeKey(c.TokenType) != tokenKey {
			continue
		}
		if normalizeKey(c.StageType) != stageTypeKey {
			continue
		}
		if c.RequestTime.After(req.RequestTime) {
			continue
		}
		candidates = append(candidates, c)
	}

	if len(candidates) == 0 {
		return TokenCostStageResolutionResult{
			Missing:   true,
			Ambiguous: false,
		}
	}

	// 1) Select newest valid_from <= request_time
	latestValidFrom := candidates[0].RequestTime
	for _, c := range candidates[1:] {
		if c.RequestTime.After(latestValidFrom) {
			latestValidFrom = c.RequestTime
		}
	}

	candidatesAtLatest := make([]Costs, 0, len(candidates))
	for _, c := range candidates {
		if c.RequestTime.Equal(latestValidFrom) {
			candidatesAtLatest = append(candidatesAtLatest, c)
		}
	}

	// 2) Select stage whose range contains input token count
	matchingStages := make([]Costs, 0, len(candidatesAtLatest))
	for _, c := range candidatesAtLatest {
		if stageContains(c.StageMinTokens, c.StageMaxTokens, req.InputTokensForStage) {
			matchingStages = append(matchingStages, c)
		}
	}
	if len(matchingStages) == 0 {
		return TokenCostStageResolutionResult{
			Missing:   true,
			Ambiguous: false,
		}
	}

	// Deterministic tie-break:
	// - highest stage_min_tokens wins
	// - then lowest stage_max_tokens wins (treat NULL as +Inf)
	maxInt := int(^uint(0) >> 1)
	best := matchingStages[0]
	for _, c := range matchingStages[1:] {
		bestMax := maxInt
		if best.StageMaxTokens != nil {
			bestMax = *best.StageMaxTokens
		}
		cMax := maxInt
		if c.StageMaxTokens != nil {
			cMax = *c.StageMaxTokens
		}

		if c.StageMinTokens > best.StageMinTokens {
			best = c
			continue
		}
		if c.StageMinTokens == best.StageMinTokens && cMax < bestMax {
			best = c
			continue
		}
	}

	// If multiple rows have the exact same stage bounds, ensure they agree on the price.
	var (
		conflicts    = 0
		bestUnit     = strings.TrimSpace(best.UnitOfMeasure)
		bestCurrency = strings.TrimSpace(best.Currency)
	)
	for _, c := range matchingStages {
		cStageMax := c.StageMaxTokens
		sameMax := (best.StageMaxTokens == nil && cStageMax == nil) ||
			(best.StageMaxTokens != nil && cStageMax != nil && *best.StageMaxTokens == *cStageMax)
		if c.StageMinTokens == best.StageMinTokens && sameMax {
			if c.RetailPrice != best.RetailPrice ||
				strings.TrimSpace(c.UnitOfMeasure) != bestUnit ||
				strings.TrimSpace(c.Currency) != bestCurrency {
				conflicts++
			}
		}
	}
	if conflicts > 0 {
		return TokenCostStageResolutionResult{
			Missing:   true,
			Ambiguous: true,
		}
	}

	divisor := unitDivisor(best.UnitOfMeasure)
	cost := (float64(req.TokensToBill) / divisor) * priceToCurrency(best.RetailPrice)
	return TokenCostStageResolutionResult{
		Cost:      cost,
		Currency:  strings.TrimSpace(best.Currency),
		Unit:      strings.TrimSpace(best.UnitOfMeasure),
		UsedCost:  &best,
		Missing:   false,
		Ambiguous: false,
	}
}

func ResolveRequestCostStage(costRows []Costs, req RequestCostStageResolutionRequest) RequestCostStageResolutionResult {
	if req.StageType == "" {
		req.StageType = ContextLengthStageType
	}

	promptTokens := req.InputTokenCount - req.CachedInputTokenCount
	if promptTokens < 0 {
		promptTokens = 0
	}
	cachedTokens := req.CachedInputTokenCount
	if cachedTokens < 0 {
		cachedTokens = 0
	}
	outputTokens := req.OutputTokenCount
	if outputTokens < 0 {
		outputTokens = 0
	}

	inputRes := ResolveTokenCostStage(costRows, TokenCostStageResolutionRequest{
		Model:               req.Model,
		TokenType:           "input",
		StageType:           req.StageType,
		RequestTime:         req.RequestTime,
		InputTokensForStage: req.InputTokenCount,
		TokensToBill:        promptTokens,
	})
	cachedRes := ResolveTokenCostStage(costRows, TokenCostStageResolutionRequest{
		Model:               req.Model,
		TokenType:           "cached",
		StageType:           req.StageType,
		RequestTime:         req.RequestTime,
		InputTokensForStage: req.InputTokenCount,
		TokensToBill:        cachedTokens,
	})
	outputRes := ResolveTokenCostStage(costRows, TokenCostStageResolutionRequest{
		Model:               req.Model,
		TokenType:           "output",
		StageType:           req.StageType,
		RequestTime:         req.RequestTime,
		InputTokensForStage: req.InputTokenCount,
		TokensToBill:        outputTokens,
	})

	// Missing if any token type that has >0 tokens can't be resolved.
	missing := inputRes.Missing || cachedRes.Missing || outputRes.Missing
	if missing {
		return RequestCostStageResolutionResult{
			TotalCost:  0,
			Currency:   "",
			Missing:    true,
			InputCost:  inputRes,
			CachedCost: cachedRes,
			OutputCost: outputRes,
		}
	}

	// Currency selection: all resolved token parts must agree on currency.
	currencies := make([]string, 0, 3)
	if inputRes.UsedCost != nil && inputRes.Currency != "" {
		currencies = append(currencies, inputRes.Currency)
	}
	if cachedRes.UsedCost != nil && cachedRes.Currency != "" {
		currencies = append(currencies, cachedRes.Currency)
	}
	if outputRes.UsedCost != nil && outputRes.Currency != "" {
		currencies = append(currencies, outputRes.Currency)
	}

	var currency string
	if len(currencies) > 0 {
		allSame := true
		for i := 1; i < len(currencies); i++ {
			if currencies[i] != currencies[0] {
				allSame = false
				break
			}
		}
		if allSame {
			currency = currencies[0]
		}
	}

	total := inputRes.Cost + cachedRes.Cost + outputRes.Cost
	return RequestCostStageResolutionResult{
		TotalCost:  total,
		Currency:   currency,
		Missing:    false,
		InputCost:  inputRes,
		CachedCost: cachedRes,
		OutputCost: outputRes,
	}
}
