package apiproxy

import (
	"testing"

	db "openai-api-proxy/db"

	"golang.org/x/crypto/bcrypt"
)

func mustHash(t *testing.T, plain string) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("failed to hash token: %v", err)
	}
	return string(hash)
}

func TestCompareToken_IgnoresDeactivatedKeys(t *testing.T) {
	activeToken := "active-secret"
	deactivatedToken := "deactivated-secret"

	keys := []db.ApiKey{
		{
			UUID:        "dead-key",
			ApiKey:      mustHash(t, deactivatedToken),
			Deactivated: true,
		},
		{
			UUID:        "active-key",
			ApiKey:      mustHash(t, activeToken),
			Deactivated: false,
		},
	}

	if got, err := CompareToken(keys, activeToken); err != nil || got != "active-key" {
		t.Fatalf("expected active key to validate, got uuid=%q err=%v", got, err)
	}

	if got, err := CompareToken(keys, deactivatedToken); err == nil {
		t.Fatalf("expected deactivated key to be rejected, got uuid=%q", got)
	}
}

func TestCompareToken_AllDeactivatedRejected(t *testing.T) {
	keys := []db.ApiKey{
		{
			UUID:        "dead-1",
			ApiKey:      mustHash(t, "dead-secret"),
			Deactivated: true,
		},
	}

	if got, err := CompareToken(keys, "dead-secret"); err == nil {
		t.Fatalf("expected deactivated key to be rejected, got uuid=%q", got)
	}
}
