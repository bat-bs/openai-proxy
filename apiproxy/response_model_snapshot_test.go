package apiproxy

import "testing"

func TestSplitModelSnapshot(t *testing.T) {
	tests := []struct {
		name          string
		model         string
		wantModel     string
		wantSnapshot  string
	}{
		{
			name:         "model with snapshot suffix",
			model:        "gpt-5-mini-2025-08-07",
			wantModel:    "gpt-5-mini",
			wantSnapshot: "2025-08-07",
		},
		{
			name:         "model without snapshot suffix",
			model:        "gpt-5-mini",
			wantModel:    "gpt-5-mini",
			wantSnapshot: "",
		},
		{
			name:         "empty model",
			model:        "",
			wantModel:    "",
			wantSnapshot: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotModel, gotSnapshot := splitModelSnapshot(tt.model)
			if gotModel != tt.wantModel || gotSnapshot != tt.wantSnapshot {
				t.Fatalf("splitModelSnapshot(%q) = (%q, %q), want (%q, %q)", tt.model, gotModel, gotSnapshot, tt.wantModel, tt.wantSnapshot)
			}
		})
	}
}
