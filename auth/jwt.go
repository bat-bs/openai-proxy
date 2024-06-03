package auth

type JWT struct {
}

func ValidateJWTToken(c *Claims) bool {
	return true
}
