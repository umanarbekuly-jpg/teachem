package storage

import (
	"bytes"
	"context"
	"github.com/minio/minio-go/v7"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"teachem/api-go/internal/core"
	"testing"
)

func TestRealS3PoliciesAndSignedReads(t *testing.T) {
	endpoint := os.Getenv("TEACHEM_TEST_S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("isolated S3 test configuration required")
	}
	if !strings.Contains(endpoint, "localhost:") {
		t.Fatal("local test storage required")
	}
	bucket := "teachem-go-test-" + core.NewID()
	cfg := core.Config{StorageEndpoint: endpoint, StoragePublicEndpoint: endpoint, StorageBucket: bucket, StorageRegion: "us-east-1", StorageAccessKey: os.Getenv("TEACHEM_TEST_S3_ACCESS_KEY"), StorageSecretKey: os.Getenv("TEACHEM_TEST_S3_SECRET_KEY")}
	s, e := New(cfg)
	if e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	if e = s.internal.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); e != nil {
		t.Fatal(e)
	}
	defer func() {
		for _, key := range []string{"pending/probe.pdf", "ready/probe.pdf"} {
			_ = s.Delete(ctx, key)
		}
		if err := s.internal.RemoveBucket(ctx, bucket); err != nil {
			t.Error(err)
		}
	}()
	data := []byte("%PDF-1.4\nS3 integration fixture\n%%EOF")
	post, e := s.Upload(ctx, "pending/probe.pdf", "application/pdf", len(data))
	if e != nil {
		t.Fatal(e)
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for key, value := range post["fields"].(map[string]string) {
		if e = form.WriteField(key, value); e != nil {
			t.Fatal(e)
		}
	}
	f, e := form.CreateFormFile("file", "probe.pdf")
	if e != nil {
		t.Fatal(e)
	}
	_, _ = f.Write(data)
	_ = form.Close()
	r, e := http.Post(core.Str(post, "url"), form.FormDataContentType(), &body)
	if e != nil {
		t.Fatal(e)
	}
	_ = r.Body.Close()
	if r.StatusCode != 204 && r.StatusCode != 201 {
		t.Fatalf("presigned upload status %d", r.StatusCode)
	}
	size, mime, e := s.Inspect(ctx, "pending/probe.pdf")
	if e != nil || size != int64(len(data)) || mime != "application/pdf" {
		t.Fatal("metadata mismatch", e)
	}
	got, e := s.Read(ctx, "pending/probe.pdf", 1024)
	if e != nil || !bytes.Equal(got, data) {
		t.Fatal("read mismatch", e)
	}
	if _, e = s.Read(ctx, "pending/probe.pdf", 2); e == nil {
		t.Fatal("missing read bound")
	}
	if e = s.Put(ctx, "ready/probe.pdf", data, "application/pdf"); e != nil {
		t.Fatal(e)
	}
	signed, e := s.Download(ctx, "ready/probe.pdf", "Проверка.pdf")
	if e != nil {
		t.Fatal(e)
	}
	r, e = http.Get(signed)
	if e != nil {
		t.Fatal(e)
	}
	got, _ = io.ReadAll(r.Body)
	_ = r.Body.Close()
	if r.StatusCode != 200 || !bytes.Equal(got, data) {
		t.Fatal("signed download failed")
	}
	if e = s.Healthy(ctx); e != nil {
		t.Fatal(e)
	}
}
