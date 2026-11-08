package smspipeline

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/shared"
)

const maxSMSResponseBytes = 64 << 10

type OpenRouterConfig struct {
	APIKey     string
	Model      string
	BaseURL    string
	Timeout    time.Duration
	SiteURL    string
	AppName    string
	HTTPClient *http.Client
}

type openRouterClient struct {
	client  openai.Client
	model   string
	timeout time.Duration
}

func newOpenRouterClient(cfg OpenRouterConfig) (*openRouterClient, error) {
	if strings.TrimSpace(cfg.APIKey) == "" || strings.TrimSpace(cfg.Model) == "" {
		return nil, errors.New("SMS OpenRouter key and model are required")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 15 * time.Second
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://openrouter.ai/api/v1"
	}
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	clone := *httpClient
	clone.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	base := clone.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	clone.Transport = smsResponseLimit{base}
	opts := []option.RequestOption{option.WithAPIKey(cfg.APIKey), option.WithBaseURL(strings.TrimRight(cfg.BaseURL, "/")),
		option.WithHTTPClient(&clone), option.WithMaxRetries(0)} // The durable worker alone owns retries.
	if cfg.SiteURL != "" {
		opts = append(opts, option.WithHeader("HTTP-Referer", cfg.SiteURL))
	}
	if cfg.AppName != "" {
		opts = append(opts, option.WithHeader("X-OpenRouter-Title", cfg.AppName))
	}
	return &openRouterClient{client: openai.NewClient(opts...), model: cfg.Model, timeout: cfg.Timeout}, nil
}

// Both adapters share transport machinery, but neither calls or depends on the
// other adapter. A future non-OpenRouter implementation only implements its interface.
type OpenRouterVerifier struct{ provider *openRouterClient }
type OpenRouterExtractor struct{ provider *openRouterClient }

func NewOpenRouterVerifier(cfg OpenRouterConfig) (*OpenRouterVerifier, error) {
	provider, err := newOpenRouterClient(cfg)
	if err != nil {
		return nil, err
	}
	return &OpenRouterVerifier{provider}, nil
}
func NewOpenRouterExtractor(cfg OpenRouterConfig) (*OpenRouterExtractor, error) {
	provider, err := newOpenRouterClient(cfg)
	if err != nil {
		return nil, err
	}
	return &OpenRouterExtractor{provider}, nil
}
func (v *OpenRouterVerifier) Verify(ctx context.Context, m Message) (VerificationResult, error) {
	var out Verification
	usage, err := v.provider.complete(ctx, "assess_sms_transaction", verifierPrompt, verificationSchema(), m, &out)
	usage.PromptVersion = "sms-verify-v1"
	if err != nil {
		return VerificationResult{}, err
	}
	switch out.Reason {
	case "complete", "not_transaction", "missing_date", "ambiguous_date", "missing_amount", "missing_counterparty", "missing_direction", "missing_event_type", "non_completed":
	default:
		return VerificationResult{}, ErrInvalidResponse
	}
	return VerificationResult{Decision: out, Usage: usage}, nil
}
func (e *OpenRouterExtractor) Extract(ctx context.Context, input ExtractionInput) (ExtractionResult, error) {
	var out Proposal
	usage, err := e.provider.complete(ctx, "extract_sms_transaction", extractorPrompt, extractionSchema(), input, &out)
	usage.PromptVersion = "sms-extract-v1"
	return ExtractionResult{Proposal: out, Usage: usage}, err
}

func (p *openRouterClient) complete(ctx context.Context, name, instructions string, schema shared.FunctionParameters, input any, output any) (Usage, error) {
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	payload, err := json.Marshal(input)
	if err != nil {
		return Usage{}, ErrInvalidResponse
	}
	completion, err := p.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: openai.ChatModel(p.model), Messages: []openai.ChatCompletionMessageParamUnion{
			openai.DeveloperMessage(instructions), openai.UserMessage(string(payload)),
		}, Tools: []openai.ChatCompletionToolUnionParam{openai.ChatCompletionFunctionTool(shared.FunctionDefinitionParam{
			Name: name, Description: openai.String("Return data only; this output function cannot execute actions."), Parameters: schema,
		})}, ToolChoice: openai.ToolChoiceOptionFunctionToolChoice(openai.ChatCompletionNamedToolChoiceFunctionParam{Name: name}),
		MaxTokens: openai.Int(1536),
	}, option.WithJSONSet("provider.require_parameters", true), option.WithJSONSet("provider.data_collection", "deny"), option.WithJSONSet("provider.zdr", false))
	if err != nil {
		if errors.Is(err, ErrInvalidResponse) {
			return Usage{}, ErrInvalidResponse
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return Usage{}, ErrTimeout
		}
		var apiErr *openai.Error
		if errors.As(err, &apiErr) && apiErr.StatusCode == 429 {
			return Usage{}, ErrRateLimited
		}
		// Never log or propagate provider error text; it may echo SMS or credentials.
		return Usage{}, ErrUnavailable
	}
	if len(completion.Choices) != 1 {
		return Usage{}, ErrInvalidResponse
	}
	choice := completion.Choices[0]
	if choice.FinishReason != "tool_calls" || choice.Message.Refusal != "" || len(choice.Message.ToolCalls) != 1 {
		return Usage{}, ErrInvalidResponse
	}
	call := choice.Message.ToolCalls[0].AsFunction()
	if call.Function.Name != name || len(call.Function.Arguments) > maxSMSResponseBytes {
		return Usage{}, ErrInvalidResponse
	}
	raw := []byte(call.Function.Arguments)
	// Required keys are checked locally too; provider schema enforcement is not trusted.
	var keys map[string]json.RawMessage
	if json.Unmarshal(raw, &keys) != nil {
		return Usage{}, ErrInvalidResponse
	}
	for _, field := range schema["required"].([]string) {
		if _, ok := keys[field]; !ok {
			return Usage{}, ErrInvalidResponse
		}
	}
	if !validOutputTypes(keys, schema) {
		return Usage{}, ErrInvalidResponse
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(output) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return Usage{}, ErrInvalidResponse
	}
	return Usage{Provider: "openrouter", Model: completion.Model, PromptTokens: completion.Usage.PromptTokens, CompletionTokens: completion.Usage.CompletionTokens}, nil
}

type smsResponseLimit struct{ base http.RoundTripper }

func (t smsResponseLimit) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(request)
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxSMSResponseBytes+1))
	_ = response.Body.Close()
	if err != nil {
		return nil, err
	}
	if len(raw) > maxSMSResponseBytes {
		return nil, ErrInvalidResponse
	}
	response.Body = io.NopCloser(bytes.NewReader(raw))
	return response, nil
}
