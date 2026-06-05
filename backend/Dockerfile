# Multi-stage build: compile with the full Go toolchain, then ship only the
# resulting binary in a tiny final image. This keeps the deployed image small
# and free of build tools (smaller = faster deploys, less attack surface).

# ---- Stage 1: build ----
FROM golang:1.25-alpine AS build
WORKDIR /src

# Copy go.mod/go.sum first and download deps. Docker caches this layer, so deps
# are only re-downloaded when those files change — not on every code edit.
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source and build a static binary.
COPY . .
# CGO disabled => a fully static binary that runs on the minimal final image.
# The migrations are embedded via go:embed, so the binary is self-contained.
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api

# ---- Stage 2: runtime ----
# Distroless-style minimal base. alpine gives us a shell + CA certs (needed for
# TLS to Neon/Upstash) while staying tiny.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/api /app/api

# Render sets $PORT; our app already reads it. Document the default.
EXPOSE 8090
ENTRYPOINT ["/app/api"]
