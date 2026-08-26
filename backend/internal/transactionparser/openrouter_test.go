package transactionparser

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestParseToolArguments(t *testing.T) {
	t.Run("keeps exact decimal and null fields", func(t *testing.T) {
		drafts, err := parseToolArguments(`{"transactions":[{"section":"daily","category":"Lunch","amount":500.25,"date":"2026-08-26","kind":"cash","issues":[]},{"section":null,"category":"Fuel","amount":null,"date":null,"kind":null,"issues":[{"field":"amount","code":"missing_amount"}]}]}`)
		if err != nil {
			t.Fatal(err)
		}
		if len(drafts) != 2 || drafts[0].Amount == nil || drafts[0].Amount.String() != "500.25" {
			t.Fatalf("unexpected drafts: %#v", drafts)
		}
		if drafts[1].Section != nil || drafts[1].Amount != nil || len(drafts[1].Issues) != 1 {
			t.Fatalf("partial draft lost nulls or issues: %#v", drafts[1])
		}
	})

	for _, raw := range []string{
		`{"transactions":[],"extra":true}`,
		`{"transactions":[`,
		`{"transactions":[]}{}`,
		`{"transactions":[{"section":"daily","category":"Lunch","amount":"500.25","date":"2026-08-26","kind":"cash","issues":[]}]}`,
	} {
		t.Run("rejects invalid arguments", func(t *testing.T) {
			if _, err := parseToolArguments(raw); !errors.Is(err, ErrInvalidResponse) {
				t.Fatalf("error = %v, want ErrInvalidResponse", err)
			}
		})
	}
}

func TestOpenRouterParserParse(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("Authorization = %q", got)
		}
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &received); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"id":"chat-1","object":"chat.completion","created":1,"model":"test/model",
			"choices":[{"index":0,"finish_reason":"tool_calls","message":{"role":"assistant","content":"","refusal":"","tool_calls":[{"id":"call-1","type":"function","function":{"name":"propose_transactions","arguments":"{\"transactions\":[{\"section\":\"daily\",\"category\":\"Lunch\",\"amount\":500,\"date\":\"2026-08-26\",\"kind\":\"cash\",\"issues\":[]}]}"}}]}}],
			"usage":{"prompt_tokens":20,"completion_tokens":10,"total_tokens":30}
		}`)
	}))
	defer server.Close()

	parser, err := NewOpenRouterParser(OpenRouterConfig{
		APIKey: "test-key", Model: "test/model", BaseURL: server.URL, Timeout: time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := parser.Parse(context.Background(), ParseInput{
		Text: "Spent 500 for lunch today", ReferenceDate: "2026-08-26",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Transactions) != 1 || result.Usage.TotalTokens != 30 {
		t.Fatalf("result = %#v", result)
	}
	if received["model"] != "test/model" {
		t.Fatalf("model = %#v", received["model"])
	}
	if received["max_tokens"] != float64(maxCompletionTokens) {
		t.Fatalf("max_tokens = %#v", received["max_tokens"])
	}
	if _, ok := received["parallel_tool_calls"]; ok {
		t.Fatalf("unsupported parallel_tool_calls was sent: %#v", received["parallel_tool_calls"])
	}
	tools, ok := received["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("tools = %#v", received["tools"])
	}
	tool, _ := tools[0].(map[string]any)
	function, _ := tool["function"].(map[string]any)
	if _, ok := function["strict"]; ok {
		t.Fatalf("strict tool enforcement should be omitted for OpenRouter compatibility: %#v", function)
	}
	provider, ok := received["provider"].(map[string]any)
	if !ok || provider["require_parameters"] != true {
		t.Fatalf("provider settings = %#v", received["provider"])
	}
	if provider["data_collection"] != "deny" || provider["zdr"] != false {
		t.Fatalf("privacy settings = %#v", provider)
	}
	messages, _ := received["messages"].([]any)
	encoded, _ := json.Marshal(messages)
	if strings.Contains(string(encoded), "saved category") {
		t.Fatalf("request unexpectedly contains personal history: %s", encoded)
	}
}

func TestOpenRouterParserErrors(t *testing.T) {
	t.Run("rate limit", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("x-should-retry", "false")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = io.WriteString(w, `{"error":{"message":"slow down","type":"rate_limit","code":"429"}}`)
		}))
		defer server.Close()
		parser, _ := NewOpenRouterParser(OpenRouterConfig{
			APIKey: "key", Model: "model", BaseURL: server.URL, Timeout: time.Second,
		})
		_, err := parser.Parse(context.Background(), ParseInput{Text: "Lunch 10", ReferenceDate: "2026-08-26"})
		if !errors.Is(err, ErrRateLimited) {
			t.Fatalf("error = %v, want ErrRateLimited", err)
		}
	})

	t.Run("timeout", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			time.Sleep(100 * time.Millisecond)
			_, _ = io.WriteString(w, `{}`)
		}))
		defer server.Close()
		parser, _ := NewOpenRouterParser(OpenRouterConfig{
			APIKey: "key", Model: "model", BaseURL: server.URL, Timeout: 10 * time.Millisecond,
		})
		_, err := parser.Parse(context.Background(), ParseInput{Text: "Lunch 10", ReferenceDate: "2026-08-26"})
		if !errors.Is(err, ErrTimeout) {
			t.Fatalf("error = %v, want ErrTimeout", err)
		}
	})

	for _, tc := range []struct {
		name   string
		status int
	}{
		{name: "authentication", status: http.StatusUnauthorized},
		{name: "provider unavailable", status: http.StatusInternalServerError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("x-should-retry", "false")
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, `{"error":{"message":"private upstream detail","type":"provider_error","code":"failed"}}`)
			}))
			defer server.Close()
			parser, _ := NewOpenRouterParser(OpenRouterConfig{
				APIKey: "key", Model: "model", BaseURL: server.URL, Timeout: time.Second,
			})
			_, err := parser.Parse(context.Background(), ParseInput{Text: "Lunch 10", ReferenceDate: "2026-08-26"})
			if !errors.Is(err, ErrUnavailable) {
				t.Fatalf("error = %v, want ErrUnavailable", err)
			}
			if strings.Contains(err.Error(), "private upstream detail") {
				t.Fatal("provider details leaked")
			}
		})
	}
}

func TestOpenRouterParserRejectsIncompleteCompletions(t *testing.T) {
	validCall := `{"id":"call-1","type":"function","function":{"name":"propose_transactions","arguments":"{\"transactions\":[{\"section\":\"daily\",\"category\":\"Lunch\",\"amount\":10,\"date\":\"2026-08-26\",\"kind\":\"cash\",\"issues\":[]}]}"}}`
	tests := []struct {
		name      string
		finish    string
		refusal   string
		toolCalls string
		want      error
	}{
		{name: "wrong finish reason", finish: "length", toolCalls: `[` + validCall + `]`, want: ErrInvalidResponse},
		{name: "missing tool", finish: "tool_calls", toolCalls: `[]`, want: ErrInvalidResponse},
		{name: "wrong tool", finish: "tool_calls", toolCalls: `[{"id":"call-1","type":"function","function":{"name":"other_tool","arguments":"{}"}}]`, want: ErrInvalidResponse},
		{name: "refusal", finish: "stop", refusal: "cannot comply", toolCalls: `[]`, want: ErrNoTransactions},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"id":"chat-1","object":"chat.completion","created":1,"model":"test/model","choices":[{"index":0,"finish_reason":"`+
					tc.finish+`","message":{"role":"assistant","content":"","refusal":"`+tc.refusal+`","tool_calls":`+tc.toolCalls+`}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`)
			}))
			defer server.Close()
			parser, _ := NewOpenRouterParser(OpenRouterConfig{
				APIKey: "key", Model: "model", BaseURL: server.URL, Timeout: time.Second,
			})
			_, err := parser.Parse(context.Background(), ParseInput{Text: "Lunch 10", ReferenceDate: "2026-08-26"})
			if !errors.Is(err, tc.want) {
				t.Fatalf("error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestOpenRouterParserRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, strings.Repeat("x", maxProviderResponseBytes+100))
	}))
	defer server.Close()
	parser, _ := NewOpenRouterParser(OpenRouterConfig{
		APIKey: "key", Model: "model", BaseURL: server.URL, Timeout: time.Second,
	})
	_, err := parser.Parse(context.Background(), ParseInput{Text: "Lunch 10", ReferenceDate: "2026-08-26"})
	if !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("error = %v, want ErrInvalidResponse", err)
	}
}

