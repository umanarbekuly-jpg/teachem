package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"teachem/api-go/internal/core"
)

type S3 struct {
	internal, public *minio.Client
	bucket           string
}

func New(c core.Config) (*S3, error) {
	makeClient := func(endpoint string) (*minio.Client, error) {
		u, e := url.Parse(endpoint)
		if e != nil {
			return nil, e
		}
		if u.Scheme != "http" && u.Scheme != "https" {
			return nil, errors.New("invalid storage URL")
		}
		return minio.New(u.Host, &minio.Options{Creds: credentials.NewStaticV4(c.StorageAccessKey, c.StorageSecretKey, ""), Secure: u.Scheme == "https", Region: c.StorageRegion, BucketLookup: minio.BucketLookupPath})
	}
	in, e := makeClient(c.StorageEndpoint)
	if e != nil {
		return nil, e
	}
	pub, e := makeClient(c.StoragePublicEndpoint)
	if e != nil {
		return nil, e
	}
	return &S3{in, pub, c.StorageBucket}, nil
}
func (s *S3) Upload(ctx context.Context, key, mime string, size int) (core.Row, error) {
	p := minio.NewPostPolicy()
	for _, err := range []error{p.SetBucket(s.bucket), p.SetKey(key), p.SetContentType(mime), p.SetContentLengthRange(int64(size), int64(size)), p.SetExpires(time.Now().Add(5 * time.Minute))} {
		if err != nil {
			return nil, err
		}
	}
	u, fields, err := s.public.PresignedPostPolicy(ctx, p)
	if err != nil {
		return nil, err
	}
	return core.Row{"url": u.String(), "fields": fields}, nil
}
func (s *S3) Inspect(ctx context.Context, key string) (int64, string, error) {
	obj, err := s.internal.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	return obj.Size, obj.ContentType, err
}
func (s *S3) Read(ctx context.Context, key string, max int64) ([]byte, error) {
	obj, err := s.internal.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer obj.Close()
	data, err := io.ReadAll(io.LimitReader(obj, max+1))
	if int64(len(data)) > max {
		return nil, core.Error(400, "Файл слишком большой")
	}
	return data, err
}
func (s *S3) Put(ctx context.Context, key string, body []byte, mime string) error {
	_, err := s.internal.PutObject(ctx, s.bucket, key, bytes.NewReader(body), int64(len(body)), minio.PutObjectOptions{ContentType: mime})
	return err
}
func (s *S3) Download(ctx context.Context, key, name string) (string, error) {
	q := url.Values{}
	q.Set("response-content-disposition", "attachment; filename*=UTF-8''"+strings.ReplaceAll(url.QueryEscape(name), "+", "%20"))
	u, err := s.public.PresignedGetObject(ctx, s.bucket, key, time.Minute, q)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}
func (s *S3) Delete(ctx context.Context, key string) error {
	return s.internal.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}
func (s *S3) Healthy(ctx context.Context) error {
	ok, err := s.internal.BucketExists(ctx, s.bucket)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("storage bucket missing")
	}
	return nil
}
