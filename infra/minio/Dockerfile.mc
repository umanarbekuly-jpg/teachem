FROM golang:1.24.8-bookworm AS build
RUN CGO_ENABLED=0 go install github.com/minio/mc@RELEASE.2025-08-13T08-35-41Z
FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /go/bin/mc /usr/local/bin/mc
LABEL org.opencontainers.image.source="https://github.com/minio/mc" org.opencontainers.image.licenses="AGPL-3.0"
ENTRYPOINT ["mc"]
