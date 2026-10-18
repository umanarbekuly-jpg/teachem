import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsIn, IsInt, IsString, Length, Max, Min } from "class-validator";
import { randomUUID } from "crypto";
import { extname } from "path";
import { unzipSync } from "fflate";
import { Actor, CurrentUser } from "../../common/http";
import { Database } from "../../infrastructure/database/database.module";
import { StorageProvider } from "../../infrastructure/storage/storage.module";
import {
  EnrollmentsModule,
  EnrollmentsService,
} from "../enrollments/enrollments.module";
const MAX = 20 * 1024 * 1024;
const types: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
export class UploadDto {
  @ApiProperty({ enum: ["avatar", "material", "receipt"] })
  @IsIn(["avatar", "material", "receipt"])
  purpose!: "avatar" | "material" | "receipt";
  @ApiProperty() @IsString() @Length(1, 200) originalName!: string;
  @ApiProperty() @IsString() @Length(1, 150) mimeType!: string;
  @ApiProperty({ maximum: MAX }) @IsInt() @Min(1) @Max(MAX) sizeBytes!: number;
}
export function validSignature(bytes: Uint8Array, extension: string): boolean {
  const b = Buffer.from(bytes);
  if (extension === ".pdf") return b.subarray(0, 5).toString() === "%PDF-";
  if (extension === ".png")
    return b
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === ".jpg" || extension === ".jpeg")
    return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (extension === ".webp")
    return (
      b.subarray(0, 4).toString() === "RIFF" &&
      b.subarray(8, 12).toString() === "WEBP"
    );
  if (extension === ".docx" || extension === ".pptx") {
    try {
      const names: string[] = [];
      let expanded = 0;
      unzipSync(bytes, {
        filter: (file) => {
          expanded += file.originalSize;
          if (expanded > 100 * 1024 * 1024)
            throw new Error("Archive too large");
          names.push(file.name);
          return false;
        },
      });
      return (
        names.includes("[Content_Types].xml") &&
        names.includes(
          extension === ".docx" ? "word/document.xml" : "ppt/presentation.xml",
        ) &&
        !names.some((n) => n.toLowerCase().endsWith("vbaproject.bin"))
      );
    } catch {
      return false;
    }
  }
  return false;
}
@Injectable()
export class FilesRepository {
  constructor(private db: Database) {}
  create(ownerId: string, dto: UploadDto, objectKey: string) {
    return this.db.fileAsset.create({
      data: {
        ...dto,
        ownerId,
        objectKey,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  }
  get(id: string) {
    return this.db.fileAsset.findUniqueOrThrow({ where: { id } });
  }
  ready(id: string, objectKey: string) {
    return this.db.fileAsset.update({
      where: { id },
      data: { status: "ready", objectKey, expiresAt: null },
    });
  }
  reject(id: string) {
    return this.db.fileAsset.update({
      where: { id },
      data: { status: "rejected" },
    });
  }
  // Relations are used only to locate the resource; authorization is delegated to its domain service.
  bindings(id: string) {
    return this.db.fileAsset.findUniqueOrThrow({
      where: { id },
      select: {
        materials: { where: { deletedAt: null }, select: { courseId: true } },
        photoFor: { select: { userId: true } },
      },
    });
  }
}
@Injectable()
export class FilesService {
  constructor(
    private repo: FilesRepository,
    private storage: StorageProvider,
    private enrollments: EnrollmentsService,
  ) {}
  async upload(a: Actor, dto: UploadDto) {
    const ext = extname(dto.originalName).toLowerCase();
    if (
      types[ext] !== dto.mimeType ||
      (dto.purpose === "avatar" && !dto.mimeType.startsWith("image/")) ||
      (dto.purpose === "receipt" &&
        ![".pdf", ".png", ".jpg", ".jpeg", ".webp"].includes(ext))
    )
      throw new BadRequestException("Недопустимый формат файла");
    if (dto.purpose !== "receipt" && a.role !== "tutor")
      throw new ForbiddenException("Загрузка доступна тьютору");
    const file = await this.repo.create(
      a.id,
      dto,
      `pending/${randomUUID()}${ext}`,
    );
    return {
      id: file.id,
      ...(await this.storage.upload(
        file.objectKey,
        file.mimeType,
        file.sizeBytes,
      )),
    };
  }
  async complete(id: string, a: Actor) {
    const f = await this.repo.get(id);
    if (f.ownerId !== a.id) throw new ForbiddenException();
    if (f.status === "ready") return { id: f.id, status: f.status };
    if (f.status !== "pending" || !f.expiresAt || f.expiresAt <= new Date())
      throw new BadRequestException("Загрузка истекла");
    const h = await this.storage.inspect(f.objectKey);
    if (h.size !== f.sizeBytes || h.size > MAX || h.mime !== f.mimeType) {
      await this.repo.reject(id);
      throw new BadRequestException("Размер или тип файла не совпадает");
    }
    const body = await this.storage.read(f.objectKey);
    if (
      body.length !== f.sizeBytes ||
      !validSignature(body, extname(f.originalName).toLowerCase())
    ) {
      await this.repo.reject(id);
      throw new BadRequestException(
        "Содержимое файла не соответствует формату",
      );
    }
    // Write validated bytes under a new key: an unexpired upload URL cannot overwrite a ready object.
    const key = `ready/${randomUUID()}${extname(f.originalName).toLowerCase()}`;
    await this.storage.put(key, body, f.mimeType);
    await this.repo.ready(id, key);
    await this.storage.delete(f.objectKey);
    return { id, status: "ready" };
  }
  async assertOwned(
    id: string,
    ownerId: string,
    purpose: "avatar" | "material" | "receipt",
  ) {
    const f = await this.repo.get(id);
    if (f.ownerId !== ownerId || f.status !== "ready" || f.purpose !== purpose)
      throw new BadRequestException("Файл недоступен или не проверен");
    return f;
  }
  async download(id: string, a: Actor) {
    const f = await this.repo.get(id);
    if (f.status !== "ready") throw new BadRequestException("Файл не готов");
    if (f.ownerId !== a.id && a.role !== "admin") {
      const bindings = await this.repo.bindings(id);
      let allowed = false;
      for (const m of bindings.materials) {
        try {
          await this.enrollments.assertAccess(a, m.courseId);
          allowed = true;
          break;
        } catch {
          /* Check the next course binding. */
        }
      }
      if (!allowed) throw new ForbiddenException("Нет доступа к файлу");
    }
    return { url: await this.storage.download(f.objectKey, f.originalName) };
  }
  async avatar(id: string) {
    const f = await this.repo.get(id);
    if (f.purpose !== "avatar" || f.status !== "ready") return null;
    return this.storage.download(f.objectKey, f.originalName);
  }
}
@ApiTags("files")
@Controller("files")
export class FilesController {
  constructor(private service: FilesService) {}
  @Post("uploads") upload(@CurrentUser() a: Actor, @Body() dto: UploadDto) {
    return this.service.upload(a, dto);
  }
  @Post(":id/complete") complete(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.service.complete(id, a);
  }
  @Get(":id/download") download(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.service.download(id, a);
  }
}
@Module({
  imports: [EnrollmentsModule],
  controllers: [FilesController],
  providers: [FilesRepository, FilesService],
  exports: [FilesService],
})
export class FilesModule {}
