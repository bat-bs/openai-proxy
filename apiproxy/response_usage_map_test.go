package apiproxy

import (
	"testing"
)

func TestExtractTokenCounts_VariousKeys(t *testing.T) {
	tests := []struct {
		name                string
		m                   map[string]int
		wantP, wantC, wantT int
		wantCached          int
	}{
		{"prompt_completion", map[string]int{"prompt_tokens": 5, "completion_tokens": 7}, 5, 7, 12, 0},
		{"input_output", map[string]int{"input_tokens": 3, "output_tokens": 4}, 3, 4, 7, 0},
		{"total_and_prompt", map[string]int{"total_tokens": 10, "prompt_tokens": 4}, 4, 6, 10, 0},
		{"total_and_output", map[string]int{"total_tokens": 20, "output_tokens": 8}, 12, 8, 20, 0},
	}
	for _, tt := range tests {
		p, c, total, cached := extractTokenCounts(tt.m, nil)
		if p != tt.wantP || c != tt.wantC || (total != 0 && total != tt.wantT) || cached != tt.wantCached {
			t.Fatalf("%s: got p=%d c=%d total=%d cached=%d want p=%d c=%d total=%d cached=%d", tt.name, p, c, total, cached, tt.wantP, tt.wantC, tt.wantT, tt.wantCached)
		}
	}
}
