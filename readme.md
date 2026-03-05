# openai-proxy

## Features
- OpenAI-compatible API proxy for forwarding requests.
- Web UI to create and manage API keys (including deactivation).
- Per-key usage tracking with filtering and sorting in the UI.
- Admin usage dashboard with range filters (24h, 7d, 30d, all).
- Admin cost dashboard.
- Release notes page linked from the sidebar.

## Build
```bash
git clone git@github.com:bat-bs/openai-proxy.git
cd openai-proxy
go build cmd/main.go 
```

## Run
1. Create your own .env file with the .env.example
You can use the following Link as a reference for filling the Values: https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#rest-api-versioning

2. `./main`

3. Generate Key in [Web ui](http://localhost:8082)

4. Use it:
```bash
payload="{\"messages\":[{\"role\":\"system\",\"content\":[{\"type\":\"text\",\"text\":\"You are an AI assistant that helps people find information.\"}]}],\"temperature\":0.7,\"top_p\":0.95,\"max_tokens\":800,\"model\":\"gpt-4o\"}"

curl "http://localhost:8082/api/chat/completions" \
  -H "Content-Type: application/json"  \
  -H "Authorization: Bearer <Key-From-Web-UI>" \
  -d "$payload"
```





## Todo
For Open Tasks i use the Github Issues.
