# Stage 1: Build frontend
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend binary with embedded frontend assets
FROM golang:alpine AS builder
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /app/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=linux go build -tags prod -o /bin/server ./cmd/server && \
    CGO_ENABLED=0 GOOS=linux go build -o /bin/healthcheck ./cmd/healthcheck

# Stage 3: Minimal runtime image
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /bin/server /bin/server
COPY --from=builder /bin/healthcheck /bin/healthcheck
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/bin/healthcheck"]
CMD ["/bin/server"]
