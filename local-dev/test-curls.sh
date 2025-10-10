#!/usr/bin/env bash
curl -v http://localhost:8082/api/v1/chat/completions \
-H "Authorization: Bearer $LOCAL_OPENAI_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model":"gpt-5-mini",
"messages":[{"role":"user","content":[{"type":"text","text":"Write a short haiku about turtles."}]}],
"temperature":0.7,
"max_tokens":100
}' | jq .
curl -v http://localhost:8082/api/v1/responses \
-H "Authorization: Bearer $LOCAL_OPENAI_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model":"gpt-5-mini",
"input":"Write a short haiku about turtles.",
"temperature":0.7,
"max_output_tokens":100
}' | jq .
