FROM golang:1.24.8-bookworm AS build
RUN CGO_ENABLED=0 go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z
FROM alpine:3.22
RUN apk add --no-cache ca-certificates && mkdir /data && chown 10001:10001 /data
COPY --from=build /go/bin/minio /usr/local/bin/minio
LABEL org.opencontainers.image.source="https://github.com/minio/minio" org.opencontainers.image.licenses="AGPL-3.0"
USER 10001:10001
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
