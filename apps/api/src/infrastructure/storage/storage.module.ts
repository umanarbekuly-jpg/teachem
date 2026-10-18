import { Global, Inject, Injectable, Module } from "@nestjs/common";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV, Environment } from "../../config/env";
export abstract class StorageProvider {
  abstract upload(
    key: string,
    mime: string,
    size: number,
  ): Promise<{ url: string; fields: Record<string, string> }>;
  abstract inspect(key: string): Promise<{ size: number; mime: string }>;
  abstract read(key: string): Promise<Uint8Array>;
  abstract put(key: string, body: Uint8Array, mime: string): Promise<void>;
  abstract download(key: string, filename: string): Promise<string>;
  abstract delete(key: string): Promise<void>;
  abstract healthy(): Promise<void>;
}
@Injectable()
export class S3StorageProvider extends StorageProvider {
  private client: S3Client;
  private publicClient: S3Client;
  constructor(@Inject(ENV) private env: Environment) {
    super();
    const options = {
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    };
    this.client = new S3Client({ ...options, endpoint: env.S3_ENDPOINT });
    this.publicClient = new S3Client({
      ...options,
      endpoint: env.S3_PUBLIC_ENDPOINT,
    });
  }
  upload(key: string, mime: string, size: number) {
    return createPresignedPost(this.publicClient, {
      Bucket: this.env.S3_BUCKET,
      Key: key,
      Expires: 300,
      Fields: { "Content-Type": mime },
      Conditions: [
        ["content-length-range", size, size],
        ["eq", "$Content-Type", mime],
      ],
    });
  }
  async inspect(key: string) {
    const h = await this.client.send(
      new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
    );
    return { size: h.ContentLength ?? 0, mime: h.ContentType ?? "" };
  }
  async read(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
    );
    return (await result.Body?.transformToByteArray()) ?? new Uint8Array();
  }
  async put(key: string, body: Uint8Array, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: mime,
      }),
    );
  }
  download(key: string, filename: string) {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      }),
      { expiresIn: 60 },
    );
  }
  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
    );
  }
  async healthy() {
    await this.client.send(
      new HeadBucketCommand({ Bucket: this.env.S3_BUCKET }),
    );
  }
}
@Global()
@Module({
  providers: [{ provide: StorageProvider, useClass: S3StorageProvider }],
  exports: [StorageProvider],
})
export class StorageModule {}