func TestNewOpenRouterParserRequiresConfiguration(t *testing.T) {
	if _, err := NewOpenRouterParser(OpenRouterConfig{Model: "model"}); err == nil {
		t.Fatal("missing key should fail")
	}
	if _, err := NewOpenRouterParser(OpenRouterConfig{APIKey: "key"}); err == nil {
		t.Fatal("missing model should fail")
	}
}

func TestCategoryMeansTransactionName(t *testing.T) {
	if !strings.Contains(parserInstructions, "category is the transaction name") ||
		!strings.Contains(parserInstructions, `For "ChatGPT subscription"`) {
		t.Fatal("parser instructions must define category as the specific transaction name")
	}

	schema := transactionToolSchema()
	properties := schema["properties"].(map[string]any)
	transactions := properties["transactions"].(map[string]any)
	items := transactions["items"].(map[string]any)
	itemProperties := items["properties"].(map[string]any)
	category := itemProperties["category"].(map[string]any)
	description, _ := category["description"].(string)
	if !strings.Contains(description, "Specific transaction name") {
		t.Fatalf("category schema description = %q", description)
	}
}

func TestSafeLogValue(t *testing.T) {
	if got := safeLogValue("bad\nvalue\tfrom provider", 100); got != "bad value from provider" {
		t.Fatalf("sanitized value = %q", got)
	}
	if got := safeLogValue("123456", 3); got != "123…" {
		t.Fatalf("truncated value = %q", got)
	}
}

func TestOpenRouterSmoke(t *testing.T) {
	if os.Getenv("PENNYWISE_OPENROUTER_SMOKE") != "1" {
		t.Skip("set PENNYWISE_OPENROUTER_SMOKE=1 to call real OpenRouter")
	}
	parser, err := NewOpenRouterParser(OpenRouterConfig{
		APIKey:  os.Getenv("OPENROUTER_API_KEY"),
		Model:   os.Getenv("OPENROUTER_MODEL"),
		BaseURL: os.Getenv("OPENROUTER_BASE_URL"),
		Timeout: 30 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	result, err := parser.Parse(context.Background(), ParseInput{
		Text:          "I paid around ₹2,500 for my ChatGPT subscription the day before yesterday",
		ReferenceDate: "2026-08-26",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Transactions) != 1 {
		t.Fatalf("draft count = %d, want 1", len(result.Transactions))
	}
	if result.Transactions[0].Category == nil || !strings.Contains(strings.ToLower(*result.Transactions[0].Category), "chatgpt") {
		t.Fatalf("category = %#v, want specific ChatGPT transaction name", result.Transactions[0].Category)
	}
	t.Logf("model=%s duration=%s prompt_tokens=%d completion_tokens=%d total_tokens=%d outcome=success",
		result.Usage.Model, time.Since(started), result.Usage.PromptTokens, result.Usage.CompletionTokens, result.Usage.TotalTokens)
}
